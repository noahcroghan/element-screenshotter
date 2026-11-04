#!/usr/bin/env node
// Prints the CHANGELOG.md section for a version, for use as release notes.
//
//   node scripts/release-notes.mjs 1.0.0
//
// Exits non-zero if there is no section for that version, so a release can't
// go out without notes.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function extractNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const heading = new RegExp(`^## \\[?${version.replace(/\./g, '\\.')}\\]?(\\s|$)`);
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end === -1) end = lines.length;
  // Drop trailing link reference definitions such as "[1.0.0]: https://…".
  const body = lines.slice(start + 1, end).filter((l) => !/^\[[^\]]+\]:\s/.test(l));
  return body.join('\n').trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2];
  if (!version) {
    console.error('usage: release-notes.mjs <version>');
    process.exit(2);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const notes = extractNotes(await readFile(join(root, 'CHANGELOG.md'), 'utf8'), version);
  if (!notes) {
    console.error(`CHANGELOG.md has no section for ${version}`);
    process.exit(1);
  }
  console.log(notes);
}
