import { describe, expect, test } from 'vitest';
import { buildFilename, MAX_STEM_LENGTH, sanitizeSegment } from '../../src/shared/filename';

const date = new Date(2025, 0, 31, 14, 5, 9);
const GRINNING_FACE = String.fromCodePoint(0x1f600);

describe('buildFilename', () => {
  test('matches the Firefox pattern', () => {
    expect(buildFilename('Example Domain', date)).toBe(
      'Screenshot 2025-01-31 at 14-05-09 Example Domain.png',
    );
  });

  test('omits an empty title', () => {
    expect(buildFilename('  ', date)).toBe('Screenshot 2025-01-31 at 14-05-09.png');
  });

  test('truncates long titles with a marker', () => {
    const name = buildFilename('x'.repeat(500), date);
    expect(name.length).toBeLessThanOrEqual(MAX_STEM_LENGTH + 4);
    expect(name).toMatch(/\[\.\.\.\]\.png$/);
  });

  test('does not split emoji when truncating', () => {
    const name = buildFilename(GRINNING_FACE.repeat(300), date);
    expect(name).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe('sanitizeSegment', () => {
  test('replaces characters Windows and Chrome reject', () => {
    expect(sanitizeSegment('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c d e f g h i j');
  });

  test('strips leading and trailing dots and spaces', () => {
    expect(sanitizeSegment(' ..hello.. ')).toBe('hello');
  });

  test('removes bidi control characters', () => {
    expect(sanitizeSegment('abc\u202Egnp.exe')).toBe('abcgnp.exe');
  });

  test('escapes reserved device names', () => {
    expect(sanitizeSegment('CON')).toBe('_CON');
    expect(sanitizeSegment('lpt1.txt')).toBe('_lpt1.txt');
  });
});
