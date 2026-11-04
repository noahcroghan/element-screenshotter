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

  const reply = (msg: TransferReply) => {
    try {
      port.postMessage(msg);
    } catch {
      // The tab went away; nothing to tell.
    }
  };

  port.onMessage.addListener((msg: TransferMessage) => {
    switch (msg.type) {
      case 'begin':
        meta = msg;
        parts = [];
        break;
      case 'chunk':
        parts.push(base64ToBytes(msg.data));
        break;
      case 'end': {
        if (!meta) {
          reply({ type: 'done', ok: false, error: 'Transfer ended before it began' });
          return;
        }
        const { mime, filename, saveAs } = meta;
        const url = URL.createObjectURL(new Blob(parts, { type: mime }));
        parts = [];
        void requestDownload(url, filename, saveAs).then((res) => {
          if (res.settled) URL.revokeObjectURL(url);
          else
            setTimeout(() => {
              URL.revokeObjectURL(url);
            }, LATE_REVOKE_MS);
          reply({ type: 'done', ok: res.ok, error: res.error, canceled: res.canceled });
        });
        break;
      }
    }
  });
});

async function requestDownload(
  url: string,
  filename: string,
  saveAs: boolean,
): Promise<DownloadResult> {
  const msg: ToBackground = { type: 'offscreen-download', url, filename, saveAs };
  try {
    const res = await chrome.runtime.sendMessage<ToBackground, Result<DownloadResult>>(msg);
    if (!res.ok) return { ok: false, error: res.error, settled: true };
    return res.value;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), settled: true };
  }
}
