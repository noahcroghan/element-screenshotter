import { describe, expect, test } from 'vitest';
import {
  base64ToBytes,
  blobToBase64Chunks,
  bytesToBase64,
  dataUrlToBlob,
} from '../../src/shared/bytes';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../src/shared/settings';

describe('normalizeSettings', () => {
  test('fills in defaults', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  test('rejects invalid values and clamps quality', () => {
    expect(
      normalizeSettings({
        elementDetection: 'magic',
        format: 'gif',
        jpegQuality: 7,
        saveAs: 'yes',
        folder: 3,
      }),
    ).toEqual({ ...DEFAULT_SETTINGS, jpegQuality: 1 });
  });

  test('keeps valid values', () => {
    const s = {
      elementDetection: 'exact',
      format: 'jpeg',
      jpegQuality: 0.8,
      saveAs: true,
      folder: 'Shots',
    };
    expect(normalizeSettings(s)).toEqual(s);
  });
});

describe('bytes', () => {
  const bytes = new Uint8Array(100_000).map((_, i) => (i * 7) % 256);

  test('base64 round trip', () => {
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  test('chunks reassemble into the original bytes', async () => {
    const chunks: Uint8Array[] = [];
    for await (const c of blobToBase64Chunks(new Blob([bytes]), 3 * 1000))
      chunks.push(base64ToBytes(c));
    expect(chunks.length).toBe(Math.ceil(bytes.length / 3000));
    const joined = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of chunks) {
      joined.set(c, o);
      o += c.length;
    }
    expect(joined).toEqual(bytes);
  });

  test('chunk size must keep base64 boundaries aligned', async () => {
    await expect(blobToBase64Chunks(new Blob([bytes]), 1000).next()).rejects.toThrow();
  });

  test('dataUrlToBlob decodes base64 and plain data URLs', async () => {
    const b = dataUrlToBlob(`data:image/png;base64,${bytesToBase64(bytes.subarray(0, 10))}`);
    expect(b.type).toBe('image/png');
    expect(new Uint8Array(await b.arrayBuffer())).toEqual(bytes.subarray(0, 10));
    const t = dataUrlToBlob('data:text/plain,hello%20world');
    expect(await t.text()).toBe('hello world');
    expect(() => dataUrlToBlob('https://example.com')).toThrow();
  });
});
