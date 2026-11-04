/**
 * The message protocol between extension contexts. Chrome serialises
 * messages as JSON, so everything here must be plain data.
 */

/** What the user asked for when starting a session. */
export type StartMode = 'select' | 'visible' | 'fullpage';

/** Service worker -> content script. */
export type ToContent = { type: 'start'; mode: StartMode; toggle: boolean };

/** Content script / offscreen -> service worker. */
export type ToBackground =
  | { type: 'capture-visible'; progress?: { done: number; total: number } }
  | { type: 'capture-finished' }
  | { type: 'prepare-download' }
  | { type: 'offscreen-download'; url: string; filename: string; saveAs: boolean }
  | { type: 'open-options' };

export type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? unknown : { value: T }))
  | { ok: false; error: string; canceled?: boolean };

/** Name of the port used to stream image bytes to the offscreen document. */
export const TRANSFER_PORT = 'image-transfer';

/** Content script -> offscreen document over the transfer port. */
export type TransferMessage =
  | { type: 'begin'; mime: string; filename: string; saveAs: boolean }
  | { type: 'chunk'; data: string }
  | { type: 'end' };

/** Offscreen document -> content script over the transfer port. */
export type TransferReply = { type: 'done'; ok: boolean; error?: string; canceled?: boolean };

export const OFFSCREEN_PATH = 'offscreen.html';

/** Service worker's answer to 'offscreen-download'. */
export interface DownloadResult {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  /** False if the download was still running when the worker stopped waiting. */
  settled: boolean;
}
