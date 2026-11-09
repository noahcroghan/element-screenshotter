/**
 * Content script entry point. Injected on demand by the service worker with
 * chrome.scripting.executeScript, possibly many times into the same page;
 * only the first injection per extension instance sets anything up.
 */

import type { ToContent } from '../shared/messages';
import { loadSettings } from '../shared/settings';
import { removeStaleHosts } from './host';
import { loadRemembered, Overlay } from './overlay';

interface ContentApi {
  toggle(): Promise<void>;
  /** Overlay state for tests; lives in the isolated world, invisible to pages. */
  snapshot(): ReturnType<Overlay['snapshot']> | null;
}

declare global {
  var __elementScreenshotter: ContentApi | undefined;
}

function isToggleMessage(message: unknown): message is ToContent {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'toggle'
  );
}

function init(): ContentApi {
  let overlay: Overlay | null = null;
  let starting = false;

  /** Open the overlay, or close it if it is already open (as in Firefox). */
  async function toggle() {
    if (overlay) {
      overlay.destroy();
      return;
    }
    if (starting) return;
    starting = true;
    try {
      const [settings, remembered] = await Promise.all([loadSettings(), loadRemembered()]);
      overlay = new Overlay(
        settings,
        () => {
          overlay = null;
        },
        remembered,
      );
      overlay.mount();
    } finally {
      starting = false;
    }
  }

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isToggleMessage(message)) return false;
    toggle().then(
      () => {
        sendResponse({ ok: true });
      },
      (error: unknown) => {
        console.error('[Element Screenshotter]', error);
        sendResponse({ ok: false, error: String(error) });
      },
    );
    return true;
  });

  return {
    toggle,
    snapshot: () => overlay?.snapshot() ?? null,
  };
}

if (!globalThis.__elementScreenshotter) {
  // A previous version of the extension may have left its UI behind.
  removeStaleHosts();
  globalThis.__elementScreenshotter = init();
}
