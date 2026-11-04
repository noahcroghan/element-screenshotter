/**
 * Offscreen document (reason BLOBS). It receives image bytes from the
 * content script over a port, rebuilds the Blob, and asks the service worker
 * to download it via a blob: URL. Service workers cannot create blob URLs,
 * and data URLs over about 2 MB fail in chrome.downloads.
 */

import { base64ToBytes } from '../shared/bytes';
import {
  TRANSFER_PORT,
  type DownloadResult,
  type Result,
  type ToBackground,
  type TransferMessage,
  type TransferReply,
} from '../shared/messages';

/** If a download is still running when the service worker stops waiting, revoke much later. */
const LATE_REVOKE_MS = 10 * 60_000;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== TRANSFER_PORT) return;
  let meta: Extract<TransferMessage, { type: 'begin' }> | null = null;
  let parts: Uint8Array<ArrayBuffer>[] = [];

  const reply = (message: TransferReply) => {
    try {
      port.postMessage(message);
    } catch {
      // The tab went away; nothing to tell.
    }
  };

  const finish = (begin: Extract<TransferMessage, { type: 'begin' }>) => {
    const url = URL.createObjectURL(new Blob(parts, { type: begin.mime }));
    parts = [];
    void requestDownload(url, begin.filename).then((result) => {
      if (result.settled) URL.revokeObjectURL(url);
      else {
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, LATE_REVOKE_MS);
      }
      reply({ type: 'done', ok: result.ok, error: result.error, canceled: result.canceled });
    });
  };

  port.onMessage.addListener((message: TransferMessage) => {
    if (message.type === 'begin') {
      meta = message;
      parts = [];
    } else if (message.type === 'chunk') {
      parts.push(base64ToBytes(message.data));
    } else if (meta) {
      finish(meta);
    } else {
      reply({ type: 'done', ok: false, error: 'Transfer ended before it began' });
    }
  });
});

async function requestDownload(url: string, filename: string): Promise<DownloadResult> {
  const message: ToBackground = { type: 'offscreen-download', url, filename };
  try {
    const response = await chrome.runtime.sendMessage<ToBackground, Result<DownloadResult>>(
      message,
    );
    return response.ok ? response.value : { ok: false, error: response.error, settled: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      settled: true,
    };
  }
}
