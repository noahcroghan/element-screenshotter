// Finds the browser used by the end-to-end tests and the icon renderer.
//
// Set BROWSER_PATH to use a specific Chromium-based browser. Otherwise
// Chrome for Testing is downloaded once into node_modules/.cache and reused,
// so a fresh clone needs no browser installed.

import {
  Browser,
  BrowserTag,
  detectBrowserPlatform,
  getInstalledBrowsers,
  resolveBuildId,
} from '@puppeteer/browsers';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const CACHE_DIR = join(import.meta.dirname, '..', 'node_modules', '.cache', 'chrome-for-testing');
const INSTALLER = join(import.meta.dirname, 'install-browser.ts');
const ATTEMPTS = 3;

export async function findBrowser(): Promise<string> {
  if (process.env.BROWSER_PATH) return process.env.BROWSER_PATH;

  const cached = await cachedBrowser();
  if (cached) return cached;

  const platform = detectBrowserPlatform();
  if (!platform) {
    throw new Error('Chrome for Testing is not available for this platform. Set BROWSER_PATH.');
  }
  const buildId = await resolveBuildId(Browser.CHROME, platform, BrowserTag.STABLE);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    // An interrupted download leaves a partial archive or a half-unpacked
    // folder behind, and install() fails on either. Start from nothing.
    await rm(CACHE_DIR, { recursive: true, force: true });
    console.log(`Downloading Chrome for Testing ${buildId} (first run only)...`);
    if (await runInstaller(buildId)) {
      const installed = await cachedBrowser();
      if (installed) return installed;
    }
    if (attempt < ATTEMPTS) console.log('The download failed. Trying again...');
  }
  await rm(CACHE_DIR, { recursive: true, force: true });
  throw new Error(
    `Could not download Chrome for Testing ${buildId}. Set BROWSER_PATH to use another browser.`,
  );
}

/** A complete Chrome install in the cache, if there is one. */
async function cachedBrowser(): Promise<string | undefined> {
  const installed = await getInstalledBrowsers({ cacheDir: CACHE_DIR });
  return installed.find(
    (candidate) => candidate.browser === Browser.CHROME && existsSync(candidate.executablePath),
  )?.executablePath;
}

/** Run install-browser.ts in a child process, which can exit when the download stalls. */
function runInstaller(buildId: string): Promise<boolean> {
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  const child = spawn(process.execPath, [tsx, INSTALLER, CACHE_DIR, buildId], { stdio: 'inherit' });
  return new Promise((resolve) => {
    child.on('exit', (code) => {
      resolve(code === 0);
    });
    child.on('error', () => {
      resolve(false);
    });
  });
}
