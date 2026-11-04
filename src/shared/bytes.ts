/**
 * Byte helpers for moving images between contexts without fetch().
 *
 * Content scripts can be subject to the page's CSP, so decoding a data URL
 * with `fetch(dataUrl)` is not reliable. These helpers decode by hand.
 */

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export function bytesToBase64(bytes: Uint8Array): string {
  // Build the binary string in slices; String.fromCharCode has an argument limit.
  const SLICE = 0x8000;
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += SLICE) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + SLICE)));
  }
  return btoa(parts.join(''));
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('Not a data URL');
  const [, mime = 'application/octet-stream', isBase64, payload = ''] = match;
  const bytes = isBase64
    ? base64ToBytes(payload)
    : new TextEncoder().encode(decodeURIComponent(payload));
  return new Blob([bytes], { type: mime });
}

/**
 * Split a blob into base64 chunks. 3 MiB of raw bytes per chunk becomes
 * 4 MiB of base64, far below Chrome's 64 MiB message limit.
 */
export async function* blobToBase64Chunks(
  blob: Blob,
  chunkBytes = 3 * 1024 * 1024,
): AsyncGenerator<string> {
  if (chunkBytes % 3 !== 0) throw new Error('chunkBytes must be a multiple of 3');
  for (let offset = 0; offset < blob.size; offset += chunkBytes) {
    const buffer = await blob.slice(offset, offset + chunkBytes).arrayBuffer();
    yield bytesToBase64(new Uint8Array(buffer));
  }
}
