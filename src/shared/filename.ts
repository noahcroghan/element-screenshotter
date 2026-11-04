/**
 * Download filenames, modelled on Firefox's `getFilename` in
 * browser/components/screenshots/fileHelpers.mjs:
 *
 *   "Screenshot 2025-01-31 at 14-05-09 Page title.png"
 *
 * Chrome's downloads API is stricter than Firefox about filenames, so
 * sanitising also covers Windows reserved names and path separators.
 */

export type ImageFormat = 'png' | 'jpeg';

/** Keep the stem well under the 255-character limit common to all platforms. */
export const MAX_STEM_LENGTH = 200;

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Make an arbitrary string safe to use as a single path segment. */
export function sanitizeSegment(input: string): string {
  /* eslint-disable no-control-regex */
  let s = input
    .replace(/[\\/]/g, '_')
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f:*?|"<>;,+=[\]~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\u180e.]+|[\s\u180e.]+$/g, '');
  /* eslint-enable no-control-regex */
  if (WINDOWS_RESERVED.test(s)) s = `_${s}`;
  return s;
}

/** Sanitise a user-supplied folder like "Screenshots/Work". Empty means none. */
export function sanitizeFolder(input: string): string {
  return input
    .split(/[\\/]+/)
    .map(sanitizeSegment)
    .filter((seg) => seg.length > 0 && seg !== '..')
    .join('/');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local date and time parts, e.g. ["2025-01-31", "14-05-09"]. */
export function timestampParts(date: Date): [string, string] {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return [day, time];
}

export function extensionFor(format: ImageFormat): string {
  return format === 'jpeg' ? 'jpg' : 'png';
}

/**
 * Build a relative download path such as
 * "Screenshots/Screenshot 2025-01-31 at 14-05-09 Example Domain.png".
 */
export function buildFilename(opts: {
  title: string;
  date: Date;
  format: ImageFormat;
  folder?: string;
}): string {
  const [day, time] = timestampParts(opts.date);
  let stem = `Screenshot ${day} at ${time}`;
  const title = sanitizeSegment(opts.title);
  if (title) stem += ` ${title}`;
  if (stem.length > MAX_STEM_LENGTH) {
    // Avoid cutting a surrogate pair in half.
    stem = Array.from(stem)
      .slice(0, MAX_STEM_LENGTH - 5)
      .join('')
      .trimEnd();
    stem += '[...]';
  }
  const name = `${stem}.${extensionFor(opts.format)}`;
  const folder = sanitizeFolder(opts.folder ?? '');
  return folder ? `${folder}/${name}` : name;
}
