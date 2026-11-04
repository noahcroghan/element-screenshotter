/**
 * Service worker. A thin privileged proxy for the content script: it injects
 * the content script, captures the visible tab, and saves downloads. It
 * keeps no session state, because Chrome can stop it at any time.
 */

import { localize } from '../shared/i18n';
import {
  OFFSCREEN_PATH,
  type DownloadResult,
  type ToBackground,
  type ToContent,
} from '../shared/messages';

const CONTENT_SCRIPT = 'content.js';
const MENU_TAKE = 'take-screenshot';

// ---------------------------------------------------------------------------
// Entry points: toolbar button, keyboard shortcut, context menu

chrome.runtime.onInstalled.addListener(() => {
  void chrome.contextMenus.removeAll().then(() => {
    chrome.contextMenus.create({
      id: MENU_TAKE,
      title: localize('menuTakeScreenshot'),
      contexts: ['page', 'frame', 'selection', 'link', 'image', 'video', 'audio', 'editable'],
    });
  });
});

// The keyboard shortcut (_execute_action) also fires onClicked.
chrome.action.onClicked.addListener((tab) => {
  void toggle(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_TAKE) void toggle(tab);
});

async function toggle(tab: chrome.tabs.Tab | undefined) {
  const tabId = tab?.id;
  if (tabId === undefined) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
    const message: ToContent = { type: 'toggle' };
    await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  } catch (error) {
    // chrome://, the Web Store, the PDF viewer and similar pages cannot be scripted.
    // tab.url is only visible when activeTab was granted.
    console.warn(
      `[Element Screenshotter] cannot start on tab ${tabId} (url: ${tab?.url ?? 'hidden'}, status: ${tab?.status ?? 'unknown'}):`,
      error,
    );
    await flagBadge(tabId, '!', localize('restrictedPage'));
  }
}

async function flagBadge(tabId: number, text: string, title: string) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#c50042' });
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setTitle({ tabId, title });
    setTimeout(() => {
      void chrome.action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
      void chrome.action.setTitle({ tabId, title: '' }).catch(() => undefined);
    }, 4000);
  } catch {
    // The tab may have closed.
  }
}

// ---------------------------------------------------------------------------
// Messages from the content script and the offscreen document

type Handler = (message: ToBackground, sender: chrome.runtime.MessageSender) => Promise<unknown>;

const handlers: Record<ToBackground['type'], Handler> = {
  'capture-visible': (message, sender) =>
    captureVisible(sender, message.type === 'capture-visible' ? message.progress : undefined),
  'capture-finished': async (_message, sender) => {
    if (sender.tab?.id !== undefined) {
      await chrome.action.setBadgeText({ tabId: sender.tab.id, text: '' });
    }
  },
  'prepare-download': () => ensureOffscreen(),
  'offscreen-download': async (message, sender) => {
    if (message.type !== 'offscreen-download') throw new Error('bad message');
    // Only our offscreen document may ask for downloads, and only of its own blobs.
    if (sender.url !== chrome.runtime.getURL(OFFSCREEN_PATH)) throw new Error('Unexpected sender');
    if (!message.url.startsWith(`blob:${self.location.origin}/`)) throw new Error('Unexpected URL');
    return startDownload(message.url, message.filename);
  },
};

chrome.runtime.onMessage.addListener((message: ToBackground, sender, sendResponse) => {
  const handler = handlers[message.type] as Handler | undefined;
  if (!handler) return false;
  handler(message, sender).then(
    (value) => {
      sendResponse({ ok: true, value });
    },
    (error: unknown) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    },
  );
  return true;
});

// ---------------------------------------------------------------------------
// Capturing

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_CAPTURE_ATTEMPTS = 4;
let lastCaptureAt = 0;
let captureQueue: Promise<unknown> = Promise.resolve();

/** Chrome allows MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND (2) calls per second. */
const MIN_CAPTURE_GAP_MS =
  Math.ceil(1000 / chrome.tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND) + 25;

/** Capture calls are queued so concurrent requests cannot trip the rate limit. */
function captureVisible(
  sender: chrome.runtime.MessageSender,
  progress?: { done: number; total: number },
): Promise<string> {
  const run = () => captureForSender(sender, progress);
  const result = captureQueue.then(run, run);
  captureQueue = result.catch(() => undefined);
  return result;
}

async function captureForSender(
  sender: chrome.runtime.MessageSender,
  progress?: { done: number; total: number },
): Promise<string> {
  const tab = sender.tab;
  if (tab?.id === undefined) throw new Error('No tab');
  if (sender.frameId !== 0) throw new Error('Only the top frame may capture');

  if (progress && progress.total > 1) {
    const percent = Math.round((progress.done / progress.total) * 100);
    void chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#0061e0' });
    void chrome.action.setBadgeText({ tabId: tab.id, text: `${percent}%` });
  }
  return captureTab(tab.id, tab.windowId, 1);
}

async function captureTab(tabId: number, windowId: number, attempt: number): Promise<string> {
  const wait = lastCaptureAt + MIN_CAPTURE_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  // captureVisibleTab captures whatever tab is active in the window.
  const [active] = await chrome.tabs.query({ active: true, windowId });
  if (active?.id !== tabId) throw new Error('tab-not-active');
  lastCaptureAt = Date.now();
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  } catch (error) {
    const quota = error instanceof Error && error.message.includes('MAX_CAPTURE_VISIBLE_TAB');
    if (quota && attempt < MAX_CAPTURE_ATTEMPTS) return captureTab(tabId, windowId, attempt + 1);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Downloads

let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  if (existing.length > 0) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: 'Turn screenshot bytes into a blob: URL that chrome.downloads can save.',
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

/** How long to wait for a download to finish before reporting success anyway. */
const DOWNLOAD_SETTLE_MS = 30_000;

async function startDownload(url: string, filename: string): Promise<DownloadResult> {
  let id: number;
  try {
    id = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, canceled: /cancel/i.test(message), error: message, settled: true };
  }
  const state = await waitForDownload(id, DOWNLOAD_SETTLE_MS);
  if (state.state === 'interrupted') {
    const canceled = state.error === 'USER_CANCELED';
    return { ok: false, canceled, error: state.error ?? 'interrupted', settled: true };
  }
  return { ok: true, settled: state.state === 'complete' };
}

type DownloadState = { state: 'complete' | 'interrupted' | 'in_progress'; error?: string };

function waitForDownload(id: number, timeoutMs: number): Promise<DownloadState> {
  return new Promise((resolve) => {
    const finish = (value: DownloadState) => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve(value);
    };
    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      const current = delta.id === id ? delta.state?.current : undefined;
      if (current === 'complete') finish({ state: 'complete' });
      if (current === 'interrupted') finish({ state: 'interrupted', error: delta.error?.current });
    };
    const timer = setTimeout(() => {
      finish({ state: 'in_progress' });
    }, timeoutMs);
    chrome.downloads.onChanged.addListener(onChanged);
    // It may already be done (small blobs finish almost instantly).
    void chrome.downloads.search({ id }).then(([item]) => {
      if (item?.state === 'complete') finish({ state: 'complete' });
      if (item?.state === 'interrupted') finish({ state: 'interrupted', error: item.error });
    });
  });
}
