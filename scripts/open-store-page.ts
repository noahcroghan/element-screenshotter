// Opens the store page for the store screenshots and the demo: 1280x800,
// scrolled past the site's header, with every request outside the local
// test server blocked, so nothing on the web can change the recording.
//
// Also names the elements both scripts point at, by what they are in any
// Wikipedia article saved by store-page.ts ("the first paragraph"), not by
// position, so other fonts or a replaced page don't move them.

import type { Page } from 'puppeteer-core';
import type { Harness, Rect } from '../test/e2e/harness.ts';

export const STORE_PAGE = 'store/screenshot-article.html';
/** Scroll past the site's header so its logo isn't in the pictures. */
const SCROLL_Y = 80;

export interface StorePageOptions {
  /** Turn off transitions, so each image is the same on every run. */
  reducedMotion?: boolean;
  /** The viewport, 1280x800 (the store's size) unless given. */
  width?: number;
  height?: number;
}

export async function openStorePage(
  harness: Harness,
  { reducedMotion = false, width = 1280, height = 800 }: StorePageOptions = {},
): Promise<Page> {
  const page = await harness.open(STORE_PAGE);
  await page.setViewport({ width, height });
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
  if (reducedMotion) {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  }
  await page.evaluate((scrollY) => {
    window.scrollTo(0, scrollY);
  }, SCROLL_Y);
  await page.mouse.move(5, 5);
  return page;
}

/** An element of the store page: the `nth` (from 0) match of `selector`. */
export interface Target {
  name: string;
  selector: string;
  nth: number;
}

export const FIRST_PARAGRAPH: Target = {
  name: 'the first paragraph',
  selector: '#mw-content-text p:not(.mw-empty-elt)',
  nth: 0,
};
export const SECOND_PARAGRAPH: Target = {
  ...FIRST_PARAGRAPH,
  name: 'the second paragraph',
  nth: 1,
};
export const FIGURE: Target = {
  name: 'the first figure',
  selector: '#mw-content-text figure',
  nth: 0,
};
export const FIGURE_IMAGE: Target = {
  name: "the first figure's image",
  selector: '#mw-content-text figure img',
  nth: 0,
};

/** Where `target` is in the viewport. Throws if it's missing or not entirely on screen. */
export async function boxOf(page: Page, target: Target): Promise<Rect> {
  const found = await page.evaluate(
    (selector, nth) => {
      const element = document.querySelectorAll(selector)[nth];
      if (!element) return null;
      const { left, top, right, bottom } = element.getBoundingClientRect();
      return { box: { left, top, right, bottom }, width: innerWidth, height: innerHeight };
    },
    target.selector,
    target.nth,
  );
  if (!found) throw new Error(`No ${target.name} (${target.selector}) on the store page`);
  const { box, width, height } = found;
  if (box.left < 0 || box.top < 0 || box.right > width || box.bottom > height) {
    throw new Error(`${target.name} is not entirely on screen: ${JSON.stringify(box)}`);
  }
  return box;
}
