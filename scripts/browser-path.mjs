// Finds a Chromium-based browser for tests and tooling.
// Set BROWSER_PATH to override. Otherwise, Helium is preferred, then other
// common Chromium installs.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function findBrowser() {
  if (process.env.BROWSER_PATH) return process.env.BROWSER_PATH;
  const local = process.env.LOCALAPPDATA ?? '';
  const pf = process.env.PROGRAMFILES ?? 'C:\\Program Files';
  const candidates =
    {
      win32: [
        join(local, 'imput', 'Helium', 'Application', 'chrome.exe'),
        join(local, 'Chromium', 'Application', 'chrome.exe'),
        join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ],
      darwin: [
        '/Applications/Helium.app/Contents/MacOS/Helium',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ],
      linux: [
        '/usr/bin/helium',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
      ],
    }[process.platform] ?? [];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      'No Chromium browser found. Set BROWSER_PATH to a Chromium-based browser executable.',
    );
  }
  return found;
}
