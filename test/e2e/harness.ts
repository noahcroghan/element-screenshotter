/**
 * End-to-end harness: a real Chromium browser with the built extension
 * loaded, plus a local fixture server.
 *
 *   BROWSER_PATH=...   use a specific browser (default: Chrome for Testing)
 *   HEADFUL=1          show the browser window
 *   DPR=2              force a device scale factor
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import puppeteer, {
  TargetType,
  type Browser,
  type Extension,
  type KeyInput,
  type Page,
  type Target,
} from 'puppeteer-core';
import { findBrowser } from '../../scripts/browser-path.ts';

/** The repository root: the nearest ancestor with a package.json. */
function findRoot(from: string): string {
  let dir = from;
  while (!existsSync(join(dir, 'package.json'))) {
    if (dirname(dir) === dir) throw new Error('package.json not found');
    dir = dirname(dir);
  }
  return dir;
}

const ROOT = findRoot(import.meta.dirname);
const DIST = join(ROOT, 'dist');
const FIXTURES = join(ROOT, 'test', 'e2e', 'fixtures');

/** The modifier the extension uses for Copy and Download shortcuts on this OS. */
export const ACCEL: KeyInput = process.platform === 'darwin' ? 'Meta' : 'Control';

export const STRICT_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; frame-src 'self'; require-trusted-types-for 'script'";

export interface Snapshot {
  state: string;
  hover: { label: string; rect: Rect | null } | null;
  /** Whether the element label is visible on screen. */
  labelShown: boolean;
  /** Whether the highlight is styled like the Zen browser (the zenBrowserStyle setting). */
  zenBrowserStyle: boolean;
  /** Where the highlight is drawn, while it is shown. Lags `hover.rect` while it slides. */
  hoverBox: Rect | null;
  /** Where the pointer is drawn after the arrow keys moved it, if they did. */
  keyboardPointer: { x: number; y: number } | null;
  /** Where our own crosshair is drawn, for the arrow keys or the ownCursor setting. */
  drawnCursor: { x: number; y: number } | null;
  /** The Save visible / Save full page panel, while it is shown. */
  panel: Rect | null;
  /** The Copy / Download bar under the selection, while it is shown. */
  buttons: Rect | null;
  selection: Rect | null;
  selectedElement: string | null;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function sleep(ms: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

/** Poll `probe` until it returns a value that isn't undefined, or time out. */
async function poll<Value>(
  probe: () => Promise<Value | undefined>,
  timeoutMs: number,
): Promise<Value | undefined> {
  const end = Date.now() + timeoutMs;
  let value = await probe();
  while (value === undefined && Date.now() < end) {
    await sleep(100);
    value = await probe();
  }
  return value;
}

export class Harness {
  readonly browser: Browser;
  readonly extension: Extension;
  readonly origin: string;
  /** Same server, but a non-secure context (no async clipboard). */
  readonly insecureOrigin: string;
  readonly downloads: string;
  readonly #server: Server;
  readonly #profile: string;

  private constructor(parts: {
    browser: Browser;
    extension: Extension;
    origin: string;
    insecureOrigin: string;
    downloads: string;
    server: Server;
    profile: string;
  }) {
    this.browser = parts.browser;
    this.extension = parts.extension;
    this.origin = parts.origin;
    this.insecureOrigin = parts.insecureOrigin;
    this.downloads = parts.downloads;
    this.#server = parts.server;
    this.#profile = parts.profile;
  }

  static async launch(): Promise<Harness> {
    const downloads = await mkdtemp(join(tmpdir(), 'es-downloads-'));
    const profile = await mkdtemp(join(tmpdir(), 'es-profile-'));
    await mkdir(join(profile, 'Default'), { recursive: true });
    await writeFile(
      join(profile, 'Default', 'Preferences'),
      JSON.stringify({
        download: {
          default_directory: downloads,
          prompt_for_download: false,
          directory_upgrade: true,
        },
        savefile: { default_directory: downloads },
      }),
    );

    const server = await startServer();
    const port = (server.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;
    const browser = await launchBrowser({
      executablePath: await findBrowser(),
      headless: !process.env.HEADFUL,
      userDataDir: profile,
      enableExtensions: [DIST],
      defaultViewport: null,
      args: [
        `--force-device-scale-factor=${process.env.DPR ?? '1'}`,
        '--window-size=1280,900',
        '--no-first-run',
        '--no-default-browser-check',
        // http://insecure.test is a non-secure origin (unlike 127.0.0.1).
        '--host-resolver-rules=MAP insecure.test 127.0.0.1',
        // Ubuntu 24.04+ blocks the user namespaces Chrome's sandbox needs.
        // The tests only load local fixture pages.
        ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      ],
    });
    // The extension list fills in shortly after launch.
    const extension = await poll(async () => {
      const extensions = await browser.extensions();
      return [...extensions.values()].find(
        (candidate) => candidate.name === 'Element Screenshotter',
      );
    }, 10_000);
    if (!extension) throw new Error('The extension did not load');
    await waitForBundledContentBlocker(browser, origin);
    watchServiceWorkerLogs(browser, extension.id);
    return new Harness({
      browser,
      extension,
      origin,
      insecureOrigin: `http://insecure.test:${port}`,
      downloads,
      server,
      profile,
    });
  }

  async close() {
    await this.browser.close();
    await new Promise((resolveClose) => this.#server.close(resolveClose));
    await rm(this.#profile, { recursive: true, force: true }).catch(() => undefined);
    await rm(this.downloads, { recursive: true, force: true }).catch(() => undefined);
  }

  /** Open a fixture page in a fresh tab. Prefix the path with /strict/ for a strict CSP. */
  async open(path: string, origin = this.origin): Promise<Page> {
    const page = await this.browser.newPage();
    await gotoWithRetry(page, `${origin}/${path}`, 3);
    // Keep the test page the only tab, so it is unambiguously the active one
    // (puppeteer starts with an about:blank tab).
    for (const other of await this.browser.pages()) {
      if (other !== page && other.url() === 'about:blank') await other.close();
    }
    await activate(page);
    return page;
  }

  /** Click the toolbar button, exactly as a user would (grants activeTab). */
  async start(page: Page) {
    await activate(page);
    const clicksBefore = await this.#clickCount();
    await page.triggerExtensionAction(this.extension);
    const opened = await this.waitForState(page, 'crosshairs', 5000).catch(() => null);
    if (opened) return;
    // A freshly started browser occasionally drops the very first toolbar
    // click. Retry only if the extension never saw the click; a click that
    // arrived but didn't open the overlay is a real failure.
    if ((await this.#clickCount()) !== clicksBefore) {
      await this.waitForState(page, 'crosshairs', 25_000);
      return;
    }
    console.warn('[harness] the toolbar click never reached the extension; clicking again');
    await activate(page);
    await page.triggerExtensionAction(this.extension);
    await this.waitForState(page, 'crosshairs');
  }

  /**
   * How many toolbar clicks the service worker has received. The counter is
   * attached from the test side (the extension has no such hook) and is
   * re-attached if the service worker restarted.
   */
  async #clickCount(): Promise<number> {
    const target = await this.browser.waitForTarget(
      (candidate) =>
        candidate.type() === TargetType.SERVICE_WORKER &&
        candidate.url().includes(this.extension.id),
    );
    const worker = await target.worker();
    if (!worker) throw new Error('The extension service worker is not running');
    return worker.evaluate(() => {
      const counter = globalThis as { __harnessClicks?: number };
      if (counter.__harnessClicks === undefined) {
        counter.__harnessClicks = 0;
        chrome.action.onClicked.addListener(() => {
          counter.__harnessClicks = (counter.__harnessClicks ?? 0) + 1;
        });
      }
      return counter.__harnessClicks;
    });
  }

  /**
   * Click "Save visible" or "Save full page". Full page is the right-hand
   * button, visible the one to its left; both sit under the drag bar.
   */
  async clickPanel(page: Page, which: 'visible' | 'fullpage') {
    const panel = (await this.snapshot(page))?.panel;
    if (!panel) throw new Error('The save panel is not shown');
    const centerX = which === 'fullpage' ? panel.right - 50 : panel.left + 50;
    await page.mouse.click(centerX, panel.bottom - 30);
  }

  async snapshot(page: Page): Promise<Snapshot | null> {
    // Other extensions (Helium ships uBlock Origin) have realms too, and
    // realms of torn-down frames can linger, so skip anything that fails.
    for (const realm of page.extensionRealms()) {
      const snap = await realm
        .extension()
        .then((owner) =>
          owner?.id === this.extension.id
            ? (realm.evaluate(
                () =>
                  (
                    globalThis as { __elementScreenshotter?: { snapshot(): unknown } }
                  ).__elementScreenshotter?.snapshot() ?? null,
              ) as Promise<Snapshot | null>)
            : null,
        )
        .catch(() => null);
      if (snap) return snap;
    }
    return null;
  }

  async waitForState(page: Page, state: string | null, timeout = 30_000): Promise<Snapshot | null> {
    let last: Snapshot | null = null;
    const reached = await poll(async () => {
      last = await this.snapshot(page);
      return (last?.state ?? null) === state ? { snapshot: last } : undefined;
    }, timeout);
    if (reached) return reached.snapshot;
    throw new Error(
      `Timed out waiting for state ${state}; last: ${JSON.stringify(last)}\n` +
        `Service worker log:\n${serviceWorkerLog.slice(-20).join('\n') || '(empty)'}`,
    );
  }

  /** Wait for a finished download (searching sub-folders) and return its path. */
  async nextDownload(timeout = 30_000): Promise<string> {
    const file = await poll(() => this.#finishedDownload(), timeout);
    if (!file) throw new Error('Timed out waiting for a download');
    return file;
  }

  async #finishedDownload(): Promise<string | undefined> {
    // In-progress downloads are *.crdownload on Windows and macOS, and
    // hidden .org.chromium.Chromium.* files on Linux. Skip both.
    const entries = await readdir(this.downloads, { recursive: true, withFileTypes: true });
    const file = entries
      .filter(
        (entry) =>
          entry.isFile() && !entry.name.startsWith('.') && !/\.(crdownload|tmp)$/.test(entry.name),
      )
      .map((entry) => join(entry.parentPath, entry.name))[0];
    if (!file) return undefined;
    try {
      // Make sure it is fully written.
      const size = (await stat(file)).size;
      await sleep(100);
      return (await stat(file)).size === size && size > 0 ? file : undefined;
    } catch {
      // Renamed or removed while we looked; try again.
      return undefined;
    }
  }

  async clearDownloads() {
    for (const entry of await readdir(this.downloads)) {
      await rm(join(this.downloads, entry), { force: true, recursive: true });
    }
  }
}

/** Launch the browser, explaining the usual fix when Linux is missing its libraries. */
async function launchBrowser(options: Parameters<typeof puppeteer.launch>[0]): Promise<Browser> {
  try {
    return await puppeteer.launch(options);
  } catch (error) {
    const missingLibraries = String(error).includes('error while loading shared libraries');
    if (!missingLibraries) throw error;
    throw new Error(
      'The test browser is missing system libraries. Install them with:\n' +
        '  sudo pnpm dlx @puppeteer/browsers install chrome@stable --install-deps\n' +
        'or set BROWSER_PATH to a Chromium-based browser you already have.',
      { cause: error },
    );
  }
}

/** Close a harness from afterAll, even if launching it failed. */
export async function closeHarness(harness: Harness | undefined) {
  await harness?.close();
}

/**
 * Bring a tab to the front and wait until the browser reports it visible.
 * On slow machines the switch lags, and an action click on a tab that is
 * not yet active is not granted activeTab.
 */
async function activate(page: Page) {
  await page.bringToFront();
  await page.waitForFunction(() => document.visibilityState === 'visible', { timeout: 10_000 });
}

async function gotoWithRetry(page: Page, url: string, attempts: number): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'load' });
  } catch (error) {
    // A brand-new tab is occasionally still settling and aborts the first navigation.
    if (attempts <= 1 || !String(error).includes('ERR_ABORTED')) throw error;
    await sleep(200);
    await gotoWithRetry(page, url, attempts - 1);
  }
}

/** Recent console output from the extension's service worker, for failure messages. */
const serviceWorkerLog: string[] = [];

/** Follow the service worker's console, including after it restarts. */
function watchServiceWorkerLogs(browser: Browser, extensionId: string) {
  const attach = async (target: Target) => {
    if (target.type() !== TargetType.SERVICE_WORKER || !target.url().includes(extensionId)) return;
    const worker = await target.worker().catch(() => null);
    worker?.on('console', (message) => {
      serviceWorkerLog.push(`[${new Date().toISOString()}] ${message.type()}: ${message.text()}`);
      if (serviceWorkerLog.length > 200) serviceWorkerLog.shift();
    });
  };
  for (const target of browser.targets()) void attach(target);
  browser.on('targetcreated', (target: Target) => void attach(target));
}

/** Helium's built-in uBlock Origin. */
const HELIUM_UBLOCK_ID = 'blockjmkbacgjkknlgpkjjiijinjdanf';

/**
 * Helium bundles uBlock Origin. Once it finishes starting up, it reloads
 * any tab that loaded before it was ready, which would interrupt a test.
 * It can't be uninstalled, so wait for that one-time reload on a warm-up
 * tab. Other browsers skip this.
 */
async function waitForBundledContentBlocker(browser: Browser, origin: string) {
  const present = browser.targets().some((target) => target.url().includes(HELIUM_UBLOCK_ID));
  if (!present) return;
  const page = await browser.newPage();
  let loads = 0;
  page.on('load', () => {
    loads++;
  });
  await page.goto(`${origin}/elements.html`, { waitUntil: 'load' });
  await poll(() => Promise.resolve(loads >= 2 ? true : undefined), 10_000);
  await page.close();
}

/**
 * Close a test's page. If the test failed, first save a screenshot (overlay
 * included) to test-results/, which CI uploads.
 */
export async function closePage(
  page: Page | undefined,
  task: { name: string; result?: { state?: string } },
) {
  if (!page || page.isClosed()) return;
  if (task.result?.state === 'fail') {
    const dir = join(ROOT, 'test-results');
    await mkdir(dir, { recursive: true });
    const name = task.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 80);
    await page
      .screenshot({ path: join(dir, `${name}-dpr${process.env.DPR ?? '1'}.png`) })
      .catch(() => undefined);
  }
  await page.close().catch(() => undefined);
}

export interface Image {
  width: number;
  height: number;
  pixel(x: number, y: number): [number, number, number];
}

export function decodePng(buffer: Buffer): Image {
  const png = PNG.sync.read(buffer);
  return {
    width: png.width,
    height: png.height,
    pixel(pixelX, pixelY) {
      const offset = (png.width * Math.floor(pixelY) + Math.floor(pixelX)) * 4;
      return [png.data[offset] ?? 0, png.data[offset + 1] ?? 0, png.data[offset + 2] ?? 0];
    },
  };
}

export async function readPng(path: string): Promise<Image> {
  return decodePng(await readFile(path));
}

/** Is a pixel within `tolerance` of an RGB colour on every channel? */
export function near(
  actual: [number, number, number],
  expected: [number, number, number],
  tolerance = 12,
) {
  return actual.every((channel, index) => Math.abs(channel - (expected[index] ?? 0)) <= tolerance);
}

/** Read the image on the clipboard as PNG bytes (needs clipboard-read permission). */
export async function readClipboardPng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find((candidate) => candidate.types.includes('image/png'));
    if (!item) {
      throw new Error(
        `No image on the clipboard: ${items.flatMap((entry) => entry.types).join(',')}`,
      );
    }
    const bytes = new Uint8Array(await (await item.getType('image/png')).arrayBuffer());
    const parts: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
    }
    return btoa(parts.join(''));
  });
  return Buffer.from(base64, 'base64');
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
};

function startServer(): Promise<Server> {
  const server = createServer((request, response) => {
    void (async () => {
      const requested = decodeURIComponent(
        new URL(request.url ?? '/', 'http://localhost').pathname,
      );
      const strict = requested.startsWith('/strict/');
      const path = strict ? requested.slice('/strict'.length) : requested;
      const headers: Record<string, string> = strict
        ? { 'Content-Security-Policy': STRICT_CSP }
        : {};
      const file = resolve(FIXTURES, `.${path}`);
      if (!file.startsWith(FIXTURES)) {
        response.writeHead(403).end();
        return;
      }
      try {
        const body = await readFile(file);
        response.writeHead(200, {
          'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
          ...headers,
        });
        response.end(body);
      } catch {
        response.writeHead(404).end('not found');
      }
    })();
  });
  return new Promise((resolveServer) =>
    server.listen(0, '127.0.0.1', () => {
      resolveServer(server);
    }),
  );
}
