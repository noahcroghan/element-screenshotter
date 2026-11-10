// Renders the icon SVGs to the PNG sizes the manifest needs, using the same
// browser as the end-to-end tests (no image tooling required).
//
// icon-toolbar.svg is a pixel-aligned, edge-to-edge design for the small
// toolbar sizes. icon.svg follows the Chrome Web Store icon guidelines (96x96
// artwork with 16 px transparent padding) for 48 and 128 px.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { findBrowser } from './browser-path.ts';

const root = join(import.meta.dirname, '..');
const sources: Record<number, string> = {
  16: 'icon-toolbar.svg',
  32: 'icon-toolbar.svg',
  48: 'icon.svg',
  128: 'icon.svg',
};

const browser = await puppeteer.launch({ executablePath: await findBrowser(), headless: true });
try {
  const page = await browser.newPage();
  for (const [size, file] of Object.entries(sources)) {
    const svg = await readFile(join(root, 'static/icons', file));
    const src = `data:image/svg+xml;base64,${svg.toString('base64')}`;
    await page.setViewport({ width: Number(size), height: Number(size), deviceScaleFactor: 1 });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}img{display:block}</style>` +
        `<img src="${src}" width="${size}" height="${size}">`,
    );
    await page.waitForFunction(() => document.images[0]?.complete);
    const png = await page.screenshot({ omitBackground: true, type: 'png' });
    await writeFile(join(root, `static/icons/icon-${size}.png`), png);
    console.log(`icon-${size}.png from ${file}`);
  }
} finally {
  await browser.close();
}
