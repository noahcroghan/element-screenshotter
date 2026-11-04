/**
 * Short notices ("Copied to clipboard", errors). They live in their own
 * top-layer host so they can outlive the overlay.
 */

import { HOST_TAG, styleHost } from './host';

const CSS = `
:host { all: initial; }
.toast {
  position: fixed;
  left: 50%;
  bottom: 32px;
  transform: translateX(-50%);
  max-width: min(520px, calc(100vw - 32px));
  padding: 10px 16px;
  border-radius: 8px;
  background: #15141a;
  color: #fbfbfe;
  font: 14px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  animation: rise 160ms cubic-bezier(0.07, 0.95, 0, 1);
  pointer-events: none;
}
.toast.error { background: #c50042; }
@keyframes rise { from { opacity: 0; transform: translate(-50%, 8px); } }
@media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
`;

let sheet: CSSStyleSheet | null = null;
let current: { host: HTMLElement; timer: number } | null = null;

export type ToastKind = 'info' | 'error';

export function showToast(message: string, kind: ToastKind = 'info', durationMs = 3000) {
  hideToast();
  const host = document.createElement(HOST_TAG);
  host.dataset.role = 'toast';
  styleHost(host, { interactive: false });
  const root = host.attachShadow({ mode: 'closed' });
  sheet ??= new CSSStyleSheet();
  sheet.replaceSync(CSS);
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
