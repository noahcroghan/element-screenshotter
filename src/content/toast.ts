/**
 * Short notices ("Copied to clipboard", errors). They live in their own
 * top-layer host so they can outlive the overlay.
 */

import { HOST_TAG, styleHost } from './host';
import css from './toast.css';

let sheet: CSSStyleSheet | null = null;
let current: { host: HTMLElement; timer: number } | null = null;

export type ToastKind = 'info' | 'error';

export function showToast(message: string, kind: ToastKind = 'info', durationMs = 3000) {
  hideToast();
  const host = document.createElement(HOST_TAG);
  host.dataset.role = 'toast';
  styleHost(host, { interactive: false });
  const root = host.attachShadow({ mode: 'closed' });
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
  }
  root.adoptedStyleSheets = [sheet];
  const box = document.createElement('div');
  box.className = `toast ${kind}`;
  box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  box.textContent = message;
  root.append(box);
  document.documentElement.append(host);
  try {
    host.showPopover();
  } catch {
    // Popover unsupported or the document is in an odd state; z-index fallback applies.
  }
  current = { host, timer: window.setTimeout(hideToast, durationMs) };
}

export function hideToast() {
  if (!current) return;
  window.clearTimeout(current.timer);
  current.host.remove();
  current = null;
}
