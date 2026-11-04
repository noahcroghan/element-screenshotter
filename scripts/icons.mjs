#!/usr/bin/env node
// Renders static/icons/icon.svg to the PNG sizes the manifest needs, using
// the same browser as the end-to-end tests (no image tooling required).

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findBrowser } from './browser-path.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(join(root, 'static/icons/icon.svg'));
const src = `data:image/svg+xml;base64,${svg.toString('base64')}`;

const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true });
try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}img{display:block}</style>` +
        `<img src="${src}" width="${size}" height="${size}">`,
    );
    await page.waitForFunction(() => document.images[0]?.complete);
    const png = await page.screenshot({ omitBackground: true, type: 'png' });
    await writeFile(join(root, `static/icons/icon-${size}.png`), png);
    console.log(`icon-${size}.png`);
  }
} finally {
  await browser.close();
}
