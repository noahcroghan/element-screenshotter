/**
 * Service worker. A thin privileged proxy for the content script: it injects
 * the content script, captures the visible tab, and saves downloads. It
 * keeps no session state, because Chrome can stop it at any time.
 */

import { t } from '../shared/i18n';
import {
  OFFSCREEN_PATH,
  type DownloadResult,
  type StartMode,
  type ToBackground,
  type ToContent,
} from '../shared/messages';

const CONTENT_SCRIPT = 'content.js';
const MENU_TAKE = 'take-screenshot';
const MENU_VISIBLE = 'save-visible';
const MENU_FULLPAGE = 'save-fullpage';

// ---------------------------------------------------------------------------
// Entry points: toolbar button, keyboard shortcuts, context menus

chrome.runtime.onInstalled.addListener(() => {
  void setupMenus();
});

chrome.action.onClicked.addListener((tab) => {
  void start(tab, 'select', true);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === MENU_VISIBLE) void start(tab, 'visible', false);
  else if (command === MENU_FULLPAGE) void start(tab, 'fullpage', false);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_TAKE) void start(tab, 'select', false);
  else if (info.menuItemId === MENU_VISIBLE) void start(tab, 'visible', false);
  else if (info.menuItemId === MENU_FULLPAGE) void start(tab, 'fullpage', false);
});

async function setupMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_TAKE,
    title: t('menuTakeScreenshot'),
    contexts: ['page', 'frame', 'selection', 'link', 'image', 'video', 'audio', 'editable'],
  });
  chrome.contextMenus.create({
    id: MENU_VISIBLE,
    title: t('menuSaveVisible'),
    contexts: ['action'],
  });
  chrome.contextMenus.create({
    id: MENU_FULLPAGE,
    title: t('menuSaveFullPage'),
    contexts: ['action'],
  });
}

async function start(tab: chrome.tabs.Tab | undefined, mode: StartMode, toggle: boolean) {
  const tabId = tab?.id;
  if (tabId === undefined) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
    const msg: ToContent = { type: 'start', mode, toggle };
    await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
  } catch (err) {
    // chrome://, the Web Store, the PDF viewer and similar pages cannot be scripted.
    console.warn('[Element Screenshotter] cannot start on this tab:', err);
    await flagBadge(tabId, '!', t('restrictedPage'));
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

type Handler = (msg: ToBackground, sender: chrome.runtime.MessageSender) => Promise<unknown>;

const handlers: Partial<Record<ToBackground['type'], Handler>> = {
  'capture-visible': (msg, sender) =>
    captureVisible(sender, msg.type === 'capture-visible' ? msg.progress : undefined),
  'capture-finished': async (_msg, sender) => {
    if (sender.tab?.id !== undefined) {
      await chrome.action.setBadgeText({ tabId: sender.tab.id, text: '' });
    }
  },
  'prepare-download': () => ensureOffscreen(),
  'offscreen-download': (msg) => {
    if (msg.type !== 'offscreen-download') throw new Error('bad message');
    return startDownload(msg.url, msg.filename, msg.saveAs);
  },
  'open-options': () => chrome.runtime.openOptionsPage(),
};

chrome.runtime.onMessage.addListener((msg: ToBackground, sender, sendResponse) => {
  const handler = handlers[msg.type];
  if (!handler) return false;
  handler(msg, sender).then(
    (value) => {
      sendResponse({ ok: true, value });
    },
    (err: unknown) => {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    },
  );
  return true;
});

// ---------------------------------------------------------------------------
// Capturing

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastCaptureAt = 0;
let captureQueue: Promise<unknown> = Promise.resolve();

function minCaptureGap(): number {
  // Chrome allows MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND (2) calls per second.
  return Math.ceil(1000 / chrome.tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND) + 25;
}

/** Capture calls are queued so concurrent requests cannot trip the rate limit. */
function captureVisible(
  sender: chrome.runtime.MessageSender,
  progress?: { done: number; total: number },
): Promise<string> {
  const run = () => captureNow(sender, progress);
  const result = captureQueue.then(run, run);
  captureQueue = result.catch(() => undefined);
  return result;
}

async function captureNow(
  sender: chrome.runtime.MessageSender,
  progress?: { done: number; total: number },
): Promise<string> {
  const tab = sender.tab;
  if (tab?.id === undefined) throw new Error('No tab');
  if (sender.frameId !== 0) throw new Error('Only the top frame may capture');

  if (progress && progress.total > 1) {
    const pct = Math.round((progress.done / progress.total) * 100);
    void chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#0061e0' });
    void chrome.action.setBadgeText({ tabId: tab.id, text: `${pct}%` });
  }

  for (let attempt = 0; ; attempt++) {
    const wait = lastCaptureAt + minCaptureGap() - Date.now();
    if (wait > 0) await sleep(wait);
    // captureVisibleTab captures whatever tab is active in the window.
    const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (active?.id !== tab.id) throw new Error('tab-not-active');
    lastCaptureAt = Date.now();
    try {
      return await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch (err) {
      const quota = err instanceof Error && err.message.includes('MAX_CAPTURE_VISIBLE_TAB');
      if (!quota || attempt >= 3) throw err;
    }
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

async function startDownload(
  url: string,
  filename: string,
  saveAs: boolean,
): Promise<DownloadResult> {
  let id: number;
  try {
    id = await chrome.downloads.download({ url, filename, saveAs, conflictAction: 'uniquify' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, canceled: /cancel/i.test(message), error: message, settled: true };
  }
  const state = await waitForDownload(id, DOWNLOAD_SETTLE_MS);
  if (state.state === 'interrupted') {
    const canceled = state.error === 'USER_CANCELED';
    return { ok: false, canceled, error: state.error ?? 'interrupted', settled: true };
  }
  return { ok: true, settled: state.state === 'complete' };
}

function waitForDownload(
  id: number,
  timeoutMs: number,
): Promise<{ state: 'complete' | 'interrupted' | 'in_progress'; error?: string }> {
  return new Promise((resolve) => {
    const finish = (value: {
      state: 'complete' | 'interrupted' | 'in_progress';
      error?: string;
    }) => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve(value);
    };
    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== id) return;
      const s = delta.state?.current;
      if (s === 'complete') finish({ state: 'complete' });
      else if (s === 'interrupted') finish({ state: 'interrupted', error: delta.error?.current });
    };
    const timer = setTimeout(() => {
      finish({ state: 'in_progress' });
    }, timeoutMs);
    chrome.downloads.onChanged.addListener(onChanged);
    // It may already be done (small blobs finish almost instantly).
    void chrome.downloads.search({ id }).then(([item]) => {
      if (item?.state === 'complete') finish({ state: 'complete' });
      else if (item?.state === 'interrupted') finish({ state: 'interrupted', error: item.error });
    });
  });
}
