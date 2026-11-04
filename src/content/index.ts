/**
 * Content script entry point. Injected on demand by the service worker with
 * chrome.scripting.executeScript, possibly many times into the same page;
 * only the first injection per extension instance sets anything up.
 */

import type { StartMode, ToContent } from '../shared/messages';
import { loadSettings } from '../shared/settings';
import { removeStaleHosts } from './host';
import { loadLastSaveMethod, Overlay } from './overlay';

interface ContentApi {
  start(mode: StartMode, toggle: boolean): Promise<void>;
  /** Overlay state for tests; lives in the isolated world, invisible to pages. */
  snapshot(): ReturnType<Overlay['snapshot']> | null;
}

declare global {
  var __elementScreenshotter: ContentApi | undefined;
}

function isStartMessage(msg: unknown): msg is ToContent {
  return typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'start';
}

function init(): ContentApi {
  let overlay: Overlay | null = null;
  let starting = false;

  async function start(mode: StartMode, toggle: boolean) {
    if (overlay) {
      // Clicking the toolbar button again closes the overlay, as in Firefox.
      if (toggle && mode === 'select') {
        overlay.destroy();
        return;
      }
      overlay.destroy();
    }
    if (starting) return;
    starting = true;
    try {
      const [settings, lastSaveMethod] = await Promise.all([loadSettings(), loadLastSaveMethod()]);
      overlay = new Overlay(
        settings,
        () => {
          overlay = null;
        },
        lastSaveMethod,
      );
      overlay.mount(mode);
    } finally {
      starting = false;
    }
  }

  chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
    if (!isStartMessage(raw)) return false;
    const msg = raw;
    start(msg.mode, msg.toggle).then(
      () => {
        sendResponse({ ok: true });
      },
      (err: unknown) => {
        console.error('[Element Screenshotter]', err);
        sendResponse({ ok: false, error: String(err) });
      },
    );
    return true;
  });

  return {
    start,
    snapshot: () => overlay?.snapshot() ?? null,
  };
}

if (!globalThis.__elementScreenshotter) {
  // A previous version of the extension may have left its UI behind.
  removeStaleHosts();
  globalThis.__elementScreenshotter = init();
}
