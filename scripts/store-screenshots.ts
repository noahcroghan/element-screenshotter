// Takes the Chrome Web Store screenshots, 1280x800, with the built
// extension on a saved copy of a real page.
//
//   pnpm store:screenshots
//
// The page is test/e2e/fixtures/store/screenshot-article.html (see
// scripts/store-page.ts), and every request outside the local server is
// blocked, so the same build gives the same images. Fonts come from the
// operating system, so compare images made on the same one. The pointer goes
// to elements found by what they are (see open-store-page.ts), not to fixed
// coordinates, so the pictures show the same things on every system.

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'puppeteer-core';
import { Harness, sleep } from '../test/e2e/harness.ts';
import {
  boxOf,
  FIGURE,
  FIGURE_IMAGE,
  FIRST_PARAGRAPH,
  openStorePage,
  SECOND_PARAGRAPH,
} from './open-store-page.ts';

const OUTPUT = join(import.meta.dirname, '..', 'out', 'store-screenshots');
/** Where the pointer waits while a picture is taken, in the bottom right corner. */
const CORNER = { x: 1270, y: 790 };
/**
 * The region in the third picture covers the opening paragraphs: from just
 * outside the first one's top left corner to just below the second one,
 * stopping short of the figure beside them. In pixels.
 */
const REGION_MARGIN = { left: 14, top: 3, bottom: 8, beforeFigure: 21 };

const openPage = (harness: Harness): Promise<Page> =>
  openStorePage(harness, { reducedMotion: true });

/** Move the pointer to each point in turn, so the overlay sees it settle. */
async function hover(page: Page, points: { x: number; y: number }[]) {
  for (const { x, y } of points) {
    await page.mouse.move(Math.round(x), Math.round(y), { steps: 3 });
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
  const image = await boxOf(page, FIGURE_IMAGE);
  const middle = { x: (image.left + image.right) / 2, y: (image.top + image.bottom) / 2 };
  await hover(page, [
    { x: middle.x - 5, y: middle.y - 5 },
    middle,
    { x: middle.x + 5, y: middle.y + 5 },
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
  const first = await boxOf(page, FIRST_PARAGRAPH);
  const second = await boxOf(page, SECOND_PARAGRAPH);
  const figure = await boxOf(page, FIGURE);
  await hover(page, [{ x: first.left - REGION_MARGIN.left, y: first.top - REGION_MARGIN.top }]);
  await page.mouse.down();
  await page.mouse.move(
    Math.round(figure.left - REGION_MARGIN.beforeFigure),
    Math.round(second.bottom + REGION_MARGIN.bottom),
    { steps: 10 },
  );
  await page.mouse.up();
  await harness.waitForState(page, 'selected');
  await page.mouse.move(CORNER.x, CORNER.y);
  await save(page, '3-region');
  await page.close();

  // 4. The preview after Save visible.
  page = await openPage(harness);
  await harness.start(page);
  await harness.clickPanel(page, 'visible');
  await harness.waitForState(page, 'preview', 60_000);
  await page.mouse.move(CORNER.x, CORNER.y);
  await save(page, '4-preview');
  await page.close();
} finally {
  await harness.close();
}
