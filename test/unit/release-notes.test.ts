import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { extractNotes } from '../../scripts/release-notes.ts';

const changelog = `# Changelog

## [Unreleased]

- next thing

## [1.1.0] - 2026-12-01

### Fixed

- a bug

## [1.0.0] - 2026-11-03

- first

[1.1.0]: https://example.com/1.1.0
[1.0.0]: https://example.com/1.0.0
`;

describe('extractNotes', () => {
  test('returns the section body for a version', () => {
    expect(extractNotes(changelog, '1.1.0')).toBe('### Fixed\n\n- a bug');
  });

  test('drops link references at the end of the last section', () => {
    expect(extractNotes(changelog, '1.0.0')).toBe('- first');
  });

  test('does not match a version by prefix', () => {
    expect(extractNotes(changelog, '1.1')).toBeNull();
    expect(extractNotes(changelog, '2.0.0')).toBeNull();
  });

  test('treats regex characters in the version literally', () => {
    expect(extractNotes(changelog, '1.1.*')).toBeNull();
    expect(extractNotes(changelog, '(1.1.0)')).toBeNull();
  });

  test('the real changelog has notes for the current version', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
    expect(extractNotes(await readFile('CHANGELOG.md', 'utf8'), pkg.version)).toBeTruthy();
  });
});
