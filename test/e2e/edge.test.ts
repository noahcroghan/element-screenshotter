import type { KeyInput, Page } from 'puppeteer-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { Harness, near, readPng } from './harness';

const BLUE: [number, number, number] = [0, 0, 255];
const MAGENTA: [number, number, number] = [255, 0, 255];

let h: Harness;
let page: Page;
let dpr: number;

beforeAll(async () => {
  h = await Harness.launch();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.clearDownloads();
});

afterEach(async () => {
  await page.close();
});

async function open(path: string) {
  page = await h.open(path);
  dpr = await page.evaluate(() => window.devicePixelRatio);
}

async function press(key: KeyInput, times = 1, modifier?: KeyInput) {
  if (modifier) await page.keyboard.down(modifier);
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
  if (modifier) await page.keyboard.up(modifier);
}

async function selectInner() {
  await h.start(page);
  await page.mouse.move(145, 175);
  await page.mouse.move(150, 180);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.mouse.down();
  await page.mouse.up();
  await h.waitForState(page, 'selected');
}

describe('keyboard editing of a selection', () => {
  test('arrow keys move the region; Shift moves by 10', async () => {
    await open('elements.html');
    await selectInner(); // (120,160)-(240,220), focus on Download
    await press('Tab'); // wraps to the region itself
    await press('ArrowRight', 3);
    await press('ArrowDown', 2, 'Shift');
    const snap = await h.snapshot(page);
    expect(snap?.selection).toEqual({ left: 123, top: 180, right: 243, bottom: 240 });
  });

  test('arrow keys on a corner handle resize from that corner', async () => {
    await open('elements.html');
    await selectInner();
    await press('Tab', 2); // region, then the top-left handle
    await press('ArrowLeft', 2, 'Shift');
    await press('ArrowUp', 5);
    const snap = await h.snapshot(page);
    expect(snap?.selection).toEqual({ left: 100, top: 155, right: 240, bottom: 220 });
  });
});

describe('preview dialog', () => {
  test('Retry goes back to picking', async () => {
    await open('elements.html');
    await h.start(page);
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    await page.mouse.click(vw - 180, 36); // Save visible
    await h.waitForState(page, 'preview');
    // Focus starts on Download; Retry is three buttons to the left.
    await press('Tab', 3, 'Shift');
    await press('Enter');
    await h.waitForState(page, 'crosshairs');
  });
});

describe('unusual pages', () => {
  test('right-to-left pages with horizontal overflow capture the full width', async () => {
    await open('rtl.html');
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
    await h.start(page);
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    // Our UI follows the UI language, not the page: "Save full page" is still on the right.
    await page.mouse.click(vw - 70, 36);
    await h.waitForState(page, 'preview', 60_000);
    await press('s', 1, 'Control');
    const img = await readPng(await h.nextDownload(60_000));
    expect(img.width).toBe(Math.round(3000 * dpr));
    // #start is at the top right, #end at the bottom left.
    expect(near(img.pixel(img.width - 10, 10), BLUE)).toBe(true);
    expect(near(img.pixel(10, img.height - 10), MAGENTA)).toBe(true);
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });

  test('pages taller than the canvas limit are cropped, not lost', async () => {
    await open('huge.html');
    await h.start(page);
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    await page.mouse.click(vw - 70, 36);
    await h.waitForState(page, 'preview', 85_000);
    await press('s', 1, 'Control');
    const img = await readPng(await h.nextDownload(60_000));
    expect(img.width).toBe(Math.round(vw * dpr));
    expect(img.height).toBeLessThanOrEqual(32766);
    expect(img.height).toBeGreaterThan(32766 - 2 * dpr);
  }, 120_000);
});
