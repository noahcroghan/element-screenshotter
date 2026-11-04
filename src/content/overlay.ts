/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * The interaction model (states, drag threshold, mover handles, keyboard
 * moves, button placement) follows Firefox's
 * browser/components/screenshots/ScreenshotsOverlayChild.sys.mjs.
 *
 * States:
 *  crosshairs    Hover highlights an element. Arrow keys walk the element tree.
 *  draggingReady Pointer is down but has not moved far enough to drag.
 *  dragging      The user is drawing a region.
 *  selected      A region is selected; it can be moved, resized, copied or saved.
 *  resizing      A mover handle (or the whole region) is being dragged.
 *  capturing     We are taking pixels; the overlay is invisible.
 *  preview       The result of "Save visible" / "Save full page" is shown.
 */

import { buildFilename } from '../shared/filename';
import {
  clamp,
  clampRect,
  height,
  intersect,
  isEmpty,
  shiftInto,
  translate,
  width,
  type Point,
  type Rect,
} from '../shared/geometry';
import { t, type MessageKey } from '../shared/i18n';
import type { StartMode } from '../shared/messages';
import type { Settings } from '../shared/settings';
import { captureRegion, type CaptureResult } from './capture';
import { h, place } from './dom';
import {
  deepElementFromPoint,
  describeElement,
  detectLimitsForViewport,
  pickElement,
  topLevelRect,
  visibleChild,
  visibleParent,
  visibleSibling,
} from './element-picker';
import { HOST_TAG, styleHost } from './host';
import { face, icon, type Face } from './icons';
import {
  captureFinished,
  captureViewport,
  ClipboardUnavailableError,
  copyPng,
  download,
  encode,
} from './output';
import css from './overlay.css';
import { afterPaint, measurePage, viewportRect, type PageMetrics } from './page';
import { hideToast, showToast } from './toast';

type State =
  'crosshairs' | 'draggingReady' | 'dragging' | 'selected' | 'resizing' | 'capturing' | 'preview';

/** Minimum diagonal drag distance before a click becomes a drag (Firefox: 40). */
const DRAG_THRESHOLD = 40;
/** Auto-scroll when dragging within this many pixels of the viewport edge. */
const SCROLL_BY_EDGE = 20;

const MOVERS = [
  'topLeft',
  'top',
  'topRight',
  'right',
  'bottomRight',
  'bottom',
  'bottomLeft',
  'left',
] as const;
type Mover = (typeof MOVERS)[number];
const CORNERS: ReadonlySet<string> = new Set(['topLeft', 'topRight', 'bottomRight', 'bottomLeft']);

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const ACCEL = IS_MAC ? '⌘' : 'Ctrl+';

let sheet: CSSStyleSheet | null = null;

interface Elements {
  root: HTMLDivElement;
  preview: HTMLDivElement;
  face: Face;
  panel: HTMLDivElement;
  hover: HTMLDivElement;
  hoverLabel: HTMLDivElement;
  selection: HTMLDivElement;
  bgTop: HTMLDivElement;
  bgBottom: HTMLDivElement;
  bgLeft: HTMLDivElement;
  bgRight: HTMLDivElement;
  highlight: HTMLDivElement;
  size: HTMLSpanElement;
  buttons: HTMLDivElement;
  download: HTMLButtonElement;
  dialog: HTMLDivElement;
  dialogDownload: HTMLButtonElement;
  previewCanvas: HTMLCanvasElement;
}

/** Selection corners in page coordinates. They may be unsorted while dragging. */
interface Corners {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export class Overlay {
  readonly host: HTMLElement;
  #shadow: ShadowRoot;
  #el: Elements;
  #state: State = 'crosshairs';
  #metrics: PageMetrics;
  #listeners = new AbortController();
  #destroyed = false;

  // Hover / element navigation
  #hoverEl: Element | null = null;
  #hoverByKeyboard = false;
  #navStack: Element[] = [];
  #pointer: Point | null = null;
  #probeQueued = false;

  // Selection
  #sel: Corners = { x1: 0, y1: 0, x2: 0, y2: 0 };
  #selectedEl: Element | null = null;
  #mover: Mover | 'highlight' | null = null;
  #lastPage: Point = { x: 0, y: 0 };

  // Preview
  #previewResult: CaptureResult | null = null;

  constructor(
    private readonly settings: Settings,
    private readonly onClose: () => void,
  ) {
    this.host = document.createElement(HOST_TAG);
    styleHost(this.host, { interactive: true });
    this.#shadow = this.host.attachShadow({ mode: 'closed' });
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
    }
    this.#shadow.adoptedStyleSheets = [sheet];
    this.#el = this.#build();
    this.#shadow.append(this.#el.root);
    this.#metrics = measurePage();
  }

  get state(): State {
    return this.#state;
  }

  /** Read-only snapshot for tests and debugging (isolated world only). */
  snapshot() {
    const hover = this.#hoverEl ? topLevelRect(this.#hoverEl) : null;
    return {
      state: this.#state,
      hover: this.#hoverEl ? { label: describeElement(this.#hoverEl), rect: hover } : null,
      selection: this.#state === 'crosshairs' ? null : this.#selRect(),
      selectedElement: this.#selectedEl ? describeElement(this.#selectedEl) : null,
    };
  }

  mount(mode: StartMode) {
    document.documentElement.append(this.host);
    try {
      this.host.showPopover();
    } catch {
      // Fall back to the z-index set in styleHost.
    }
    this.#listen();
    this.#setState('crosshairs');
    this.#el.root.focus({ preventScroll: true });
    if (mode === 'visible' || mode === 'fullpage') void this.#captureForPreview(mode);
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#listeners.abort();
    this.host.remove();
    this.onClose();
  }

  // ---------------------------------------------------------------------------
  // DOM

  #build(): Elements {
    const btn = (
      id: string,
      label: MessageKey | null,
      opts: {
        icon?: Parameters<typeof icon>[0];
        primary?: boolean;
        ghost?: boolean;
        title?: string;
        aria?: string;
      } = {},
    ) => {
      const b = h('button', {
        id,
        type: 'button',
        class: [opts.primary && 'primary', opts.ghost && 'ghost', !label && 'icon']
          .filter(Boolean)
          .join(' '),
        title: opts.title,
        'aria-label': opts.aria,
      });
      if (opts.icon) b.append(icon(opts.icon));
      if (label) b.append(h('span', {}, t(label)));
      return b;
    };

    const theFace = face();
    const preview = h(
      'div',
      { id: 'preview' },
      h('div', { id: 'face' }, theFace.root),
      h('div', { id: 'instructions' }, t('instructions')),
      h('div', { id: 'nav-hint' }, t('navHint')),
      btn('preview-cancel', 'cancel', { ghost: true, title: t('cancelTitle') }),
    );

    const panel = h(
      'div',
      { id: 'panel' },
      btn('save-visible', 'saveVisible'),
      btn('save-fullpage', 'saveFullPage', { primary: true }),
    );

    const hover = h('div', { id: 'hover', hidden: true });
    const hoverLabel = h('div', { id: 'hover-label', hidden: true, 'aria-live': 'polite' });

    const size = h('span', { id: 'size' });
    const highlight = h(
      'div',
      { id: 'highlight', tabindex: 0, role: 'group', 'aria-label': t('selectionLabel') },
      ...MOVERS.map((m) =>
        h(
          'div',
          {
            id: `mover-${m}`,
            class: CORNERS.has(m) ? 'mover-target' : 'mover-target edge',
            tabindex: CORNERS.has(m) ? 0 : undefined,
            role: CORNERS.has(m) ? 'button' : undefined,
            'aria-label': CORNERS.has(m) ? t('resizeHandleLabel') : undefined,
          },
          h('div', { class: 'mover' }),
        ),
      ),
      h('div', { id: 'size-wrap' }, size),
    );
    const bgTop = h('div', { class: 'bg' });
    const bgBottom = h('div', { class: 'bg' });
    const bgLeft = h('div', { class: 'bg' });
    const bgRight = h('div', { class: 'bg' });
    const selection = h(
      'div',
      { id: 'selection', hidden: true },
      bgTop,
      bgBottom,
      bgLeft,
      bgRight,
      highlight,
    );

    const downloadBtn = btn('download', 'download', {
      icon: 'download',
      primary: true,
      title: t('downloadTitle', `${ACCEL}S`),
    });
    const buttons = h(
      'div',
      { id: 'buttons', hidden: true },
      btn('cancel', null, { icon: 'close', title: t('cancelTitle'), aria: t('cancel') }),
      btn('copy', 'copy', { icon: 'copy', title: t('copyTitle', `${ACCEL}C`) }),
      downloadBtn,
    );

    const dialogDownload = btn('dialog-download', 'download', {
      icon: 'download',
      primary: true,
      title: t('downloadTitle', `${ACCEL}S`),
    });
    const previewCanvas = h('canvas', { id: 'preview-canvas' });
    const dialog = h(
      'div',
      {
        id: 'dialog',
        hidden: true,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('dialogLabel'),
      },
      h(
        'div',
        { id: 'dialog-bar' },
        btn('dialog-retry', null, { icon: 'retry', title: t('retryTitle'), aria: t('retry') }),
        btn('dialog-cancel', null, { icon: 'close', title: t('cancelTitle'), aria: t('cancel') }),
        btn('dialog-copy', 'copy', { icon: 'copy', title: t('copyTitle', `${ACCEL}C`) }),
        dialogDownload,
      ),
      h('div', { id: 'dialog-body' }, previewCanvas),
    );

    const root = h(
      'div',
      { id: 'root', tabindex: -1 },
      preview,
      panel,
      hover,
      hoverLabel,
      selection,
      buttons,
      dialog,
    );

    return {
      root,
      preview,
      face: theFace,
      panel,
      hover,
      hoverLabel,
      selection,
      bgTop,
      bgBottom,
      bgLeft,
      bgRight,
      highlight,
      size,
      buttons,
      download: downloadBtn,
      dialog,
      dialogDownload,
      previewCanvas,
    };
  }

  // ---------------------------------------------------------------------------
  // Events

  #listen() {
    const signal = this.#listeners.signal;
    const root = this.#el.root;
    root.addEventListener(
      'pointerdown',
      (e) => {
        this.#onPointerDown(e);
      },
      { signal },
    );
    root.addEventListener(
      'pointermove',
      (e) => {
        this.#onPointerMove(e);
      },
      { signal },
    );
    root.addEventListener(
      'pointerup',
      (e) => {
        this.#onPointerUp(e);
      },
      { signal },
    );
    root.addEventListener(
      'pointercancel',
      (e) => {
        this.#onPointerUp(e);
      },
      { signal },
    );
    root.addEventListener(
      'click',
      (e) => {
        this.#onClick(e);
      },
      { signal },
    );

    // Keep page handlers from seeing interaction with the overlay.
    for (const type of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'click',
      'dblclick',
      'auxclick',
      'mousedown',
      'mousemove',
      'mouseup',
      'mouseover',
      'mouseout',
      'contextmenu',
      'touchstart',
      'touchmove',
      'touchend',
      'wheel',
    ]) {
      root.addEventListener(
        type,
        (e) => {
          e.stopPropagation();
        },
        { signal, passive: true },
      );
    }

    // Keys are handled at the very start of dispatch so the page cannot
    // swallow Escape, and page shortcuts do not fire while we are open.
    window.addEventListener(
      'keydown',
      (e) => {
        this.#onKeyDown(e);
      },
      { capture: true, signal },
    );
    for (const type of ['keyup', 'keypress']) {
      window.addEventListener(
        type,
        (e) => {
          e.stopImmediatePropagation();
        },
        { capture: true, signal },
      );
    }
    window.addEventListener(
      'scroll',
      () => {
        this.#onScroll();
      },
      { passive: true, signal },
    );
    window.addEventListener(
      'resize',
      () => {
        this.#onResize();
      },
      { passive: true, signal },
    );
    window.addEventListener(
      'pagehide',
      () => {
        this.destroy();
      },
      { signal },
    );
  }

  #pagePoint(e: { clientX: number; clientY: number }): Point {
    const b = this.#metrics.bounds;
    return {
      x: clamp(e.clientX + window.scrollX, b.left, b.right),
      y: clamp(e.clientY + window.scrollY, b.top, b.bottom),
    };
  }

  #isUiControl(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest('button, #panel, #buttons, #dialog');
  }

  #onPointerDown(e: PointerEvent) {
    if (e.button !== 0) {
      this.#cancelPointerGesture();
      return;
    }
    if (this.#isUiControl(e.target)) return;
    const p = this.#pagePoint(e);
    const target = e.target as Element;

    switch (this.#state) {
      case 'crosshairs':
        this.#sel = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
        this.#el.root.setPointerCapture(e.pointerId);
        this.#setState('draggingReady');
        break;
      case 'selected': {
        const moverEl = target.closest('.mover-target, #highlight');
        if (!moverEl) {
          this.#setState('crosshairs');
          return;
        }
        this.#mover = moverEl.id === 'highlight' ? 'highlight' : (moverEl.id.slice(6) as Mover);
        this.#normalizeSelection();
        this.#lastPage = p;
        this.#el.root.setPointerCapture(e.pointerId);
        this.#setState('resizing');
        break;
      }
      default:
        break;
    }
  }

  #onPointerMove(e: PointerEvent) {
    switch (this.#state) {
      case 'crosshairs': {
        if (this.#pointer && this.#pointer.x === e.clientX && this.#pointer.y === e.clientY) return;
        this.#pointer = { x: e.clientX, y: e.clientY };
        this.#drawEyes(e.clientX, e.clientY);
        this.#queueProbe();
        break;
      }
      case 'draggingReady': {
        const p = this.#pagePoint(e);
        this.#sel.x2 = p.x;
        this.#sel.y2 = p.y;
        if (Math.hypot(this.#sel.x2 - this.#sel.x1, this.#sel.y2 - this.#sel.y1) > DRAG_THRESHOLD) {
          this.#setState('dragging');
        }
        break;
      }
      case 'dragging': {
        this.#scrollIfByEdge(e.clientX, e.clientY);
        const p = this.#pagePoint(e);
        this.#sel.x2 = p.x;
        this.#sel.y2 = p.y;
        this.#drawSelection();
        break;
      }
      case 'resizing':
        this.#scrollIfByEdge(e.clientX, e.clientY);
        this.#resizeTo(this.#pagePoint(e));
        this.#drawSelection();
        break;
      default:
        break;
    }
  }

  #onPointerUp(e: PointerEvent) {
    if (this.#el.root.hasPointerCapture(e.pointerId)) {
      this.#el.root.releasePointerCapture(e.pointerId);
    }
    switch (this.#state) {
      case 'draggingReady':
        if (this.#hoverEl) this.#selectElement(this.#hoverEl);
        else this.#setState('crosshairs');
        break;
      case 'dragging': {
        const p = this.#pagePoint(e);
        this.#sel.x2 = p.x;
        this.#sel.y2 = p.y;
        this.#selectedEl = null;
        this.#setState('selected');
        break;
      }
      case 'resizing':
        this.#resizeTo(this.#pagePoint(e));
        this.#setState('selected', { keepFocus: true });
        break;
      default:
        break;
    }
  }

  /** A non-primary button press aborts the current gesture, as in Firefox. */
  #cancelPointerGesture() {
    if (this.#state === 'draggingReady') this.#setState('crosshairs');
    else if (this.#state === 'dragging' || this.#state === 'resizing') this.#setState('selected');
  }

  #onClick(e: MouseEvent) {
    const button = e.target instanceof Element ? e.target.closest('button') : null;
    if (!button) return;
    switch (button.id) {
      case 'preview-cancel':
      case 'dialog-cancel':
        this.destroy();
        break;
      case 'cancel':
        this.#setState('crosshairs');
        break;
      case 'save-visible':
        void this.#captureForPreview('visible');
        break;
      case 'save-fullpage':
        void this.#captureForPreview('fullpage');
        break;
      case 'copy':
        this.#copySelection();
        break;
      case 'download':
        void this.#downloadSelection();
        break;
      case 'dialog-retry':
        this.#previewResult = null;
        this.#setState('crosshairs');
        break;
      case 'dialog-copy':
        this.#copyPreview();
        break;
      case 'dialog-download':
        void this.#downloadPreview();
        break;
    }
  }

  #onKeyDown(e: KeyboardEvent) {
    // Everything stops here; only keys we act on lose their default action.
    e.stopImmediatePropagation();
    if (this.#handleKey(e)) e.preventDefault();
  }

  /** Returns true when the key was consumed. */
  #handleKey(e: KeyboardEvent): boolean {
    const accel = IS_MAC ? e.metaKey : e.ctrlKey;
    const key = e.key;
    const focused = this.#shadow.activeElement;
    const onButton = focused instanceof HTMLButtonElement;

    if (key === 'Escape') {
      if (this.#state === 'crosshairs' || this.#state === 'preview') this.destroy();
      else if (this.#state !== 'capturing') this.#setState('crosshairs');
      return true;
    }
    if (key === 'Tab') return this.#trapFocus(e.shiftKey);

    switch (this.#state) {
      case 'crosshairs':
        if (key.startsWith('Arrow')) {
          this.#navigate(key);
          return true;
        }
        if ((key === 'Enter' || key === ' ') && !onButton) {
          if (this.#hoverEl) this.#selectElement(this.#hoverEl);
          return true;
        }
        return false;
      case 'selected':
      case 'resizing':
        if (key.startsWith('Arrow')) return this.#keyboardResize(e, focused);
        if (accel && key.toLowerCase() === 'c') {
          this.#copySelection();
          return true;
        }
        if (accel && key.toLowerCase() === 's') {
          void this.#downloadSelection();
          return true;
        }
        return false;
      case 'preview':
        if (accel && key.toLowerCase() === 'c') {
          this.#copyPreview();
          return true;
        }
        if (accel && key.toLowerCase() === 's') {
          void this.#downloadPreview();
          return true;
        }
        return false;
      case 'capturing':
        return true;
      default:
        return false;
    }
  }

  #onScroll() {
    this.#metrics = measurePage();
    switch (this.#state) {
      case 'crosshairs':
        if (this.#hoverByKeyboard || !this.#pointer) this.#drawHover();
        else this.#queueProbe();
        break;
      case 'dragging':
      case 'selected':
      case 'resizing':
        this.#drawSelection();
        if (this.#state === 'selected') this.#drawButtons();
        break;
      default:
        break;
    }
  }

  #onResize() {
    this.#metrics = measurePage();
    if (this.#state === 'crosshairs') {
      this.#setHover(null);
    } else if (this.#state === 'selected') {
      const r = shiftInto(this.#selRect(), this.#metrics.bounds);
      this.#sel = { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom };
      this.#drawSelection();
      this.#drawButtons();
    } else if (this.#state === 'preview' && this.#previewResult) {
      this.#drawPreview(this.#previewResult.canvas);
    }
  }

  // ---------------------------------------------------------------------------
  // State

  #setState(next: State, opts: { keepFocus?: boolean } = {}) {
    const prev = this.#state;
    this.#state = next;
    const el = this.#el;
    el.root.className = next === 'capturing' ? 'capturing' : next === 'resizing' ? 'dragging' : '';

    const crosshairs = next === 'crosshairs';
    const selecting = next === 'dragging' || next === 'selected' || next === 'resizing';
    el.preview.hidden = !crosshairs;
    el.panel.hidden = !crosshairs;
    el.hover.hidden = !crosshairs || !this.#hoverEl;
    el.hoverLabel.hidden = el.hover.hidden;
    el.selection.hidden = !selecting && !(next === 'capturing' && prev !== 'crosshairs');
    el.buttons.hidden = next !== 'selected';
    el.dialog.hidden = next !== 'preview';

    switch (next) {
      case 'crosshairs':
        this.#selectedEl = null;
        if (prev !== 'crosshairs') {
          this.#setHover(null);
          this.#el.root.focus({ preventScroll: true });
        }
        break;
      case 'dragging':
        this.#drawSelection();
        break;
      case 'selected':
        this.#normalizeSelection();
        this.#drawSelection();
        this.#drawButtons();
        if (!opts.keepFocus) el.download.focus({ preventScroll: true, focusVisible: true });
        break;
      case 'preview':
        el.dialogDownload.focus({ preventScroll: true });
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Hover and element-tree navigation

  #queueProbe() {
    if (this.#probeQueued) return;
    this.#probeQueued = true;
    requestAnimationFrame(() => {
      this.#probeQueued = false;
      if (this.#state !== 'crosshairs' || !this.#pointer || this.#destroyed) return;
      this.#probe(this.#pointer.x, this.#pointer.y);
    });
  }

  /** Find the element under a client point, looking "through" the overlay like Firefox does. */
  #probe(x: number, y: number) {
    const root = this.#el.root;
    // The host must be transparent to hit testing too, not just its contents.
    this.host.style.setProperty('pointer-events', 'none', 'important');
    root.classList.add('probing');
    let hit: Element | null;
    try {
      hit = deepElementFromPoint(document, x, y, this.host);
    } finally {
      root.classList.remove('probing');
      this.host.style.setProperty('pointer-events', 'auto', 'important');
    }
    const limits = detectLimitsForViewport(this.#metrics.clientWidth, this.#metrics.clientHeight);
    const picked = hit ? pickElement(hit, this.settings.elementDetection, limits) : null;
    this.#navStack = [];
    this.#hoverByKeyboard = false;
    this.#setHover(picked);
  }

  #setHover(el: Element | null) {
    this.#hoverEl = el;
    this.#drawHover();
  }

  #navigate(key: string) {
    let current = this.#hoverEl;
    if (!current) {
      // Start from the element under the pointer, or the middle of the viewport.
      const x = this.#pointer?.x ?? this.#metrics.clientWidth / 2;
      const y = this.#pointer?.y ?? this.#metrics.clientHeight / 2;
      this.#probe(x, y);
      return;
    }
    let next: Element | null = null;
    switch (key) {
      case 'ArrowUp':
        next = visibleParent(current);
        if (next) this.#navStack.push(current);
        break;
      case 'ArrowDown':
        next = this.#navStack.pop() ?? visibleChild(current, this.#pointer);
        break;
      case 'ArrowLeft':
        next = visibleSibling(current, -1);
        if (next) this.#navStack = [];
        break;
      case 'ArrowRight':
        next = visibleSibling(current, 1);
        if (next) this.#navStack = [];
        break;
    }
    if (!next) return;
    current = next;
    this.#hoverByKeyboard = true;
    this.#setHover(current);
    this.#ensureVisible(current);
  }

  /** Scroll so a keyboard-chosen element is at least partly on screen. */
  #ensureVisible(el: Element) {
    const r = topLevelRect(el);
    if (!r) return;
    const vw = this.#metrics.clientWidth;
    const vh = this.#metrics.clientHeight;
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }
  }

  #drawHover() {
    const { hover, hoverLabel } = this.#el;
    const el = this.#hoverEl;
    const r = el?.isConnected ? topLevelRect(el) : null;
    if (!el || !r || this.#state !== 'crosshairs') {
      hover.hidden = true;
      hoverLabel.hidden = true;
      return;
    }
    hover.hidden = false;
    hover.classList.toggle('keyboard', this.#hoverByKeyboard);
    place(hover, { left: r.left, top: r.top, width: width(r), height: height(r) });

    hoverLabel.hidden = false;
    hoverLabel.replaceChildren(
      describeElement(el),
      h('span', { class: 'dim' }, `  ${Math.round(width(r))} × ${Math.round(height(r))}`),
    );
    const labelH = 22;
    const vw = this.#metrics.clientWidth;
    const vh = this.#metrics.clientHeight;
    let top = r.top - labelH - 4;
    if (top < 4) top = r.bottom + 4;
    if (top + labelH > vh - 4) top = Math.max(4, r.top + 4);
    place(hoverLabel, { left: clamp(r.left, 4, Math.max(4, vw - 220)), top });
  }

  #drawEyes(clientX: number, clientY: number) {
    const { clientWidth, clientHeight } = this.#metrics;
    const x = Math.floor((10 * (clientX - clientWidth / 2)) / clientWidth);
    const y = Math.floor((10 * (clientY - clientHeight / 2)) / clientHeight);
    const transform = `translate(${x}px, ${y}px)`;
    this.#el.face.leftPupil.style.transform = transform;
    this.#el.face.rightPupil.style.transform = transform;
  }

  // ---------------------------------------------------------------------------
  // Selection

  #selRect(): Rect {
    const s = this.#sel;
    return {
      left: Math.min(s.x1, s.x2),
      top: Math.min(s.y1, s.y2),
      right: Math.max(s.x1, s.x2),
      bottom: Math.max(s.y1, s.y2),
    };
  }

  #normalizeSelection() {
    const r = this.#selRect();
    this.#sel = { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom };
  }

  #selectElement(el: Element) {
    const r = topLevelRect(el);
    if (!r) return;
    const page = clampRect(translate(r, window.scrollX, window.scrollY), this.#metrics.bounds);
    if (isEmpty(page)) return;
    this.#sel = { x1: page.left, y1: page.top, x2: page.right, y2: page.bottom };
    this.#selectedEl = el;
    this.#setState('selected');
  }

  #resizeTo(p: Point) {
    const s = this.#sel;
    switch (this.#mover) {
      case 'topLeft':
        s.x1 = p.x;
        s.y1 = p.y;
        break;
      case 'top':
        s.y1 = p.y;
        break;
      case 'topRight':
        s.x2 = p.x;
        s.y1 = p.y;
        break;
      case 'right':
        s.x2 = p.x;
        break;
      case 'bottomRight':
        s.x2 = p.x;
        s.y2 = p.y;
        break;
      case 'bottom':
        s.y2 = p.y;
        break;
      case 'bottomLeft':
        s.x1 = p.x;
        s.y2 = p.y;
        break;
      case 'left':
        s.x1 = p.x;
        break;
      case 'highlight': {
        const moved = shiftInto(
          translate(this.#selRect(), p.x - this.#lastPage.x, p.y - this.#lastPage.y),
          this.#metrics.bounds,
        );
        this.#sel = { x1: moved.left, y1: moved.top, x2: moved.right, y2: moved.bottom };
        this.#lastPage = p;
        break;
      }
      case null:
        break;
    }
  }

  /**
   * Arrow keys in the selected state, following Firefox: on the region they
   * move it, on a corner handle they move that corner. Shift moves by 10px.
   */
  #keyboardResize(e: KeyboardEvent, focused: Element | null): boolean {
    const id = focused?.id ?? '';
    const isHighlight = id === 'highlight';
    const corner = id.startsWith('mover-') ? id.slice(6) : '';
    if (!isHighlight && !CORNERS.has(corner)) return false;

    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    const b = this.#metrics.bounds;
    this.#normalizeSelection();
    const s = this.#sel;

    if (isHighlight) {
      const moved = shiftInto(translate(this.#selRect(), dx, dy), b);
      this.#sel = { x1: moved.left, y1: moved.top, x2: moved.right, y2: moved.bottom };
    } else {
      if (corner.endsWith('Left')) s.x1 = clamp(s.x1 + dx, b.left, s.x2 - 1);
      else s.x2 = clamp(s.x2 + dx, s.x1 + 1, b.right);
      if (corner.startsWith('top')) s.y1 = clamp(s.y1 + dy, b.top, s.y2 - 1);
      else s.y2 = clamp(s.y2 + dy, s.y1 + 1, b.bottom);
    }
    this.#scrollSelectionIntoView();
    this.#drawSelection();
    this.#drawButtons();
    return true;
  }

  #scrollSelectionIntoView() {
    const view = viewportRect(measurePage());
    const r = this.#selRect();
    if (!intersect(view, r)) {
      window.scrollTo({ left: r.left - 20, top: r.top - 20, behavior: 'instant' });
    }
  }

  #scrollIfByEdge(clientX: number, clientY: number) {
    const { clientWidth, clientHeight } = this.#metrics;
    let dx = 0;
    let dy = 0;
    if (clientY < SCROLL_BY_EDGE) dy = -(SCROLL_BY_EDGE - clientY);
    else if (clientHeight - clientY < SCROLL_BY_EDGE)
      dy = SCROLL_BY_EDGE - (clientHeight - clientY);
    if (clientX <= SCROLL_BY_EDGE) dx = -(SCROLL_BY_EDGE - clientX);
    else if (clientWidth - clientX <= SCROLL_BY_EDGE) dx = SCROLL_BY_EDGE - (clientWidth - clientX);
    if (dx || dy) {
      window.scrollBy({ left: dx, top: dy, behavior: 'instant' });
      this.#metrics = measurePage();
    }
  }

  #drawSelection() {
    const el = this.#el;
    const r = translate(this.#selRect(), -window.scrollX, -window.scrollY);
    const w = width(r);
    const hgt = height(r);
    const vw = this.#metrics.clientWidth;
    const vh = this.#metrics.clientHeight;

    place(el.highlight, { left: r.left, top: r.top, width: w, height: hgt });
    el.highlight.classList.toggle('small', w < 40 || hgt < 40);
    place(el.bgTop, { left: 0, top: 0, width: vw, height: Math.max(0, r.top) });
    place(el.bgBottom, { left: 0, top: r.bottom, width: vw, height: Math.max(0, vh - r.bottom) });
    place(el.bgLeft, { left: 0, top: r.top, width: Math.max(0, r.left), height: hgt });
    place(el.bgRight, { left: r.right, top: r.top, width: Math.max(0, vw - r.right), height: hgt });
    el.size.textContent = t('selectionSize', [String(Math.round(w)), String(Math.round(hgt))]);
  }

  /** Put the action bar under the bottom-right of the selection, kept on screen (Firefox's rules). */
  #drawButtons() {
    const { buttons } = this.#el;
    const r = translate(this.#selRect(), -window.scrollX, -window.scrollY);
    const vw = this.#metrics.clientWidth;
    const vh = this.#metrics.clientHeight;
    if (!intersect(r, { left: 0, top: 0, right: vw, bottom: vh })) {
      buttons.hidden = true;
      return;
    }
    buttons.hidden = false;
    let top = r.bottom;
    if (vh - r.bottom < 70) {
      if (r.bottom < vh) top = r.bottom - 60;
      else if (vh - r.top < 70) top = r.top - 60;
      else top = vh - 60;
    }
    const bw = Math.ceil(buttons.getBoundingClientRect().width);
    const rightEdge = Math.max(Math.min(vw, r.right), bw);
    place(buttons, { top: Math.max(0, top), left: null, right: vw - rightEdge });
  }

  #trapFocus(backwards: boolean): boolean {
    const candidates = Array.from(
      this.#shadow.querySelectorAll<HTMLElement>('button, [tabindex="0"]'),
    ).filter((el) => el.getClientRects().length > 0);
    if (candidates.length === 0) return true;
    const active = this.#shadow.activeElement;
    const i = candidates.findIndex((c) => c === active);
    const next =
      i === -1
        ? candidates[backwards ? candidates.length - 1 : 0]
        : candidates[(i + (backwards ? -1 : 1) + candidates.length) % candidates.length];
    next?.focus({ preventScroll: true });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Capturing and output

  async #capture(
    region: Rect,
    keep: Element | null,
    fixedElements: 'first-tile' | 'as-seen',
  ): Promise<CaptureResult> {
    hideToast();
    this.#setState('capturing');
    await afterPaint();
    try {
      return await captureRegion({
        region,
        keep,
        fixedElements,
        ignore: [this.host],
        captureViewport,
      });
    } finally {
      captureFinished();
    }
  }

  #copySelection() {
    if (this.#state !== 'selected') return;
    if (!clipboardAvailable()) {
      showToast(t('errorClipboardInsecure'), 'error', 6000);
      return;
    }
    const capture = this.#capture(this.#selRect(), this.#selectedEl, 'as-seen');
    // Start the clipboard write now, inside the user gesture.
    const written = copyPng(capture.then((r) => r.canvas.convertToBlob({ type: 'image/png' })));
    Promise.all([capture, written]).then(
      ([r]) => {
        this.destroy();
        showToast(
          r.cropped ? `${t('copied')}. ${t('cropped')}` : t('copied'),
          'info',
          r.cropped ? 6000 : 2500,
        );
      },
      (err: unknown) => {
        this.#fail(err, 'copy', 'selected');
      },
    );
  }

  async #downloadSelection() {
    if (this.#state !== 'selected') return;
    try {
      const r = await this.#capture(this.#selRect(), this.#selectedEl, 'as-seen');
      await this.#save(r, 'selected');
    } catch (err) {
      this.#fail(err, 'capture', 'selected');
    }
  }

  async #captureForPreview(kind: 'visible' | 'fullpage') {
    const m = measurePage();
    const region = kind === 'visible' ? viewportRect(m) : m.bounds;
    try {
      const r = await this.#capture(region, null, 'first-tile');
      this.#previewResult = r;
      this.#setState('preview');
      this.#drawPreview(r.canvas);
      if (r.cropped) showToast(t('cropped'), 'info', 6000);
    } catch (err) {
      this.#fail(err, 'capture', 'crosshairs');
    }
  }

  #drawPreview(source: OffscreenCanvas) {
    const canvas = this.#el.previewCanvas;
    const dpr = window.devicePixelRatio || 1;
    const maxCss = Math.max(100, this.#metrics.clientWidth - 32);
    const cssWidth = Math.min(source.width / dpr, maxCss);
    const scale = (cssWidth * dpr) / source.width;
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    canvas.style.width = `${cssWidth}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }

  #copyPreview() {
    const r = this.#previewResult;
    if (!r || this.#state !== 'preview') return;
    if (!clipboardAvailable()) {
      showToast(t('errorClipboardInsecure'), 'error', 6000);
      return;
    }
    copyPng(r.canvas.convertToBlob({ type: 'image/png' })).then(
      () => {
        this.destroy();
        showToast(t('copied'), 'info', 2500);
      },
      (err: unknown) => {
        this.#fail(err, 'copy', 'preview');
      },
    );
  }

  async #downloadPreview() {
    const r = this.#previewResult;
    if (!r || this.#state !== 'preview') return;
    this.#el.dialog.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      await this.#save(r, 'preview');
    } catch (err) {
      this.#fail(err, 'download', 'preview');
    } finally {
      this.#el.dialog.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  }

  /** Encode and download; on cancel or error, return to `back`. */
  async #save(r: CaptureResult, back: 'selected' | 'preview') {
    const { format, jpegQuality, saveAs, folder } = this.settings;
    const blob = await encode(r.canvas, format, jpegQuality);
    const filename = buildFilename({ title: document.title, date: new Date(), format, folder });
    const outcome = await download(blob, filename, saveAs);
    if (outcome.ok) {
      this.destroy();
      if (r.cropped) showToast(t('cropped'), 'info', 6000);
      return;
    }
    if (this.#destroyed) return;
    this.#setState(back);
    if (!outcome.canceled) showToast(t('errorDownload', outcome.error ?? ''), 'error', 6000);
  }

  #fail(err: unknown, kind: 'copy' | 'capture' | 'download', back: State) {
    console.error('[Element Screenshotter]', err);
    if (this.#destroyed) return;
    this.#setState(back === 'preview' && !this.#previewResult ? 'crosshairs' : back);
    showToast(errorMessage(err, kind), 'error', 6000);
  }
}

function clipboardAvailable(): boolean {
  return window.isSecureContext && 'clipboard' in navigator && typeof ClipboardItem !== 'undefined';
}

function errorMessage(err: unknown, kind: 'copy' | 'capture' | 'download'): string {
  if (err instanceof ClipboardUnavailableError) return t('errorClipboardInsecure');
  let detail = err instanceof Error ? err.message : String(err);
  if (detail === 'tab-not-active') detail = t('errorTabNotActive');
  const key =
    kind === 'copy' ? 'errorClipboard' : kind === 'download' ? 'errorDownload' : 'errorCapture';
  return t(key, detail);
}
