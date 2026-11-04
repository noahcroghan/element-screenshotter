import type { Page } from 'puppeteer-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { closePage, Harness, near, readPng, type Rect } from './harness';

const BLUE: [number, number, number] = [0, 0, 255];
const RED: [number, number, number] = [255, 0, 0];
const GREEN: [number, number, number] = [0, 255, 0];
const MAGENTA: [number, number, number] = [255, 0, 255];
const YELLOW: [number, number, number] = [255, 255, 0];
const CYAN: [number, number, number] = [0, 255, 255];

let h: Harness;
let page: Page;
let dpr: number;

beforeAll(async () => {
  h = await Harness.launch();
});

afterAll(async () => {
  await h.close();
});

afterEach(async ({ task }) => {
  await closePage(page, task);
});

beforeEach(async () => {
  await h.clearDownloads();
  page = await h.open('elements.html');
  dpr = await page.evaluate(() => window.devicePixelRatio);
});

async function hover(x: number, y: number) {
  await page.mouse.move(x - 5, y - 5);
  await page.mouse.move(x, y, { steps: 2 });
  // Hover detection runs on the next animation frame.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

function expectRect(actual: Rect | null | undefined, expected: Rect) {
  expect(actual).toBeTruthy();
  for (const k of ['left', 'top', 'right', 'bottom'] as const) {
    expect(actual?.[k], k).toBeCloseTo(expected[k], 0);
  }
}

describe('toolbar button', () => {
  test('opens the overlay and closes it on a second click', async () => {
    await h.start(page);
    await page.triggerExtensionAction(h.extension);
    await h.waitForState(page, null);
  });

  test('Escape closes the overlay', async () => {
    await h.start(page);
    await page.keyboard.press('Escape');
    await h.waitForState(page, null);
  });
});

describe('smart element detection', () => {
  test('picks the element under the pointer', async () => {
    await h.start(page);
    await hover(150, 180);
    const snap = await h.snapshot(page);
    expect(snap?.hover?.label).toBe('div#inner');
    expectRect(snap?.hover?.rect, { left: 120, top: 160, right: 240, bottom: 220 });
  });

  test('skips headings in favour of their container', async () => {
    await h.start(page);
    await hover(300, 100);
    expect((await h.snapshot(page))?.hover?.label).toBe('section#section');
  });

  test('finds elements inside shadow roots and same-origin frames', async () => {
    await h.start(page);
    await hover(100, 560);
    expect((await h.snapshot(page))?.hover?.label).toBe('div#in-shadow');
    await hover(150, 760);
    const snap = await h.snapshot(page);
    expect(snap?.hover?.label).toBe('div#in-frame');
    expectRect(snap?.hover?.rect, { left: 70, top: 720, right: 270, bottom: 820 });
  });
});

describe('pointer details', () => {
  test('a click with no prior pointer movement selects what is under the pointer', async () => {
    await page.mouse.move(150, 180); // before the overlay exists
    await h.start(page);
    await page.mouse.down();
    await page.mouse.up();
    const snap = await h.waitForState(page, 'selected');
    expect(snap?.selectedElement).toBe('div#inner');
  });

  test('the wheel still scrolls the page while picking', async () => {
    await h.start(page);
    await hover(600, 400);
    await page.mouse.wheel({ deltaY: 600 });
    await page.waitForFunction(() => window.scrollY > 0, { timeout: 5000 });
    expect((await h.snapshot(page))?.state).toBe('crosshairs');
  });
});

describe('keyboard navigation', () => {
  test('arrow keys walk parent, child and siblings', async () => {
    await h.start(page);
    await hover(150, 180);
    const label = async () => (await h.snapshot(page))?.hover?.label;
    expect(await label()).toBe('div#inner');
    await page.keyboard.press('ArrowUp');
    expect(await label()).toBe('div#card');
    await page.keyboard.press('ArrowUp');
    expect(await label()).toBe('section#section');
    await page.keyboard.press('ArrowDown');
    expect(await label()).toBe('div#card');
    await page.keyboard.press('ArrowRight');
    expect(await label()).toBe('div#sibling');
    await page.keyboard.press('ArrowLeft');
    expect(await label()).toBe('div#card');
    await page.keyboard.press('ArrowLeft');
    expect(await label()).toBe('h2#heading');
  });
});

describe('capturing an element', () => {
  test('click selects the element and Ctrl+S downloads exactly its pixels', async () => {
    await h.start(page);
    await hover(150, 180);
    await page.mouse.down();
    await page.mouse.up();
    const snap = await h.waitForState(page, 'selected');
    expect(snap?.selectedElement).toBe('div#inner');
    expectRect(snap?.selection, { left: 120, top: 160, right: 240, bottom: 220 });

    await page.keyboard.down('Control');
    await page.keyboard.press('s');
    await page.keyboard.up('Control');
    const file = await h.nextDownload();
    expect(file).toMatch(/Screenshot \d{4}-\d\d-\d\d at \d\d-\d\d-\d\d Fixture elements\.png$/);
    const img = await readPng(file);
    expect(img.width).toBe(Math.round(120 * dpr));
    expect(img.height).toBe(Math.round(60 * dpr));
    for (const [x, y] of [
      [0, 0],
      [img.width - 1, 0],
      [0, img.height - 1],
      [img.width - 1, img.height - 1],
      [img.width / 2, img.height / 2],
    ] as const) {
      expect(near(img.pixel(x, y), BLUE), `pixel ${x},${y}`).toBe(true);
    }
    await h.waitForState(page, null);
  });

  test('Enter on the focused Download button downloads', async () => {
    await h.start(page);
    await hover(300, 300);
    await page.mouse.down();
    await page.mouse.up();
    await h.waitForState(page, 'selected');
    await page.keyboard.press('Enter');
    const img = await readPng(await h.nextDownload());
    expect(img.width).toBe(Math.round(400 * dpr));
    expect(img.height).toBe(Math.round(200 * dpr));
    expect(near(img.pixel(img.width - 2, img.height - 2), RED)).toBe(true);
    expect(near(img.pixel(30 * dpr, 30 * dpr), BLUE)).toBe(true);
  });

  test('an element taller than the viewport is stitched without the fixed header', async () => {
    await h.start(page);
    await hover(950, 100); // #tall-top
    expect((await h.snapshot(page))?.hover?.label).toBe('div#tall-top');
    await page.keyboard.press('ArrowUp'); // #tall is too big for smart mode
    expect((await h.snapshot(page))?.hover?.label).toBe('div#tall');
    await page.keyboard.press('Enter');
    await h.waitForState(page, 'selected');
    await page.keyboard.press('Enter');
    const img = await readPng(await h.nextDownload(60_000));
    expect(img.width).toBe(Math.round(300 * dpr));
    expect(img.height).toBe(Math.round(2400 * dpr));
    const mid = img.width / 2;
    expect(near(img.pixel(mid, 5), GREEN)).toBe(true);
    expect(near(img.pixel(mid, 95 * dpr), GREEN)).toBe(true);
    expect(near(img.pixel(mid, img.height - 5), MAGENTA)).toBe(true);
    // Every row between the bands is plain yellow: no header, no seams.
    for (let y = 100 * dpr; y < img.height - 100 * dpr; y += 7) {
      const px = img.pixel(mid, y);
      expect(near(px, YELLOW), `row ${y}: ${px.join(',')}`).toBe(true);
      expect(near(px, CYAN)).toBe(false);
    }
    // The user's scroll position is restored.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});
