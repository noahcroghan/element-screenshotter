/**
 * End-to-end harness: a real Chromium browser (Helium by default) with the
 * built extension loaded, plus a local fixture server.
 *
 *   BROWSER_PATH=...   use a different browser
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
import puppeteer, { type Browser, type Extension, type Page } from 'puppeteer-core';
import { findBrowser } from '../../scripts/browser-path.mjs';

/** The repository root: the nearest ancestor with a package.json. */
function findRoot(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    if (dirname(dir) === dir) throw new Error('package.json not found');
  }
}

const ROOT = findRoot(import.meta.dirname);
const DIST = join(ROOT, 'dist');
const FIXTURES = join(ROOT, 'test', 'e2e', 'fixtures');

export const STRICT_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; frame-src 'self'; require-trusted-types-for 'script'";

export interface Snapshot {
  state: string;
  hover: { label: string; rect: Rect | null } | null;
  selection: Rect | null;
  selectedElement: string | null;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export class Harness {
  private constructor(
    readonly browser: Browser,
    readonly extension: Extension,
    readonly origin: string,
    /** Same server, but a non-secure context (no async clipboard). */
    readonly insecureOrigin: string,
    readonly downloads: string,
    private readonly server: Server,
    private readonly profile: string,
  ) {}

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
    const dpr = process.env.DPR ?? '1';
    const browser = await puppeteer.launch({
      executablePath: findBrowser(),
      headless: !process.env.HEADFUL,
      userDataDir: profile,
      enableExtensions: [DIST],
      defaultViewport: null,
      args: [
        `--force-device-scale-factor=${dpr}`,
        '--window-size=1280,900',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=DownloadBubble',
        // http://insecure.test is a non-secure origin (unlike 127.0.0.1).
        '--host-resolver-rules=MAP insecure.test 127.0.0.1',
      ],
    });
    // The extension list fills in shortly after launch.
    let extension: Extension | undefined;
    for (let i = 0; i < 100 && !extension; i++) {
      const extensions = await browser.extensions();
      extension = [...extensions.values()].find((e) => e.name === 'Element Screenshotter');
      if (!extension) await sleep(100);
    }
    if (!extension) throw new Error('The extension did not load');
    await waitForBundledContentBlocker(browser, origin);
    return new Harness(
      browser,
      extension,
      origin,
      `http://insecure.test:${port}`,
      downloads,
      server,
      profile,
    );
  }

  async close() {
    await this.browser.close();
    await new Promise((r) => this.server.close(r));
    await rm(this.profile, { recursive: true, force: true }).catch(() => undefined);
    await rm(this.downloads, { recursive: true, force: true }).catch(() => undefined);
  }

  /** Open a fixture page in a fresh tab. Prefix the path with /strict/ for a strict CSP. */
  async open(path: string, origin = this.origin): Promise<Page> {
    const page = await this.browser.newPage();
    // A brand-new tab is occasionally still settling and aborts the first navigation.
    for (let attempt = 0; ; attempt++) {
      try {
        await page.goto(`${origin}/${path}`, { waitUntil: 'load' });
        break;
      } catch (err) {
        if (attempt >= 2 || !String(err).includes('ERR_ABORTED')) throw err;
        await sleep(200);
      }
    }
    await page.bringToFront();
    return page;
  }

  /** Click the toolbar button, exactly as a user would (grants activeTab). */
  async start(page: Page) {
    await page.bringToFront();
    await page.triggerExtensionAction(this.extension);
    await this.waitForState(page, 'crosshairs');
  }

  async snapshot(page: Page): Promise<Snapshot | null> {
    // Other extensions (Helium ships uBlock Origin) have realms too, and
    // realms of torn-down frames can linger, so skip anything that fails.
    for (const realm of page.extensionRealms()) {
      try {
        const ext = await realm.extension();
        if (ext?.id !== this.extension.id) continue;
        const snap = (await realm.evaluate(
          () =>
            (
              globalThis as { __elementScreenshotter?: { snapshot(): unknown } }
            ).__elementScreenshotter?.snapshot() ?? null,
        )) as Snapshot | null;
        if (snap) return snap;
      } catch {
        // Stale realm.
      }
    }
    return null;
  }

  async waitForState(page: Page, state: string | null, timeout = 30_000): Promise<Snapshot | null> {
    const end = Date.now() + timeout;
    let last: Snapshot | null = null;
    while (Date.now() < end) {
      last = await this.snapshot(page);
      if ((last?.state ?? null) === state) return last;
      await sleep(50);
    }
    throw new Error(`Timed out waiting for state ${state}; last: ${JSON.stringify(last)}`);
  }

  /** Wait for a finished download (searching sub-folders) and return its path. */
  async nextDownload(timeout = 30_000): Promise<string> {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      // In-progress downloads are *.crdownload on Windows and macOS, and
      // hidden .org.chromium.Chromium.* files on Linux. Skip both.
      const files = (await readdir(this.downloads, { recursive: true, withFileTypes: true }))
        .filter((d) => d.isFile() && !d.name.startsWith('.') && !/\.(crdownload|tmp)$/.test(d.name))
        .map((d) => join(d.parentPath, d.name));
      const file = files[0];
      if (file) {
        try {
          // Make sure it is fully written.
          const size = (await stat(file)).size;
          await sleep(100);
          if ((await stat(file)).size === size && size > 0) return file;
        } catch {
          // Renamed or removed while we looked; try again.
        }
      }
      await sleep(100);
    }
    throw new Error('Timed out waiting for a download');
  }

  async clearDownloads() {
    for (const f of await readdir(this.downloads))
      await rm(join(this.downloads, f), { force: true });
  }
}

/** Helium's built-in uBlock Origin. */
const HELIUM_UBLOCK_ID = 'blockjmkbacgjkknlgpkjjiijinjdanf';

/**
 * Helium bundles uBlock Origin. Once it finishes starting up, it reloads
 * any tab that loaded before it was ready, which would interrupt a test.
 * It can't be uninstalled, so wait for that one-time reload on a warm-up
 * tab.
 */
async function waitForBundledContentBlocker(browser: Browser, origin: string) {
  const present = browser.targets().some((t) => t.url().includes(HELIUM_UBLOCK_ID));
  if (!present) return;
  const page = await browser.newPage();
  let loads = 0;
  page.on('load', () => {
    loads++;
  });
  await page.goto(`${origin}/elements.html`, { waitUntil: 'load' });
  const end = Date.now() + 10_000;
  while (loads < 2 && Date.now() < end) await sleep(100);
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
    const dpr = process.env.DPR ?? '1';
    await page.screenshot({ path: join(dir, `${name}-dpr${dpr}.png`) }).catch(() => undefined);
  }
  await page.close().catch(() => undefined);
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export interface Image {
  width: number;
  height: number;
  pixel(x: number, y: number): [number, number, number];
}

export function decodePng(buf: Buffer): Image {
  const png = PNG.sync.read(buf);
  return {
    width: png.width,
    height: png.height,
    pixel(x, y) {
      const i = (png.width * Math.floor(y) + Math.floor(x)) * 4;
      return [png.data[i] ?? 0, png.data[i + 1] ?? 0, png.data[i + 2] ?? 0];
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
  return actual.every((v, i) => Math.abs(v - (expected[i] ?? 0)) <= tolerance);
}

/** Read the image on the clipboard as PNG bytes (needs clipboard-read permission). */
export async function readClipboardPng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find((i) => i.types.includes('image/png'));
    if (!item)
      throw new Error(`No image on the clipboard: ${items.flatMap((i) => i.types).join(',')}`);
    const bytes = new Uint8Array(await (await item.getType('image/png')).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  return Buffer.from(b64, 'base64');
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
};

function startServer(): Promise<Server> {
  const server = createServer((req, res) => {
    void (async () => {
      let path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      const headers: Record<string, string> = {};
      if (path.startsWith('/strict/')) {
        headers['Content-Security-Policy'] = STRICT_CSP;
        path = path.slice('/strict'.length);
      }
      const file = resolve(FIXTURES, `.${path}`);
      if (!file.startsWith(FIXTURES)) {
        res.writeHead(403).end();
        return;
      }
      try {
        const body = await readFile(file);
        res.writeHead(200, {
          'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
          ...headers,
        });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    })();
  });
  return new Promise((resolveServer) =>
    server.listen(0, '127.0.0.1', () => {
      resolveServer(server);
    }),
  );
}
