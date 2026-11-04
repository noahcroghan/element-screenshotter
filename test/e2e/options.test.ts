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
  expect(await page.$eval('h1', (heading) => heading.textContent)).toBe(
    'Element Screenshotter settings',
  );
  // The shortcut is filled in asynchronously.
  await page.waitForFunction(() => document.querySelector('#shortcut')?.textContent);
  expect(await page.$eval('#shortcut', (shortcut) => shortcut.textContent)).toMatch(/S$/);

  await page.click('input[name="elementDetection"][value="exact"]');
  await sleep(200);
  const stored = await worker.evaluate(() => chrome.storage.sync.get(null));
  expect(stored).toEqual({ elementDetection: 'exact' });

  await page.reload();
  expect(await page.$eval('input[value="exact"]', (radio) => radio.checked)).toBe(true);
  await page.close();
});
