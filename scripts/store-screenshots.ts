// Takes the Chrome Web Store and Edge Add-ons screenshots, 1280x800, with
// the built extension on a saved copy of a real page.
//
//   pnpm store:screenshots
//
// The page is test/e2e/fixtures/store/screenshot-article.html (see
// scripts/store-page.ts), and every request outside the local server is
// blocked, so the same build gives the same images. Fonts come from the
// operating system, so compare images made on the same one.

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'puppeteer-core';
import { Harness, sleep } from '../test/e2e/harness.ts';

const OUTPUT = join(import.meta.dirname, '..', 'out', 'store-screenshots');
const PAGE = 'store/screenshot-article.html';
/** Scroll past the site's header so its logo isn't in the screenshots. */
const SCROLL_Y = 80;

async function openPage(harness: Harness): Promise<Page> {
  const page = await harness.open(PAGE);
  await page.setViewport({ width: 1280, height: 800 });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith(`${harness.origin}/`) || url.startsWith('data:')) {
      void request.continue();
    } else {
      console.error(`Blocked a request to ${url}`);
      process.exitCode = 1;
      void request.abort();
    }
  });
  await page.reload({ waitUntil: 'load' });
  // No transitions, so each image is the same on every run.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluate((scrollY) => {
    window.scrollTo(0, scrollY);
  }, SCROLL_Y);
  await page.mouse.move(5, 5);
  return page;
}

/** Move the pointer to each point in turn, so the overlay sees it settle. */
async function hover(page: Page, points: [number, number][]) {
  for (const [pointX, pointY] of points) {
    await page.mouse.move(pointX, pointY, { steps: 3 });
    await sleep(300);
  }
}

async function save(page: Page, name: string) {
  await sleep(600);
  const path = join(OUTPUT, `${name}.png`) as `${string}.png`;
  await page.screenshot({ path });
  console.log(`Saved ${path}`);
}

await rm(OUTPUT, { recursive: true, force: true });
await mkdir(OUTPUT, { recursive: true });
const harness = await Harness.launch();
try {
  // 1. The highlight, moved up with Up Arrow from the image to its figure.
  let page = await openPage(harness);
  await harness.start(page);
  await hover(page, [
    [880, 230],
    [885, 235],
    [890, 240],
  ]);
  const highlighted = async () => (await harness.snapshot(page))?.hover?.label ?? '';
  let presses = 0;
  while (presses < 4 && !(await highlighted()).startsWith('figure')) {
    await page.keyboard.press('ArrowUp');
    await sleep(200);
    presses++;
  }
  const label = await highlighted();
  if (!label.startsWith('figure')) throw new Error(`Highlighted ${label}, not the figure`);
  await save(page, '1-hover');

  // 2. The figure selected, with Copy and Download.
  await page.keyboard.press('Enter');
  await harness.waitForState(page, 'selected');
  await save(page, '2-element-selected');
  await page.close();

  // 3. A region dragged over the opening paragraphs.
  page = await openPage(harness);
  await harness.start(page);
  await hover(page, [[250, 160]]);
  await page.mouse.down();
  await page.mouse.move(735, 395, { steps: 10 });
  await page.mouse.up();
  await harness.waitForState(page, 'selected');
  await page.mouse.move(1270, 790);
  await save(page, '3-region');
  await page.close();

  // 4. The preview after Save visible.
  page = await openPage(harness);
  await harness.start(page);
  await harness.clickPanel(page, 'visible');
  await harness.waitForState(page, 'preview', 60_000);
  await page.mouse.move(1270, 790);
  await save(page, '4-preview');
  await page.close();
} finally {
  await harness.close();
}
