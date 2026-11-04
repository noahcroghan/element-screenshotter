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
  install,
  resolveBuildId,
} from '@puppeteer/browsers';
import { join } from 'node:path';

const CACHE_DIR = join(import.meta.dirname, '..', 'node_modules', '.cache', 'chrome-for-testing');

export async function findBrowser(): Promise<string> {
  if (process.env.BROWSER_PATH) return process.env.BROWSER_PATH;

  const installed = await getInstalledBrowsers({ cacheDir: CACHE_DIR });
  const cached = installed.find((candidate) => candidate.browser === Browser.CHROME);
  if (cached) return cached.executablePath;

  const platform = detectBrowserPlatform();
  if (!platform) {
    throw new Error('Chrome for Testing is not available for this platform. Set BROWSER_PATH.');
  }
  const buildId = await resolveBuildId(Browser.CHROME, platform, BrowserTag.STABLE);
  console.log(`Downloading Chrome for Testing ${buildId} (first run only)...`);
  const downloaded = await install({ browser: Browser.CHROME, buildId, cacheDir: CACHE_DIR });
  return downloaded.executablePath;
}
