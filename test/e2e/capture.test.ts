import { TargetType, type KeyInput, type Page, type WebWorker } from 'puppeteer-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  ACCEL,
  closeHarness,
  closePage,
  decodePng,
  Harness,
  near,
  readClipboardPng,
  readPng,
  sleep,
  type Rect,
} from './harness';

const BLUE: [number, number, number] = [0, 0, 255];
const CYAN: [number, number, number] = [0, 255, 255];
const ORANGE: [number, number, number] = [255, 128, 0];
const WHITE: [number, number, number] = [255, 255, 255];

let harness: Harness;
let worker: WebWorker;
let page: Page;
let dpr: number;

beforeAll(async () => {
  harness = await Harness.launch();
  const target = await harness.browser.waitForTarget(
    (target) =>
      target.type() === TargetType.SERVICE_WORKER && target.url().includes(harness.extension.id),
  );
  const found = await target.worker();
  if (!found) throw new Error('no service worker');
  worker = found;
  await harness.browser
    .defaultBrowserContext()
    .setPermission(
      harness.origin,
      { permission: { name: 'clipboard-read' }, state: 'granted' },
      { permission: { name: 'clipboard-write', allowWithoutSanitization: true }, state: 'granted' },
    );
});

afterAll(async () => {
  await closeHarness(harness);
});

beforeEach(async () => {
  await harness.clearDownloads();
  await worker.evaluate(() =>
    Promise.all([chrome.storage.sync.clear(), chrome.storage.local.clear()]),
  );
});

afterEach(async ({ task }) => {
  await closePage(page, task);
});

async function open(path = 'elements.html', origin?: string) {
  page = await harness.open(path, origin);
  dpr = await page.evaluate(() => window.devicePixelRatio);
}

async function hover(clientX: number, clientY: number) {
  await page.mouse.move(clientX - 5, clientY - 5);
  await page.mouse.move(clientX, clientY, { steps: 2 });
  await page.evaluate(
    () =>
      new Promise((resolveFrame) =>
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
      ),
  );
}

async function clickAt(clientX: number, clientY: number) {
  await hover(clientX, clientY);
  await page.mouse.down();
  await page.mouse.up();
}

async function accel(key: KeyInput) {
  await page.keyboard.down(ACCEL);
  await page.keyboard.press(key);
  await page.keyboard.up(ACCEL);
}

describe('copy', () => {
  test('Ctrl+C copies the selected element as a PNG', async () => {
    await open();
    await harness.start(page);
    await clickAt(150, 180);
    await harness.waitForState(page, 'selected');
    await accel('c');
    await harness.waitForState(page, null);
    const img = decodePng(await readClipboardPng(page));
    expect(img.width).toBe(Math.round(120 * dpr));
    expect(img.height).toBe(Math.round(60 * dpr));
    expect(near(img.pixel(img.width / 2, img.height / 2), BLUE)).toBe(true);
  });

  test('after a copy, Copy becomes the focused action next time (like Firefox)', async () => {
    await open();
    await harness.start(page);
    await clickAt(150, 180);
    await harness.waitForState(page, 'selected');
    await accel('c');
    await harness.waitForState(page, null);
    await page.evaluate(() => navigator.clipboard.writeText('placeholder'));

    await harness.start(page);
    await clickAt(300, 300); // the card
    await harness.waitForState(page, 'selected');
    await page.keyboard.press('Enter');
    await harness.waitForState(page, null);
    const img = decodePng(await readClipboardPng(page));
    expect(img.width).toBe(Math.round(400 * dpr));
  });

  test('on a non-secure page, copy explains why it is unavailable and keeps the selection', async () => {
    await open('elements.html', harness.insecureOrigin);
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
    await harness.start(page);
    await clickAt(150, 180);
    await harness.waitForState(page, 'selected');
    await accel('c');
    await sleep(300);
    expect((await harness.snapshot(page))?.state).toBe('selected');
    // Download still works there.
    await accel('s');
    const img = await readPng(await harness.nextDownload());
    expect(img.width).toBe(Math.round(120 * dpr));
  });
});

describe('regions', () => {
  test('dragging selects an arbitrary region', async () => {
    await open();
    await harness.start(page);
    await page.mouse.move(560, 480);
    await page.mouse.down();
    await page.mouse.move(700, 560, { steps: 5 });
    await page.mouse.move(860, 630, { steps: 5 });
    await page.mouse.up();
    const snap = await harness.waitForState(page, 'selected');
    expect(snap?.selection).toEqual({ left: 560, top: 480, right: 860, bottom: 630 });
    expect(snap?.selectedElement).toBeNull();
    await page.keyboard.press('Enter');
    const img = await readPng(await harness.nextDownload());
    expect(img.width).toBe(Math.round(300 * dpr));
    expect(img.height).toBe(Math.round(150 * dpr));
  });

  test('the bottom-right handle resizes the selection', async () => {
    await open();
    await harness.start(page);
    await clickAt(150, 180);
    await harness.waitForState(page, 'selected');
    await page.mouse.move(240, 220);
    await page.mouse.down();
    await page.mouse.move(300, 260, { steps: 5 });
    await page.mouse.up();
    const snap = await harness.waitForState(page, 'selected');
    expect(snap?.selection).toEqual({ left: 120, top: 160, right: 300, bottom: 260 });
  });

  test('clicking outside the selection goes back to picking', async () => {
    await open();
    await harness.start(page);
    await clickAt(150, 180);
    await harness.waitForState(page, 'selected');
    await clickAt(600, 700);
    await harness.waitForState(page, 'crosshairs');
  });
});

describe('visible and full page', () => {
  test('Save full page shows a preview and downloads the whole page once', async () => {
    await open();
    await harness.start(page);
    await harness.clickPanel(page, 'fullpage');
    await harness.waitForState(page, 'preview', 60_000);
    await accel('s');
    const img = await readPng(await harness.nextDownload(60_000));
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    expect(img.width).toBe(Math.round(vw * dpr));
    expect(img.height).toBe(Math.round(4000 * dpr));
    // The fixed header appears at the top only.
    expect(near(img.pixel(600 * dpr, 10 * dpr), CYAN)).toBe(true);
    for (const pageY of [1000, 1700, 2500, 3300]) {
      expect(near(img.pixel(600 * dpr, pageY * dpr), CYAN), `y=${pageY}`).toBe(false);
      expect(near(img.pixel(600 * dpr, pageY * dpr), WHITE), `y=${pageY}`).toBe(true);
    }
    expect(near(img.pixel(600 * dpr, 3950 * dpr), ORANGE)).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  /** The colours of bands.html, top to bottom, 400 CSS px each. */
  const BANDS: Array<[number, number, number]> = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [255, 0, 255],
    [0, 255, 255],
    [0, 0, 0],
    [255, 128, 0],
  ];

  /** Save the full page of bands.html and check that every band is where it belongs. */
  async function expectBands() {
    await harness.waitForState(page, 'preview', 60_000);
    await accel('s');
    const img = await readPng(await harness.nextDownload(60_000));
    expect(img.height).toBe(Math.round(3200 * dpr));
    for (const [index, colour] of BANDS.entries()) {
      // Rows on a band edge can blend at fractional scales, so stay 2 px clear.
      for (let pageY = index * 400 + 2; pageY < (index + 1) * 400 - 2; pageY += 5) {
        const px = img.pixel(img.width / 2, pageY * dpr);
        expect(near(px, colour), `y=${pageY}: ${px.join(',')}`).toBe(true);
      }
    }
  }

  test('the wheel cannot scroll the page during a full page capture', async () => {
    await open('bands.html');
    // Keep the page's view of the wheel events to check they were cancelled.
    await page.evaluate(() => {
      const events: WheelEvent[] = [];
      Object.assign(window, { wheelEvents: events });
      window.addEventListener('wheel', (event) => events.push(event), {
        capture: true,
        passive: true,
      });
    });
    await harness.start(page);
    await harness.clickPanel(page, 'fullpage');
    await page.mouse.move(640, 400);
    let turns = 0;
    while ((await harness.snapshot(page))?.state === 'capturing') {
      await page.mouse.wheel({ deltaY: 300 });
      turns++;
      await sleep(50);
    }
    expect(turns).toBeGreaterThan(3);
    const prevented = await page.evaluate(
      () =>
        (window as unknown as { wheelEvents: WheelEvent[] }).wheelEvents.filter(
          (event) => event.defaultPrevented,
        ).length,
    );
    expect(prevented).toBeGreaterThan(3);
    // No check of the restored scroll position: a turn can land just before
    // the capture starts blocking the wheel, or just after it stops.
    await expectBands();
  });

  test('a tile is taken again if the page scrolls during a full page capture', async () => {
    await open('bands.html');
    await harness.start(page);
    await harness.clickPanel(page, 'fullpage');
    // Scripted scrolling stands in for dragging the scrollbar, which can't be blocked.
    for (let count = 0; count < 3; count++) {
      await sleep(300);
      expect((await harness.snapshot(page))?.state).toBe('capturing');
      await page.evaluate(() => {
        window.scrollBy(0, 150);
      });
    }
    await expectBands();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('Save visible captures exactly the viewport', async () => {
    await open();
    await page.evaluate(() => {
      window.scrollTo(0, 300);
    });
    await harness.start(page);
    await harness.clickPanel(page, 'visible');
    await harness.waitForState(page, 'preview');
    await accel('s');
    const img = await readPng(await harness.nextDownload());
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
    await harness.start(page);
    await harness.clickPanel(page, 'visible');
    await harness.waitForState(page, 'preview');
    await page.keyboard.press('Escape');
    await harness.waitForState(page, null);
  });
});

describe('save panel', () => {
  async function panel() {
    const rect = (await harness.snapshot(page))?.panel;
    if (!rect) throw new Error('the save panel is not shown');
    return rect;
  }

  function expectSameRect(actual: Rect, expected: Rect) {
    for (const edge of ['left', 'top', 'right', 'bottom'] as const) {
      expect(actual[edge], edge).toBeCloseTo(expected[edge], 0);
    }
  }

  async function drag(fromX: number, fromY: number, toX: number, toY: number) {
    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    await page.mouse.move(toX, toY, { steps: 10 });
    await page.mouse.up();
  }

  test('can be dragged anywhere, and stays there next time', async () => {
    await open();
    await harness.start(page);
    const start = await panel();
    // Grab the bar along its top.
    await drag(start.left + 30, start.top + 6, start.left - 570, start.top + 406);
    const moved = await panel();
    expect(moved.left).toBeCloseTo(start.left - 600, 0);
    expect(moved.top).toBeCloseTo(start.top + 400, 0);
    expect((await harness.snapshot(page))?.state).toBe('crosshairs');

    await page.keyboard.press('Escape');
    await harness.waitForState(page, null);
    await harness.start(page);
    const reopened = await panel();
    expect(reopened.left).toBeCloseTo(moved.left, 0);
    expect(reopened.top).toBeCloseTo(moved.top, 0);
  });

  test('goes back to the top-right corner when the bar is double-clicked', async () => {
    await open();
    await harness.start(page);
    const start = await panel();
    await drag(start.left + 30, start.top + 6, start.left - 270, start.top + 306);
    const moved = await panel();
    expect(moved.left).toBeCloseTo(start.left - 300, 0);

    await page.mouse.click(moved.left + 30, moved.top + 6, { count: 2 });
    expectSameRect(await panel(), start);
    expect((await harness.snapshot(page))?.state).toBe('crosshairs');

    await page.keyboard.press('Escape');
    await harness.waitForState(page, null);
    await harness.start(page);
    expectSameRect(await panel(), start);
  });

  test('only the bar moves it, so a drag from a button does nothing', async () => {
    await open();
    await harness.start(page);
    const start = await panel();
    const buttonX = start.left + 50;
    await drag(buttonX, start.bottom - 30, buttonX - 300, start.bottom + 170);
    await sleep(300);
    expect((await harness.snapshot(page))?.state).toBe('crosshairs');
    expectSameRect(await panel(), start);

    await harness.clickPanel(page, 'visible');
    await harness.waitForState(page, 'preview');
  });

  test('stays in the top-right corner when the setting is off', async () => {
    await worker.evaluate(() =>
      Promise.all([
        chrome.storage.sync.set({ movablePanel: false }),
        chrome.storage.local.set({
          panelAnchor: { horizontal: 'left', x: 40, vertical: 'bottom', y: 40 },
        }),
      ]),
    );
    await open();
    await harness.start(page);
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    const start = await panel();
    expect(start.right).toBeCloseTo(vw - 12, 0);
    expect(start.top).toBeCloseTo(12, 0);
    await drag(start.left + 30, start.top + 6, start.left - 270, start.top + 306);
    expectSameRect(await panel(), start);
  });
});

describe('hostile pages', () => {
  test('works under a strict CSP with Trusted Types enforced', async () => {
    await open('strict/elements.html');
    await harness.start(page);
    await hover(150, 180);
    expect((await harness.snapshot(page))?.hover?.label).toBe('div#inner');
    await page.mouse.down();
    await page.mouse.up();
    await harness.waitForState(page, 'selected');
    await accel('s');
    const img = await readPng(await harness.nextDownload());
    expect(img.width).toBe(Math.round(120 * dpr));
    expect(near(img.pixel(5, 5), BLUE)).toBe(true);
  });

  test('restricted pages get an error badge instead of an overlay', async () => {
    page = await harness.browser.newPage();
    await page.goto('chrome://version');
    await page.bringToFront();
    await page.triggerExtensionAction(harness.extension);
    const readBadge = () =>
      worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return chrome.action.getBadgeText({ tabId: tab?.id });
      });
    const deadline = Date.now() + 5000;
    let badge = await readBadge();
    while (badge !== '!' && Date.now() < deadline) {
      await sleep(100);
      badge = await readBadge();
    }
    expect(badge).toBe('!');
  });
});

describe('settings', () => {
  test('exact mode highlights the element directly under the pointer', async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ elementDetection: 'exact' }));
    await open();
    await harness.start(page);
    await hover(300, 100);
    expect((await harness.snapshot(page))?.hover?.label).toBe('h2#heading');
  });

  test('the element label is hidden by default, like Firefox', async () => {
    await open();
    await harness.start(page);
    await hover(150, 180);
    const snap = await harness.snapshot(page);
    expect(snap?.hover?.label).toBe('div#inner');
    expect(snap?.labelShown).toBe(false);
  });

  test('the element label setting shows the label', async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ showElementLabel: true }));
    await open();
    await harness.start(page);
    await hover(150, 180);
    expect((await harness.snapshot(page))?.labelShown).toBe(true);
  });

  test('pointer mode: arrow keys move the pointer, a mouse move takes over again', async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ arrowKeys: 'pointer' }));
    await open();
    await harness.start(page);
    await hover(150, 180);
    expect((await harness.snapshot(page))?.keyboardPointer).toBeNull();
    for (let count = 0; count < 10; count++) await page.keyboard.press('ArrowRight');
    let snap = await harness.snapshot(page);
    expect(snap?.keyboardPointer).toEqual({ x: 160, y: 180 });
    expect(snap?.hover?.label).toBe('div#inner');

    await page.keyboard.down('Shift');
    for (let count = 0; count < 9; count++) await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');
    snap = await harness.snapshot(page);
    expect(snap?.keyboardPointer).toEqual({ x: 250, y: 180 });
    expect(snap?.hover?.label).toBe('div#card');

    await hover(150, 180);
    snap = await harness.snapshot(page);
    expect(snap?.keyboardPointer).toBeNull();
    expect(snap?.hover?.label).toBe('div#inner');
  });

  test('pointer mode: the pointer starts where the mouse is, even if it never moved', async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ arrowKeys: 'pointer' }));
    await open();
    await page.mouse.move(150, 180); // before the overlay exists
    await harness.start(page);
    await expect.poll(async () => (await harness.snapshot(page))?.hover?.label).toBe('div#inner');
    await page.keyboard.press('ArrowRight');
    expect((await harness.snapshot(page))?.keyboardPointer).toEqual({ x: 151, y: 180 });
  });

  test('the system cursor is used by default', async () => {
    await open();
    await harness.start(page);
    await hover(150, 180);
    expect((await harness.snapshot(page))?.drawnCursor).toBeNull();
  });

  test('the own cursor setting draws the crosshair at the mouse, but not over buttons', async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ ownCursor: true }));
    await open();
    await harness.start(page);
    await hover(150, 180);
    expect((await harness.snapshot(page))?.drawnCursor).toEqual({ x: 150, y: 180 });

    const panel = (await harness.snapshot(page))?.panel;
    if (!panel) throw new Error('The save panel is not shown');
    await hover(panel.left + 50, panel.bottom - 30);
    expect((await harness.snapshot(page))?.drawnCursor).toBeNull();

    await hover(150, 180);
    await page.mouse.down();
    await page.mouse.up();
    await harness.waitForState(page, 'selected');
    // Over the selection the move cursor shows; outside it, the crosshair.
    await hover(150, 180);
    expect((await harness.snapshot(page))?.drawnCursor).toBeNull();
    await hover(600, 400);
    expect((await harness.snapshot(page))?.drawnCursor).toEqual({ x: 600, y: 400 });
  });

  test('pointer mode: Enter selects the element under the pointer', async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ arrowKeys: 'pointer' }));
    await open();
    await harness.start(page);
    await hover(250, 180);
    await page.keyboard.press('ArrowUp'); // still div#card, not its parent
    expect((await harness.snapshot(page))?.hover?.label).toBe('div#card');
    await page.keyboard.press('Enter');
    const snap = await harness.waitForState(page, 'selected');
    expect(snap?.selectedElement).toBe('div#card');
    expect(snap?.keyboardPointer).toBeNull();
  });

  test('pointer mode: Space draws a region with the arrow keys', async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ arrowKeys: 'pointer' }));
    await open();
    await harness.start(page);
    await hover(560, 480);
    await page.keyboard.press('Space');
    await harness.waitForState(page, 'dragging');
    await page.keyboard.down('Shift');
    for (let count = 0; count < 30; count++) await page.keyboard.press('ArrowRight');
    for (let count = 0; count < 15; count++) await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Shift');
    await page.keyboard.press('Enter');
    const snap = await harness.waitForState(page, 'selected');
    expect(snap?.selection).toEqual({ left: 560, top: 480, right: 860, bottom: 630 });
    expect(snap?.selectedElement).toBeNull();
  });
});
