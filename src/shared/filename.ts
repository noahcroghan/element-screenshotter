/**
 * Download filenames, modelled on Firefox's `getFilename` in
 * browser/components/screenshots/fileHelpers.mjs:
 *
 *   "Screenshot 2025-01-31 at 14-05-09 Page title.png"
 *
 * Chrome's downloads API is stricter than Firefox about filenames, so
 * sanitising also covers Windows reserved names and path separators.
 */

/** Keep the stem well under the 255-character limit common to all platforms. */
export const MAX_STEM_LENGTH = 200;

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Make an arbitrary string (such as a page title) safe to use in a filename. */
export function sanitizeSegment(input: string): string {
  /* eslint-disable no-control-regex */
  const cleaned = input
    .replace(/[\\/]/g, '_')
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f:*?|"<>;,+=[\]~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\u180e.]+|[\s\u180e.]+$/g, '');
  /* eslint-enable no-control-regex */
  return WINDOWS_RESERVED.test(cleaned) ? `_${cleaned}` : cleaned;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** "Screenshot 2025-01-31 at 14-05-09 Page title.png", using local time. */
export function buildFilename(title: string, date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  const cleanTitle = sanitizeSegment(title);
  const stem = cleanTitle
    ? `Screenshot ${day} at ${time} ${cleanTitle}`
    : `Screenshot ${day} at ${time}`;
  if (stem.length <= MAX_STEM_LENGTH) return `${stem}.png`;
  // Truncate by code point so emoji are never cut in half.
  const truncated = Array.from(stem)
    .slice(0, MAX_STEM_LENGTH - 5)
    .join('')
    .trimEnd();
  return `${truncated}[...].png`;
}
