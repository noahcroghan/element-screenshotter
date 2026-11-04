import { readFile } from 'node:fs/promises';
import { TargetType, type KeyInput, type Page, type WebWorker } from 'puppeteer-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { decodePng, Harness, near, readClipboardPng, readPng, sleep } from './harness';

const BLUE: [number, number, number] = [0, 0, 255];
const CYAN: [number, number, number] = [0, 255, 255];
const ORANGE: [number, number, number] = [255, 128, 0];
const WHITE: [number, number, number] = [255, 255, 255];

let h: Harness;
let worker: WebWorker;
let page: Page;
let dpr: number;

beforeAll(async () => {
  h = await Harness.launch();
  const target = await h.browser.waitForTarget(
    (t) => t.type() === TargetType.SERVICE_WORKER && t.url().includes(h.extension.id),
  );
  const w = await target.worker();
  if (!w) throw new Error('no service worker');
  worker = w;
  await h.browser
    .defaultBrowserContext()
    .setPermission(
      h.origin,
      { permission: { name: 'clipboard-read' }, state: 'granted' },
      { permission: { name: 'clipboard-write', allowWithoutSanitization: true }, state: 'granted' },
    );
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.clearDownloads();
  await worker.evaluate(() =>
    Promise.all([chrome.storage.sync.clear(), chrome.storage.local.clear()]),
  );
});

afterEach(async () => {
  await page.close();
});

async function open(path = 'elements.html', origin?: string) {
  page = await h.open(path, origin);
  dpr = await page.evaluate(() => window.devicePixelRatio);
}

async function hover(x: number, y: number) {
  await page.mouse.move(x - 5, y - 5);
  await page.mouse.move(x, y, { steps: 2 });
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

async function clickAt(x: number, y: number) {
  await hover(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

async function accel(key: KeyInput) {
  await page.keyboard.down('Control');
  await page.keyboard.press(key);
  await page.keyboard.up('Control');
}

/** Click a button in the "Save visible / Save full page" panel (top-right). */
async function clickPanel(which: 'visible' | 'fullpage') {
  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  // Full page is the right-hand button, visible the one to its left.
  await page.mouse.click(which === 'fullpage' ? vw - 70 : vw - 180, 36);
}

describe('copy', () => {
  test('Ctrl+C copies the selected element as a PNG', async () => {
    await open();
    await h.start(page);
    await clickAt(150, 180);
    await h.waitForState(page, 'selected');
    await accel('c');
    await h.waitForState(page, null);
    const img = decodePng(await readClipboardPng(page));
    expect(img.width).toBe(Math.round(120 * dpr));
    expect(img.height).toBe(Math.round(60 * dpr));
    expect(near(img.pixel(img.width / 2, img.height / 2), BLUE)).toBe(true);
  });

  test('after a copy, Copy becomes the focused action next time (like Firefox)', async () => {
    await open();
    await h.start(page);
    await clickAt(150, 180);
    await h.waitForState(page, 'selected');
    await accel('c');
    await h.waitForState(page, null);
    await page.evaluate(() => navigator.clipboard.writeText('placeholder'));

    await h.start(page);
    await clickAt(300, 300); // the card
    await h.waitForState(page, 'selected');
    await page.keyboard.press('Enter');
    await h.waitForState(page, null);
    const img = decodePng(await readClipboardPng(page));
    expect(img.width).toBe(Math.round(400 * dpr));
  });

  test('on a non-secure page, copy explains why it is unavailable and keeps the selection', async () => {
    await open('elements.html', h.insecureOrigin);
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
    await h.start(page);
    await clickAt(150, 180);
    await h.waitForState(page, 'selected');
    await accel('c');
    await sleep(300);
    expect((await h.snapshot(page))?.state).toBe('selected');
    // Download still works there.
    await accel('s');
    const img = await readPng(await h.nextDownload());
    expect(img.width).toBe(Math.round(120 * dpr));
  });
});

describe('regions', () => {
  test('dragging selects an arbitrary region', async () => {
    await open();
    await h.start(page);
    await page.mouse.move(560, 480);
    await page.mouse.down();
    await page.mouse.move(700, 560, { steps: 5 });
    await page.mouse.move(860, 630, { steps: 5 });
    await page.mouse.up();
    const snap = await h.waitForState(page, 'selected');
    expect(snap?.selection).toEqual({ left: 560, top: 480, right: 860, bottom: 630 });
    expect(snap?.selectedElement).toBeNull();
    await page.keyboard.press('Enter');
    const img = await readPng(await h.nextDownload());
    expect(img.width).toBe(Math.round(300 * dpr));
    expect(img.height).toBe(Math.round(150 * dpr));
  });

  test('the bottom-right handle resizes the selection', async () => {
    await open();
    await h.start(page);
    await clickAt(150, 180);
    await h.waitForState(page, 'selected');
    await page.mouse.move(240, 220);
    await page.mouse.down();
    await page.mouse.move(300, 260, { steps: 5 });
    await page.mouse.up();
    const snap = await h.waitForState(page, 'selected');
    expect(snap?.selection).toEqual({ left: 120, top: 160, right: 300, bottom: 260 });
  });

  test('clicking outside the selection goes back to picking', async () => {
    await open();
    await h.start(page);
    await clickAt(150, 180);
    await h.waitForState(page, 'selected');
    await clickAt(600, 700);
    await h.waitForState(page, 'crosshairs');
  });
});

describe('visible and full page', () => {
  test('Save full page shows a preview and downloads the whole page once', async () => {
    await open();
    await h.start(page);
    await clickPanel('fullpage');
    await h.waitForState(page, 'preview', 60_000);
    await accel('s');
    const img = await readPng(await h.nextDownload(60_000));
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    expect(img.width).toBe(Math.round(vw * dpr));
    expect(img.height).toBe(Math.round(4000 * dpr));
    // The fixed header appears at the top only.
    expect(near(img.pixel(600 * dpr, 10 * dpr), CYAN)).toBe(true);
    for (const y of [1000, 1700, 2500, 3300]) {
      expect(near(img.pixel(600 * dpr, y * dpr), CYAN), `y=${y}`).toBe(false);
      expect(near(img.pixel(600 * dpr, y * dpr), WHITE), `y=${y}`).toBe(true);
    }
    expect(near(img.pixel(600 * dpr, 3950 * dpr), ORANGE)).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('Save visible captures exactly the viewport', async () => {
    await open();
    await page.evaluate(() => {
      window.scrollTo(0, 300);
    });
    await h.start(page);
    await clickPanel('visible');
    await h.waitForState(page, 'preview');
    await accel('s');
    const img = await readPng(await h.nextDownload());
    const [vw, vh] = await page.evaluate(() => [
      document.documentElement.clientWidth,
      document.documentElement.clientHeight,
    ]);
    expect(img.width).toBe(Math.round((vw ?? 0) * dpr));
    expect(img.height).toBe(Math.round((vh ?? 0) * dpr));
    // The header is fixed, so it is at the top of what the user sees.
    expect(near(img.pixel(600 * dpr, 10 * dpr), CYAN)).toBe(true);
  });

  test('Retry in the preview returns to picking', async () => {
    await open();
    await h.start(page);
    await clickPanel('visible');
    await h.waitForState(page, 'preview');
    await page.keyboard.press('Escape');
    await h.waitForState(page, null);
  });
});

describe('hostile pages', () => {
  test('works under a strict CSP with Trusted Types enforced', async () => {
    await open('strict/elements.html');
    await h.start(page);
    await hover(150, 180);
    expect((await h.snapshot(page))?.hover?.label).toBe('div#inner');
    await page.mouse.down();
    await page.mouse.up();
    await h.waitForState(page, 'selected');
    await accel('s');
    const img = await readPng(await h.nextDownload());
    expect(img.width).toBe(Math.round(120 * dpr));
    expect(near(img.pixel(5, 5), BLUE)).toBe(true);
  });

  test('restricted pages get an error badge instead of an overlay', async () => {
    page = await h.browser.newPage();
    await page.goto('chrome://version');
    await page.bringToFront();
    await page.triggerExtensionAction(h.extension);
    let badge = '';
    for (let i = 0; i < 50 && badge !== '!'; i++) {
      badge = await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return chrome.action.getBadgeText({ tabId: tab?.id });
      });
      await sleep(100);
    }
    expect(badge).toBe('!');
  });
});

describe('settings', () => {
  test('exact mode highlights the element directly under the pointer', async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ elementDetection: 'exact' }));
    await open();
    await h.start(page);
    await hover(300, 100);
    expect((await h.snapshot(page))?.hover?.label).toBe('h2#heading');
  });

  test('JPEG format and a folder are honoured', async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ format: 'jpeg', folder: 'Shots' }));
    await open();
    await h.start(page);
    await clickAt(150, 180);
    await h.waitForState(page, 'selected');
    await accel('s');
    const file = await h.nextDownload();
    expect(file).toMatch(/[\\/]Shots[\\/]Screenshot [^\\/]+\.jpg$/);
    const bytes = await readFile(file);
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });
});
