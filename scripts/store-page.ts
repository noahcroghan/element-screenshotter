// Saves a real web page as one self-contained HTML file for the store
// screenshots, so they don't change when the live page does.
//
//   pnpm exec tsx scripts/store-page.ts [url]
//
// Scripts and other external resources are removed, and stylesheets and
// images are inlined as data URLs. Images outside the article's first screen,
// and the site's logos, are blanked but keep their size. Run it only to
// replace the page on purpose, then update the attribution in
// test/e2e/fixtures/store/README.md.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { findBrowser } from './browser-path.ts';

const PAGE_URL = process.argv[2] ?? 'https://en.wikipedia.org/wiki/Screenshot';
const OUTPUT = join(
  import.meta.dirname,
  '..',
  'test',
  'e2e',
  'fixtures',
  'store',
  'screenshot-article.html',
);
const USER_AGENT =
  'element-screenshotter store-page.ts (https://github.com/noahcroghan/element-screenshotter)';
/** Images whose top is below this (in page pixels) are blanked. */
const KEEP_IMAGES_ABOVE = 1000;
const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

async function download(url: string): Promise<Response> {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response;
}

async function dataUrl(url: string): Promise<string> {
  const response = await download(url);
  const type = (response.headers.get('content-type') ?? 'application/octet-stream').split(';')[0];
  const body = Buffer.from(await response.arrayBuffer()).toString('base64');
  return `data:${type};base64,${body}`;
}

/** Replace every url() in a stylesheet with a data URL, resolved against `base`. */
async function inlineCssUrls(css: string, base: string): Promise<string> {
  const inlined = new Map<string, string>();
  const refs = [...css.matchAll(CSS_URL)]
    .map(([, , ref = '']) => ref)
    .filter((ref) => ref && !ref.startsWith('data:') && !ref.startsWith('#'));
  for (const ref of new Set(refs)) {
    inlined.set(ref, await dataUrl(new URL(ref, base).href));
  }
  return css.replace(CSS_URL, (whole, _quote, ref: string) => {
    const replacement = inlined.get(ref);
    return replacement ? `url("${replacement}")` : whole;
  });
}

const browser = await puppeteer.launch({ executablePath: await findBrowser(), headless: true });
let saved: { revision: number | null; html: string; sheets: string[]; images: string[] };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(PAGE_URL, { waitUntil: 'networkidle0' });
  saved = await page.evaluate((keepAbove) => {
    const config = (window as { RLCONF?: { wgRevisionId?: number } }).RLCONF;
    // Measure before the stylesheets are swapped out below.
    const images: string[] = [];
    for (const image of document.querySelectorAll('img')) {
      const top = image.getBoundingClientRect().top + window.scrollY;
      const keep = image.closest('#mw-content-text') && top < keepAbove;
      if (keep) {
        image.dataset.image = String(images.length);
        images.push(image.currentSrc || image.src);
      }
      image.removeAttribute('srcset');
      image.removeAttribute('src');
      image.removeAttribute('loading');
    }
    // Wikipedia's pulsing "new feature" dot isn't part of the page, and it animates.
    for (const element of document.querySelectorAll('.mw-pulsating-dot')) {
      element.classList.remove('mw-pulsating-dot');
    }
    // The page's scripts set some state as properties, which outerHTML drops.
    for (const input of document.querySelectorAll('input')) {
      input.toggleAttribute('checked', input.checked);
    }
    for (const element of document.querySelectorAll(
      'script, noscript, iframe, link:not([rel~="stylesheet"])',
    )) {
      element.remove();
    }
    const sheets: string[] = [];
    for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')) {
      const style = document.createElement('style');
      style.dataset.sheet = String(sheets.length);
      sheets.push(link.href);
      link.replaceWith(style);
    }
    return {
      revision: config?.wgRevisionId ?? null,
      html: `<!DOCTYPE html>\n${document.documentElement.outerHTML}\n`,
      sheets,
      images,
    };
  }, KEEP_IMAGES_ABOVE);
} finally {
  await browser.close();
}

let html = saved.html;
for (const [index, href] of saved.sheets.entries()) {
  const css = await inlineCssUrls(await (await download(href)).text(), href);
  html = html.replace(`<style data-sheet="${index}"></style>`, () => `<style>${css}</style>`);
}
// Inline styles the page's scripts added, resolved against the page.
for (const [whole, open = '', css = ''] of [
  ...html.matchAll(/(<style[^>]*>)([\s\S]*?)<\/style>/g),
]) {
  const inlined = await inlineCssUrls(css, PAGE_URL);
  if (inlined !== css) html = html.replace(whole, () => `${open}${inlined}</style>`);
}
for (const [index, src] of saved.images.entries()) {
  html = html.replace(`data-image="${index}"`, `src="${await dataUrl(src)}"`);
}

const external = html.match(/(?:\ssrc=|url\()["']?(?:https?:)?\/\/[^"')\s]+/);
if (external) throw new Error(`An external resource is left: ${external[0]}`);

await writeFile(OUTPUT, html);
console.log(
  `Saved ${PAGE_URL} (revision ${saved.revision ?? 'unknown'}) to ${OUTPUT}, ` +
    `${Math.round(html.length / 1024)} KB, ${saved.images.length} images kept.`,
);
