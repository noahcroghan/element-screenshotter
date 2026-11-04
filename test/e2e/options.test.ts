import { TargetType, type WebWorker } from 'puppeteer-core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { Harness, sleep } from './harness';

let h: Harness;
let worker: WebWorker;

beforeAll(async () => {
  h = await Harness.launch();
  const target = await h.browser.waitForTarget(
    (t) => t.type() === TargetType.SERVICE_WORKER && t.url().includes(h.extension.id),
  );
  const w = await target.worker();
  if (!w) throw new Error('no service worker');
  worker = w;
});

afterAll(async () => {
  await h.close();
});

test('the default shortcut is Ctrl+Shift+S', async () => {
  const commands = await worker.evaluate(() => chrome.commands.getAll());
  const main = commands.find((c) => c.name === '_execute_action');
  expect(main?.shortcut).toMatch(/^(Ctrl|⌘)\+Shift\+S$|^⇧⌘S$/);
  expect(commands.map((c) => c.name).sort()).toEqual([
    '_execute_action',
    'save-fullpage',
    'save-visible',
  ]);
});

test('the options page is localised and saves changes', async () => {
  const page = await h.browser.newPage();
  await page.goto(`chrome-extension://${h.extension.id}/options.html`);
  expect(await page.$eval('h1', (el) => el.textContent)).toBe('Element Screenshotter settings');
  expect(await page.$eval('#shortcut', (el) => el.textContent)).toMatch(/Shift/);

  await page.click('input[name="elementDetection"][value="exact"]');
  await page.click('input[name="format"][value="jpeg"]');
  expect(await page.$eval('#quality-row', (el) => (el as HTMLElement).hidden)).toBe(false);
  await page.type('input[name="folder"]', 'My Shots');
  await page.click('input[name="saveAs"]'); // blur the text field to fire change
  await sleep(200);

  const stored = await worker.evaluate(() => chrome.storage.sync.get(null));
  expect(stored).toMatchObject({
    elementDetection: 'exact',
    format: 'jpeg',
    folder: 'My Shots',
    saveAs: true,
  });

  await page.reload();
  expect(await page.$eval('input[name="folder"]', (el) => el.value)).toBe('My Shots');
  await page.close();
});
