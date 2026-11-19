// Records the demo GIF for the README: the pointer passes over a page, the
// highlight follows it from element to element, and a click selects one.
//
//   pnpm demo
//
// The output is out/demo/demo.gif. Copy it to docs/media/demo.gif when it
// should replace the one in the README.
//
// The page and its targets are in open-store-page.ts. Each hover is checked
// against the highlight the extension draws, so a page where a target no
// longer works stops the script instead of recording the wrong thing.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Page, TargetType } from 'puppeteer-core';
import { Harness, type Rect, sleep } from '../test/e2e/harness.ts';
import { Pointer, seededRandom } from './demo-pointer.ts';
import { Recording } from './demo-recording.ts';
import {
  boxOf,
  FIGURE_IMAGE,
  FIRST_PARAGRAPH,
  openStorePage,
  SECOND_PARAGRAPH,
  type Target,
} from './open-store-page.ts';

const OUTPUT_DIR = join(import.meta.dirname, '..', 'out', 'demo');
const OUTPUT = join(OUTPUT_DIR, 'demo.gif');
/**
 * The page's viewport and the GIF's size, the same so nothing is scaled: the
 * crosshair's 1 px lines fade when shrunk. GitHub shows the GIF at the width
 * of the README, so high-resolution screens get every pixel.
 */
const WIDTH = 1024;
const HEIGHT = 640;
const FPS = 25;
/** Fixed, so the pointer moves the same way on every run. */
const SEED = 8;
/** Where the pointer starts: the bottom right, in the page's margin. */
const START = { x: WIDTH - 14, y: HEIGHT - 50 };

/** Paragraphs reach under floated figures, so point left of the middle. */
const LEFT_OF_MIDDLE = { x: 0.3, y: 0.5 };

/** One thing the pointer does. */
type Step =
  /**
   * Move onto a target and check that the extension highlights it. `aim` is
   * where to point, as fractions of its width and height, if not the middle.
   */
  | { hover: Target; aim?: { x: number; y: number } }
  /** Move by an offset in pixels. */
  | { moveBy: { x: number; y: number } }
  /** Click, and check that the click selected the hovered element. */
  | { select: true }
  /** Rest the hand for some milliseconds. */
  | { rest: number };

/**
 * The whole demo, in order. It starts with the overlay open and the pointer
 * in the bottom right, and ends with the figure selected. Starting state and
 * the setting that draws the pointer are set up below.
 */
const STORYBOARD: Step[] = [
  { rest: 600 },
  { hover: FIRST_PARAGRAPH, aim: LEFT_OF_MIDDLE },
  { rest: 900 },
  { hover: SECOND_PARAGRAPH, aim: LEFT_OF_MIDDLE },
  { rest: 800 },
  { hover: FIGURE_IMAGE },
  { rest: 700 },
  { select: true },
  { rest: 250 },
  // Off the selection, where the crosshair shows again.
  { moveBy: { x: -170, y: 30 } },
  { rest: 2200 },
];

/** How often the pointer may try again when it lands on the wrong element. */
const HOVER_TRIES = 3;

/**
 * What the extension highlights once the pointer stops: '' for the target
 * itself, or a description of the element it highlights instead.
 */
async function highlightMiss(harness: Harness, page: Page, box: Rect): Promise<string> {
  const end = Date.now() + 600;
  let miss = 'nothing';
  while (Date.now() < end) {
    const hover = (await harness.snapshot(page))?.hover;
    const rect = hover?.rect;
    const same =
      rect &&
      Math.abs(rect.left - box.left) <= 1 &&
      Math.abs(rect.top - box.top) <= 1 &&
      Math.abs(rect.right - box.right) <= 1 &&
      Math.abs(rect.bottom - box.bottom) <= 1;
    if (same) return '';
    miss = hover?.label ?? 'nothing';
    await sleep(50);
  }
  return miss;
}

/**
 * Point at a target until the extension highlights exactly it. A pointer that
 * lands on a link inside a paragraph moves a little and tries again, as a
 * person would. Throws if it never works, for example on a replaced page.
 */
async function hover(
  harness: Harness,
  page: Page,
  pointer: Pointer,
  target: Target,
  aim?: { x: number; y: number },
) {
  const box = await boxOf(page, target);
  let miss = '';
  for (let attempt = 0; attempt < HOVER_TRIES; attempt++) {
    await pointer.moveInto(box, aim);
    miss = await highlightMiss(harness, page, box);
    if (!miss) return;
    console.log(`Pointing at ${target.name} highlighted ${miss}; moving again`);
  }
  throw new Error(
    `Pointing at ${target.name} highlighted ${miss} instead. ` +
      'If the store page changed, choose new targets in scripts/open-store-page.ts.',
  );
}

async function play(harness: Harness, page: Page, pointer: Pointer) {
  for (const step of STORYBOARD) {
    if ('hover' in step) {
      await hover(harness, page, pointer, step.hover, step.aim);
    } else if ('moveBy' in step) {
      await pointer.moveBy(step.moveBy.x, step.moveBy.y);
    } else if ('select' in step) {
      await pointer.click();
      await harness.waitForState(page, 'selected', 3000);
    } else {
      await pointer.rest(step.rest);
    }
  }
}

/** Turn on the setting that draws the crosshair into the page, so it's recorded. */
async function drawOwnCursor(harness: Harness) {
  const target = await harness.browser.waitForTarget(
    (candidate) =>
      candidate.type() === TargetType.SERVICE_WORKER &&
      candidate.url().includes(harness.extension.id),
  );
  const worker = await target.worker();
  if (!worker) throw new Error('The extension service worker is not running');
  await worker.evaluate(() => chrome.storage.sync.set({ ownCursor: true }));
}

await rm(OUTPUT_DIR, { recursive: true, force: true });
await mkdir(OUTPUT_DIR, { recursive: true });
const harness = await Harness.launch();
try {
  await drawOwnCursor(harness);
  const page = await openStorePage(harness, { width: WIDTH, height: HEIGHT });
  await harness.start(page);
  // The first hover is slow (the page and the picker warm up), which would
  // show as a jump, so get it over with before recording.
  const first = await boxOf(page, FIRST_PARAGRAPH);
  await page.mouse.move((first.left + first.right) / 2, (first.top + first.bottom) / 2);
  await sleep(400);
  await page.mouse.move(START.x, START.y);
  await sleep(600);
  const pointer = await Pointer.create(page, START, seededRandom(SEED));
  const recording = await Recording.start(page);
  await play(harness, page, pointer);
  const length = await recording.stop();
  const gif = await recording.encodeGif(length, { width: WIDTH, height: HEIGHT, fps: FPS });
  await writeFile(OUTPUT, gif);
  console.log(
    `Saved ${OUTPUT}: ${(length / 1000).toFixed(1)} s, ${Math.round(gif.length / 1024)} KB`,
  );
} finally {
  await harness.close();
}
