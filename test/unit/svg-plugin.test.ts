import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseSvg } from '../../scripts/svg-plugin.ts';

describe('parseSvg', () => {
  test('builds a tree without comments, whitespace, or xmlns', () => {
    const source = `<!-- header -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2">
  <g transform="translate(1 0)"><path class="a" d="M0 0h1"/></g>
</svg>
`;
    expect(parseSvg(source)).toEqual({
      tag: 'svg',
      attrs: { viewBox: '0 0 2 2' },
      children: [
        {
          tag: 'g',
          attrs: { transform: 'translate(1 0)' },
          children: [{ tag: 'path', attrs: { class: 'a', d: 'M0 0h1' }, children: [] }],
        },
      ],
    });
  });

  test.each([
    ['text content', '<svg><text>hi</text></svg>'],
    ['entities', '<svg><path d="&amp;"/></svg>'],
    ['single quotes', "<svg><path d='M0 0'/></svg>"],
    ['unclosed elements', '<svg><g></svg>'],
    ['a root other than svg', '<g/>'],
    ['two roots', '<svg/><svg/>'],
  ])('rejects %s', (_name, source) => {
    expect(() => parseSvg(source)).toThrow();
  });

  test('parses every SVG the overlay ships', async () => {
    const dir = join(import.meta.dirname, '../../src/content/svg');
    const files = (await readdir(dir)).filter((file) => file.endsWith('.svg'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(parseSvg(await readFile(join(dir, file), 'utf8')).tag).toBe('svg');
    }
  });
});
