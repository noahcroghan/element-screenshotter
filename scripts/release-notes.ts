// Prints the changelog.md section for a version, for use as release notes.
//
//   node scripts/release-notes.ts 1.0.0
//
// Exits non-zero if there is no section for that version, so a release can't
// go out without notes.

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export function extractNotes(changelog: string, version: string): string | null {
  const lines = changelog.split(/\r?\n/);
  const heading = new RegExp(`^## \\[?${version.replace(/\./g, '\\.')}\\]?(\\s|$)`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;
  const nextHeading = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  const end = nextHeading === -1 ? lines.length : nextHeading;
  // Drop link reference definitions such as "[1.0.0]: https://...".
  const body = lines.slice(start + 1, end).filter((line) => !/^\[[^\]]+\]:\s/.test(line));
  return body.join('\n').trim();
}

// Run as a script (not when imported by the unit tests).
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const version = process.argv[2];
  if (!version) {
    console.error('usage: release-notes.ts <version>');
    process.exit(2);
  }
  const changelog = await readFile(join(import.meta.dirname, '..', 'changelog.md'), 'utf8');
  const notes = extractNotes(changelog, version);
  if (!notes) {
    console.error(`changelog.md has no section for ${version}`);
    process.exit(1);
  }
  console.log(notes);
}
