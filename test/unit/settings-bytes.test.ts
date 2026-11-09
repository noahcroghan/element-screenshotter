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

  test('rejects invalid values', () => {
    expect(
      normalizeSettings({ elementDetection: 'magic', showElementLabel: 'yes', arrowKeys: 'mouse' }),
    ).toEqual(DEFAULT_SETTINGS);
  });

  test('keeps valid values and drops unknown keys', () => {
    expect(
      normalizeSettings({
        elementDetection: 'exact',
        showElementLabel: true,
        arrowKeys: 'pointer',
        format: 'jpeg',
      }),
    ).toEqual({ elementDetection: 'exact', showElementLabel: true, arrowKeys: 'pointer' });
  });
});

describe('bytes', () => {
  const bytes = new Uint8Array(100_000).map((_value, index) => (index * 7) % 256);

  test('base64 round trip', () => {
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  test('chunks reassemble into the original bytes', async () => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of blobToBase64Chunks(new Blob([bytes]), 3 * 1000)) {
      chunks.push(base64ToBytes(chunk));
    }
    expect(chunks.length).toBe(Math.ceil(bytes.length / 3000));
    const joined = Uint8Array.from(chunks.flatMap((chunk) => Array.from(chunk)));
    expect(joined).toEqual(bytes);
  });

  test('chunk size must keep base64 boundaries aligned', async () => {
    await expect(blobToBase64Chunks(new Blob([bytes]), 1000).next()).rejects.toThrow();
  });

  test('dataUrlToBlob decodes base64 and plain data URLs', async () => {
    const pngBlob = dataUrlToBlob(`data:image/png;base64,${bytesToBase64(bytes.subarray(0, 10))}`);
    expect(pngBlob.type).toBe('image/png');
    expect(new Uint8Array(await pngBlob.arrayBuffer())).toEqual(bytes.subarray(0, 10));
    const textBlob = dataUrlToBlob('data:text/plain,hello%20world');
    expect(await textBlob.text()).toBe('hello world');
    expect(() => dataUrlToBlob('https://example.com')).toThrow();
  });
});
