// Downloads and unpacks one Chrome for Testing build into a cache directory.
//
// Usage: tsx scripts/install-browser.ts <cacheDir> <buildId>
//
// browser-path.ts runs this in a child process. @puppeteer/browsers has no
// download timeout, so a stalled connection would hang forever. This script
// exits instead, which closes the connection, and the parent tries again.

import { Browser, install } from '@puppeteer/browsers';

const STALL_MS = 30_000;

const [cacheDir, buildId] = process.argv.slice(2);
if (!cacheDir || !buildId) {
  console.error('Usage: tsx scripts/install-browser.ts <cacheDir> <buildId>');
  process.exit(2);
}

const stall = setTimeout(() => {
  console.error(`The download stalled: no data for ${STALL_MS / 1000} s.`);
  process.exit(1);
}, STALL_MS);

await install({
  browser: Browser.CHROME,
  buildId,
  cacheDir,
  downloadProgressCallback: (downloadedBytes, totalBytes) => {
    // Unpacking reports no progress, so stop watching once the bytes are in.
    if (downloadedBytes >= totalBytes) clearTimeout(stall);
    else stall.refresh();
  },
});
clearTimeout(stall);
