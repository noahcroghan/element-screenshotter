import { TargetType, type WebWorker } from 'puppeteer-core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { closeHarness, Harness, sleep } from './harness';

let harness: Harness;
let worker: WebWorker;

beforeAll(async () => {
  harness = await Harness.launch();
  const target = await harness.browser.waitForTarget(
    (candidate) =>
      candidate.type() === TargetType.SERVICE_WORKER &&
      candidate.url().includes(harness.extension.id),
  );
  const found = await target.worker();
  if (!found) throw new Error('no service worker');
  worker = found;
});

afterAll(async () => {
  await closeHarness(harness);
});

test('the default shortcut is Ctrl+Shift+S (Command+Shift+S on macOS)', async () => {
  const commands = await worker.evaluate(() => chrome.commands.getAll());
  expect(commands.map((command) => command.name)).toEqual(['_execute_action']);
  // macOS reports the shortcut with symbols: Shift (U+21E7) and Command (U+2318).
  expect(commands[0]?.shortcut).toMatch(/^Ctrl\+Shift\+S$|^\u21E7\u2318S$/);
});

test('the options page is localised and saves changes', async () => {
  const page = await harness.browser.newPage();
  await page.goto(`chrome-extension://${harness.extension.id}/options.html`);
  expect(await page.title()).toBe('Element Screenshotter settings');
  // The shortcut is filled in asynchronously.
  await page.waitForFunction(() => document.querySelector('#shortcut')?.textContent);
  expect(await page.$eval('#shortcut', (shortcut) => shortcut.textContent)).toMatch(/S$/);
  expect(await page.$eval('#shortcut kbd:last-child', (key) => key.textContent)).toMatch(/S$/);

  expect(await page.$eval('input[name="showElementLabel"]', (box) => box.checked)).toBe(false);
  expect(await page.$eval('input[value="navigate"]', (radio) => radio.checked)).toBe(true);
  expect(await page.$eval('input[name="movablePanel"]', (box) => box.checked)).toBe(true);
  expect(await page.$eval('input[name="ownCursor"]', (box) => box.checked)).toBe(false);
  await page.click('input[name="elementDetection"][value="exact"]');
  await page.click('input[name="showElementLabel"]');
  await page.click('input[name="arrowKeys"][value="pointer"]');
  await page.click('input[name="movablePanel"]');
  await page.click('input[name="ownCursor"]');
  await sleep(200);
  const stored = await worker.evaluate(() => chrome.storage.sync.get(null));
  expect(stored).toEqual({
    elementDetection: 'exact',
    showElementLabel: true,
    arrowKeys: 'pointer',
    movablePanel: false,
    ownCursor: true,
  });

  await page.reload();
  expect(await page.$eval('input[value="exact"]', (radio) => radio.checked)).toBe(true);
  expect(await page.$eval('input[name="showElementLabel"]', (box) => box.checked)).toBe(true);
  expect(await page.$eval('input[value="pointer"]', (radio) => radio.checked)).toBe(true);
  expect(await page.$eval('input[name="movablePanel"]', (box) => box.checked)).toBe(false);
  expect(await page.$eval('input[name="ownCursor"]', (box) => box.checked)).toBe(true);
  await page.close();
});
