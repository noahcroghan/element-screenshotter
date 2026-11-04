/**
 * Getting pixels out of the content script: capture requests to the service
 * worker, clipboard writes, and downloads streamed via the offscreen
 * document.
 */

import { blobToBase64Chunks } from '../shared/bytes';
import {
  TRANSFER_PORT,
  type Result,
  type ToBackground,
  type TransferMessage,
  type TransferReply,
} from '../shared/messages';

function send<Value>(message: ToBackground): Promise<Result<Value>> {
  return chrome.runtime.sendMessage<ToBackground, Result<Value>>(message);
}

/** PNG data URL of the visible viewport, via the service worker. */
export async function captureViewport(progress?: { done: number; total: number }) {
  const response = await send<string>(
    progress ? { type: 'capture-visible', progress } : { type: 'capture-visible' },
  );
  if (!response.ok) throw new Error(response.error);
  return response.value;
}

export function captureFinished() {
  void send({ type: 'capture-finished' }).catch(() => undefined);
}

export class ClipboardUnavailableError extends Error {}

/**
 * Write a PNG to the clipboard. Call this synchronously from the click or
 * key handler: the ClipboardItem accepts a promise, so the write starts
 * while the user activation is fresh, even though the pixels arrive later.
 */
export function copyPng(png: Promise<Blob>): Promise<void> {
  // navigator.clipboard only exists in secure contexts; TS types claim it always does.
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (!window.isSecureContext || !clipboard || typeof ClipboardItem === 'undefined') {
    png.catch(() => undefined);
    return Promise.reject(new ClipboardUnavailableError('Clipboard is not available on this page'));
  }
  return clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

export interface DownloadOutcome {
  ok: boolean;
  canceled?: boolean;
  error?: string;
}

/** Stream the blob to the offscreen document, which hands it to chrome.downloads. */
export async function download(blob: Blob, filename: string): Promise<DownloadOutcome> {
  const prepared = await send({ type: 'prepare-download' });
  if (!prepared.ok) return { ok: false, error: prepared.error };

  const port = chrome.runtime.connect({ name: TRANSFER_PORT });
  const reply = new Promise<TransferReply>((resolve, reject) => {
    port.onMessage.addListener((message: TransferReply) => {
      resolve(message);
    });
    port.onDisconnect.addListener(() => {
      reject(new Error(chrome.runtime.lastError?.message ?? 'The download channel closed early'));
    });
  });
  // Avoid an unhandled rejection if posting fails before we await the reply.
  reply.catch(() => undefined);
  const post = (message: TransferMessage) => {
    port.postMessage(message);
  };

  try {
    post({ type: 'begin', mime: blob.type, filename });
    for await (const data of blobToBase64Chunks(blob)) post({ type: 'chunk', data });
    post({ type: 'end' });
    const response = await reply;
    return { ok: response.ok, canceled: response.canceled, error: response.error };
  } finally {
    port.disconnect();
  }
}
