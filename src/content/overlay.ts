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
import { localize, type MessageKey } from '../shared/i18n';
import type { Settings } from '../shared/settings';
import { captureRegion, type CaptureResult } from './capture';
import { buildElement, place } from './dom';
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
import { face, icon, type Face, type IconName } from './icons';
import {
  captureFinished,
  captureViewport,
  ClipboardUnavailableError,
  copyPng,
  download,
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

/** Which selection coordinates each mover handle controls. */
const MOVER_EDGES = {
  topLeft: ['x1', 'y1'],
  top: ['y1'],
  topRight: ['x2', 'y1'],
  right: ['x2'],
  bottomRight: ['x2', 'y2'],
  bottom: ['y2'],
  bottomLeft: ['x1', 'y2'],
  left: ['x1'],
} as const satisfies Record<string, readonly (keyof Corners)[]>;
type Mover = keyof typeof MOVER_EDGES;
const MOVERS = Object.keys(MOVER_EDGES) as Mover[];
const CORNERS: ReadonlySet<string> = new Set(['topLeft', 'topRight', 'bottomRight', 'bottomLeft']);

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const ACCEL = IS_MAC ? 'Cmd+' : 'Ctrl+';

/** How long notices stay up, in milliseconds. */
const SHORT_NOTICE_MS = 2500;
const LONG_NOTICE_MS = 6000;

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
  copy: HTMLButtonElement;
  download: HTMLButtonElement;
  dialog: HTMLDivElement;
  dialogCopy: HTMLButtonElement;
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

function cornersOf(rect: Rect): Corners {
  return { x1: rect.left, y1: rect.top, x2: rect.right, y2: rect.bottom };
}

interface ButtonOptions {
  icon?: IconName;
  primary?: boolean;
  ghost?: boolean;
  title?: string;
  aria?: string;
}

function button(id: string, label: MessageKey | null, options: ButtonOptions = {}) {
  const classes = [options.primary && 'primary', options.ghost && 'ghost', !label && 'icon'];
  const created = buildElement('button', {
    id,
    type: 'button',
    class: classes.filter(Boolean).join(' '),
    title: options.title,
    'aria-label': options.aria,
  });
  if (options.icon) created.append(icon(options.icon));
  if (label) created.append(buildElement('span', {}, localize(label)));
  return created;
}

export class Overlay {
  readonly host: HTMLElement;
  #shadow: ShadowRoot;
  #ui: Elements;
  #state: State = 'crosshairs';
  #metrics: PageMetrics;
  #listeners = new AbortController();
  #destroyed = false;

  // Hover and element navigation
  #hoverElement: Element | null = null;
  #hoverByKeyboard = false;
  #navigationStack: Element[] = [];
  #pointer: Point | null = null;
  #probeQueued = false;

  // Selection
  #selection: Corners = { x1: 0, y1: 0, x2: 0, y2: 0 };
  #selectedElement: Element | null = null;
  #mover: Mover | 'highlight' | null = null;
  #lastPagePoint: Point = { x: 0, y: 0 };

  // Preview
  #previewResult: CaptureResult | null = null;

  readonly #settings: Settings;
  readonly #onClose: () => void;
  /** Firefox focuses the action the user picked last time. */
  readonly #lastSaveMethod: SaveMethod;

  constructor(settings: Settings, onClose: () => void, lastSaveMethod: SaveMethod = 'download') {
    this.#settings = settings;
    this.#onClose = onClose;
    this.#lastSaveMethod = lastSaveMethod;
    this.host = document.createElement(HOST_TAG);
    styleHost(this.host, { interactive: true });
    this.#shadow = this.host.attachShadow({ mode: 'closed' });
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
    }
    this.#shadow.adoptedStyleSheets = [sheet];
    this.#ui = this.#build();
    this.#shadow.append(this.#ui.root);
    this.#metrics = measurePage();
  }

  get state(): State {
    return this.#state;
  }

  /** Read-only snapshot for tests and debugging (isolated world only). */
  snapshot() {
    const hoverRect = this.#hoverElement ? topLevelRect(this.#hoverElement) : null;
    return {
      state: this.#state,
      hover: this.#hoverElement
        ? { label: describeElement(this.#hoverElement), rect: hoverRect }
        : null,
      selection: this.#state === 'crosshairs' ? null : this.#selectionRect(),
      selectedElement: this.#selectedElement ? describeElement(this.#selectedElement) : null,
    };
  }

  mount() {
    document.documentElement.append(this.host);
    try {
      this.host.showPopover();
    } catch {
      // Fall back to the z-index set in styleHost.
    }
    this.#listen();
    this.#setState('crosshairs');
    this.#ui.root.focus({ preventScroll: true });
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#listeners.abort();
    this.host.remove();
    this.#onClose();
  }

  // ---------------------------------------------------------------------------
  // DOM

  #build(): Elements {
    const theFace = face();
    const preview = buildElement(
      'div',
      { id: 'preview' },
      buildElement('div', { id: 'face' }, theFace.root),
      buildElement('div', { id: 'instructions' }, localize('instructions')),
      buildElement('div', { id: 'nav-hint' }, localize('navHint')),
      button('preview-cancel', 'cancel', { ghost: true, title: localize('cancelTitle') }),
    );

    const panel = buildElement(
      'div',
      { id: 'panel' },
      button('save-visible', 'saveVisible'),
      button('save-fullpage', 'saveFullPage', { primary: true }),
    );

    const hover = buildElement('div', { id: 'hover', hidden: true });
    const hoverLabel = buildElement('div', {
      id: 'hover-label',
      hidden: true,
      'aria-live': 'polite',
    });

    const size = buildElement('span', { id: 'size' });
    const movers = MOVERS.map((mover) => {
      const isCorner = CORNERS.has(mover);
      return buildElement(
        'div',
        {
          id: `mover-${mover}`,
          class: isCorner ? 'mover-target' : 'mover-target edge',
          tabindex: isCorner ? 0 : undefined,
          role: isCorner ? 'button' : undefined,
          'aria-label': isCorner ? localize('resizeHandleLabel') : undefined,
        },
        buildElement('div', { class: 'mover' }),
      );
    });
    const highlight = buildElement(
      'div',
      { id: 'highlight', tabindex: 0, role: 'group', 'aria-label': localize('selectionLabel') },
      ...movers,
      buildElement('div', { id: 'size-wrap' }, size),
    );
    const bgTop = buildElement('div', { class: 'bg' });
    const bgBottom = buildElement('div', { class: 'bg' });
    const bgLeft = buildElement('div', { class: 'bg' });
    const bgRight = buildElement('div', { class: 'bg' });
    const selection = buildElement(
      'div',
      { id: 'selection', hidden: true },
      bgTop,
      bgBottom,
      bgLeft,
      bgRight,
      highlight,
    );

    const copyTitle = localize('copyTitle', `${ACCEL}C`);
    const downloadTitle = localize('downloadTitle', `${ACCEL}S`);
    const cancelTitle = localize('cancelTitle');
    const copyButton = button('copy', 'copy', { icon: 'copy', title: copyTitle });
    const downloadButton = button('download', 'download', {
      icon: 'download',
      primary: true,
      title: downloadTitle,
    });
    const buttons = buildElement(
      'div',
      { id: 'buttons', hidden: true },
      button('cancel', null, { icon: 'close', title: cancelTitle, aria: localize('cancel') }),
      copyButton,
      downloadButton,
    );

    const dialogCopy = button('dialog-copy', 'copy', { icon: 'copy', title: copyTitle });
    const dialogDownload = button('dialog-download', 'download', {
      icon: 'download',
      primary: true,
      title: downloadTitle,
    });
    const previewCanvas = buildElement('canvas', { id: 'preview-canvas' });
    const dialog = buildElement(
      'div',
      {
        id: 'dialog',
        hidden: true,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': localize('dialogLabel'),
      },
      buildElement(
        'div',
        { id: 'dialog-bar' },
        button('dialog-retry', null, {
          icon: 'retry',
          title: localize('retryTitle'),
          aria: localize('retry'),
        }),
        button('dialog-cancel', null, {
          icon: 'close',
          title: cancelTitle,
          aria: localize('cancel'),
        }),
        dialogCopy,
        dialogDownload,
      ),
      buildElement('div', { id: 'dialog-body' }, previewCanvas),
    );

    const root = buildElement(
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
      copy: copyButton,
      download: downloadButton,
      dialog,
      dialogCopy,
      dialogDownload,
      previewCanvas,
    };
  }

  // ---------------------------------------------------------------------------
  // Events

  #listen() {
    const signal = this.#listeners.signal;
    const root = this.#ui.root;
    const on = <Type extends keyof HTMLElementEventMap>(
      type: Type,
      handler: (event: HTMLElementEventMap[Type]) => void,
    ) => {
      root.addEventListener(type, handler, { signal });
    };
    on('pointerdown', (event) => {
      this.#onPointerDown(event);
    });
    on('pointermove', (event) => {
      this.#onPointerMove(event);
    });
    on('pointerup', (event) => {
      this.#onPointerUp(event);
    });
    on('pointercancel', (event) => {
      this.#onPointerUp(event);
    });
    on('click', (event) => {
      this.#onClick(event);
    });

    // Keep page handlers from seeing interaction with the overlay.
    const swallowed = [
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
    ];
    for (const type of swallowed) {
      root.addEventListener(
        type,
        (event) => {
          event.stopPropagation();
        },
        { signal, passive: true },
      );
    }

    // Keys are handled at the very start of dispatch so the page cannot
    // swallow Escape, and page shortcuts do not fire while we are open.
    window.addEventListener(
      'keydown',
      (event) => {
        this.#onKeyDown(event);
      },
      { capture: true, signal },
    );
    for (const type of ['keyup', 'keypress']) {
      window.addEventListener(
        type,
        (event) => {
          event.stopImmediatePropagation();
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

  #pagePoint(event: { clientX: number; clientY: number }): Point {
    const bounds = this.#metrics.bounds;
    return {
      x: clamp(event.clientX + window.scrollX, bounds.left, bounds.right),
      y: clamp(event.clientY + window.scrollY, bounds.top, bounds.bottom),
    };
  }

  #isUiControl(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest('button, #panel, #buttons, #dialog');
  }

  #onPointerDown(event: PointerEvent) {
    if (event.button !== 0) {
      this.#cancelPointerGesture();
      return;
    }
    if (this.#isUiControl(event.target)) return;
    const pagePoint = this.#pagePoint(event);

    if (this.#state === 'crosshairs') {
      // A click can come before any pointermove (e.g. right after the
      // shortcut). Keep a highlight the user chose with the keyboard.
      if (!this.#hoverByKeyboard) this.#probe(event.clientX, event.clientY);
      this.#selection = { x1: pagePoint.x, y1: pagePoint.y, x2: pagePoint.x, y2: pagePoint.y };
      this.#ui.root.setPointerCapture(event.pointerId);
      this.#setState('draggingReady');
    } else if (this.#state === 'selected') {
      const target = event.target as Element;
      const grabbed = target.closest('.mover-target, #highlight');
      if (!grabbed) {
        this.#setState('crosshairs');
        return;
      }
      this.#mover = grabbed.id === 'highlight' ? 'highlight' : (grabbed.id.slice(6) as Mover);
      this.#normalizeSelection();
      this.#lastPagePoint = pagePoint;
      this.#ui.root.setPointerCapture(event.pointerId);
      this.#setState('resizing');
    }
  }

  #onPointerMove(event: PointerEvent) {
    const state = this.#state;
    if (state === 'crosshairs') {
      const moved =
        !this.#pointer || this.#pointer.x !== event.clientX || this.#pointer.y !== event.clientY;
      if (!moved) return;
      this.#pointer = { x: event.clientX, y: event.clientY };
      this.#drawEyes(event.clientX, event.clientY);
      this.#queueProbe();
    } else if (state === 'draggingReady') {
      const pagePoint = this.#pagePoint(event);
      this.#selection.x2 = pagePoint.x;
      this.#selection.y2 = pagePoint.y;
      const distance = Math.hypot(
        this.#selection.x2 - this.#selection.x1,
        this.#selection.y2 - this.#selection.y1,
      );
      if (distance > DRAG_THRESHOLD) this.#setState('dragging');
    } else if (state === 'dragging') {
      this.#scrollIfByEdge(event.clientX, event.clientY);
      const pagePoint = this.#pagePoint(event);
      this.#selection.x2 = pagePoint.x;
      this.#selection.y2 = pagePoint.y;
      this.#drawSelection();
    } else if (state === 'resizing') {
      this.#scrollIfByEdge(event.clientX, event.clientY);
      this.#resizeTo(this.#pagePoint(event));
      this.#drawSelection();
    }
  }

  #onPointerUp(event: PointerEvent) {
    if (this.#ui.root.hasPointerCapture(event.pointerId)) {
      this.#ui.root.releasePointerCapture(event.pointerId);
    }
    const state = this.#state;
    if (state === 'draggingReady') {
      if (this.#hoverElement) this.#selectElement(this.#hoverElement);
      else this.#setState('crosshairs');
    } else if (state === 'dragging') {
      const pagePoint = this.#pagePoint(event);
      this.#selection.x2 = pagePoint.x;
      this.#selection.y2 = pagePoint.y;
      this.#selectedElement = null;
      this.#setState('selected');
    } else if (state === 'resizing') {
      this.#resizeTo(this.#pagePoint(event));
      this.#setState('selected', { keepFocus: true });
    }
  }

  /** A non-primary button press aborts the current gesture, as in Firefox. */
  #cancelPointerGesture() {
    if (this.#state === 'draggingReady') this.#setState('crosshairs');
    else if (this.#state === 'dragging' || this.#state === 'resizing') this.#setState('selected');
  }

  #onClick(event: MouseEvent) {
    const clicked = event.target instanceof Element ? event.target.closest('button') : null;
    const actions: Record<string, () => void> = {
      'preview-cancel': () => {
        this.destroy();
      },
      'dialog-cancel': () => {
        this.destroy();
      },
      cancel: () => {
        this.#setState('crosshairs');
      },
      'save-visible': () => void this.#captureForPreview('visible'),
      'save-fullpage': () => void this.#captureForPreview('fullpage'),
      copy: () => {
        this.#copySelection();
      },
      download: () => void this.#downloadSelection(),
      'dialog-retry': () => {
        this.#previewResult = null;
        this.#setState('crosshairs');
      },
      'dialog-copy': () => {
        this.#copyPreview();
      },
      'dialog-download': () => void this.#downloadPreview(),
    };
    if (clicked) actions[clicked.id]?.();
  }

  #onKeyDown(event: KeyboardEvent) {
    // Everything stops here; only keys we act on lose their default action.
    event.stopImmediatePropagation();
    if (this.#handleKey(event)) event.preventDefault();
  }

  /** Returns true when the key was consumed. */
  #handleKey(event: KeyboardEvent): boolean {
    const key = event.key;
    if (key === 'Escape') {
      this.#onEscape();
      return true;
    }
    if (key === 'Tab') return this.#trapFocus(event.shiftKey);

    const accel = IS_MAC ? event.metaKey : event.ctrlKey;
    const shortcut = accel ? key.toLowerCase() : '';
    const state = this.#state;
    if (state === 'crosshairs') return this.#handleCrosshairsKey(key);
    if (state === 'selected' || state === 'resizing') {
      if (key.startsWith('Arrow')) return this.#keyboardResize(event, this.#shadow.activeElement);
      if (shortcut === 'c') this.#copySelection();
      if (shortcut === 's') void this.#downloadSelection();
      return shortcut === 'c' || shortcut === 's';
    }
    if (state === 'preview') {
      if (shortcut === 'c') this.#copyPreview();
      if (shortcut === 's') void this.#downloadPreview();
      return shortcut === 'c' || shortcut === 's';
    }
    // While capturing, every key is swallowed.
    return state === 'capturing';
  }

  #onEscape() {
    if (this.#state === 'crosshairs' || this.#state === 'preview') this.destroy();
    else if (this.#state !== 'capturing') this.#setState('crosshairs');
  }

  #handleCrosshairsKey(key: string): boolean {
    if (key.startsWith('Arrow')) {
      this.#navigate(key);
      return true;
    }
    const onButton = this.#shadow.activeElement instanceof HTMLButtonElement;
    if ((key === 'Enter' || key === ' ') && !onButton) {
      if (this.#hoverElement) this.#selectElement(this.#hoverElement);
      return true;
    }
    return false;
  }

  #onScroll() {
    this.#metrics = measurePage();
    const state = this.#state;
    if (state === 'crosshairs') {
      if (this.#hoverByKeyboard || !this.#pointer) this.#drawHover();
      else this.#queueProbe();
    } else if (state === 'dragging' || state === 'selected' || state === 'resizing') {
      this.#drawSelection();
      if (state === 'selected') this.#drawButtons();
    }
  }

  #onResize() {
    this.#metrics = measurePage();
    if (this.#state === 'crosshairs') {
      this.#setHover(null);
    } else if (this.#state === 'selected') {
      this.#selection = cornersOf(shiftInto(this.#selectionRect(), this.#metrics.bounds));
      this.#drawSelection();
      this.#drawButtons();
    } else if (this.#state === 'preview' && this.#previewResult) {
      this.#drawPreview(this.#previewResult.canvas);
    }
  }

  // ---------------------------------------------------------------------------
  // State

  #setState(next: State, opts: { keepFocus?: boolean } = {}) {
    const previous = this.#state;
    this.#state = next;
    const ui = this.#ui;
    ui.root.className = next === 'capturing' ? 'capturing' : next === 'resizing' ? 'dragging' : '';

    const crosshairs = next === 'crosshairs';
    const selecting = next === 'dragging' || next === 'selected' || next === 'resizing';
    ui.preview.hidden = !crosshairs;
    ui.panel.hidden = !crosshairs;
    ui.hover.hidden = !crosshairs || !this.#hoverElement;
    ui.hoverLabel.hidden = ui.hover.hidden;
    ui.selection.hidden = !selecting && !(next === 'capturing' && previous !== 'crosshairs');
    ui.buttons.hidden = next !== 'selected';
    ui.dialog.hidden = next !== 'preview';

    if (crosshairs) {
      this.#selectedElement = null;
      if (previous !== 'crosshairs') {
        this.#setHover(null);
        ui.root.focus({ preventScroll: true });
      }
    } else if (next === 'dragging') {
      this.#drawSelection();
    } else if (next === 'selected') {
      this.#normalizeSelection();
      this.#drawSelection();
      this.#drawButtons();
      if (!opts.keepFocus) {
        const target = this.#lastSaveMethod === 'copy' ? ui.copy : ui.download;
        target.focus({ preventScroll: true, focusVisible: true });
      }
    } else if (next === 'preview') {
      const target = this.#lastSaveMethod === 'copy' ? ui.dialogCopy : ui.dialogDownload;
      target.focus({ preventScroll: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Hover and element-tree navigation

  #queueProbe() {
    if (this.#probeQueued) return;
    this.#probeQueued = true;
    requestAnimationFrame(() => {
      this.#probeQueued = false;
      if (this.#state === 'crosshairs' && this.#pointer && !this.#destroyed) {
        this.#probe(this.#pointer.x, this.#pointer.y);
      }
    });
  }

  /** Find the element under a client point, looking "through" the overlay like Firefox does. */
  #probe(clientX: number, clientY: number) {
    const root = this.#ui.root;
    // The host must be transparent to hit testing too, not just its contents.
    this.host.style.setProperty('pointer-events', 'none', 'important');
    root.classList.add('probing');
    let hit: Element | null;
    try {
      hit = deepElementFromPoint(document, clientX, clientY, this.host);
    } finally {
      root.classList.remove('probing');
      this.host.style.setProperty('pointer-events', 'auto', 'important');
    }
    const limits = detectLimitsForViewport(this.#metrics.clientWidth, this.#metrics.clientHeight);
    const picked = hit ? pickElement(hit, this.#settings.elementDetection, limits) : null;
    this.#navigationStack = [];
    this.#hoverByKeyboard = false;
    this.#setHover(picked);
  }

  #setHover(target: Element | null) {
    this.#hoverElement = target;
    this.#drawHover();
  }

  #navigate(key: string) {
    const current = this.#hoverElement;
    if (!current) {
      // Start from the element under the pointer, or the middle of the viewport.
      this.#probe(
        this.#pointer?.x ?? this.#metrics.clientWidth / 2,
        this.#pointer?.y ?? this.#metrics.clientHeight / 2,
      );
      return;
    }
    const moves: Record<string, () => Element | null> = {
      ArrowUp: () => {
        const parent = visibleParent(current);
        if (parent) this.#navigationStack.push(current);
        return parent;
      },
      ArrowDown: () => this.#navigationStack.pop() ?? visibleChild(current, this.#pointer),
      ArrowLeft: () => visibleSibling(current, -1),
      ArrowRight: () => visibleSibling(current, 1),
    };
    const next = moves[key]?.() ?? null;
    if (!next) return;
    if (key === 'ArrowLeft' || key === 'ArrowRight') this.#navigationStack = [];
    this.#hoverByKeyboard = true;
    this.#setHover(next);
    this.#ensureVisible(next);
  }

  /** Scroll so a keyboard-chosen element is at least partly on screen. */
  #ensureVisible(target: Element) {
    const rect = topLevelRect(target);
    const { clientWidth, clientHeight } = this.#metrics;
    const offScreen =
      !!rect &&
      (rect.bottom < 0 || rect.top > clientHeight || rect.right < 0 || rect.left > clientWidth);
    if (offScreen)
      target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }

  #drawHover() {
    const { hover, hoverLabel } = this.#ui;
    const target = this.#hoverElement;
    const rect = target?.isConnected ? topLevelRect(target) : null;
    if (!target || !rect || this.#state !== 'crosshairs') {
      hover.hidden = true;
      hoverLabel.hidden = true;
      return;
    }
    hover.hidden = false;
    hover.classList.toggle('keyboard', this.#hoverByKeyboard);
    place(hover, { left: rect.left, top: rect.top, width: width(rect), height: height(rect) });

    hoverLabel.hidden = false;
    hoverLabel.replaceChildren(
      describeElement(target),
      buildElement('span', { class: 'dim' }, `  ${sizeText(rect)}`),
    );
    const labelHeight = 22;
    const { clientWidth, clientHeight } = this.#metrics;
    const above = rect.top - labelHeight - 4;
    const below = rect.bottom + 4;
    const preferred = above >= 4 ? above : below;
    // Neither above nor below fits: put it inside the element's top edge.
    const top = preferred + labelHeight > clientHeight - 4 ? Math.max(4, rect.top + 4) : preferred;
    place(hoverLabel, { left: clamp(rect.left, 4, Math.max(4, clientWidth - 220)), top });
  }

  #drawEyes(clientX: number, clientY: number) {
    const { clientWidth, clientHeight } = this.#metrics;
    const offsetX = Math.floor((10 * (clientX - clientWidth / 2)) / clientWidth);
    const offsetY = Math.floor((10 * (clientY - clientHeight / 2)) / clientHeight);
    const transform = `translate(${offsetX}px, ${offsetY}px)`;
    this.#ui.face.leftPupil.style.transform = transform;
    this.#ui.face.rightPupil.style.transform = transform;
  }

  // ---------------------------------------------------------------------------
  // Selection

  #selectionRect(): Rect {
    const corners = this.#selection;
    return {
      left: Math.min(corners.x1, corners.x2),
      top: Math.min(corners.y1, corners.y2),
      right: Math.max(corners.x1, corners.x2),
      bottom: Math.max(corners.y1, corners.y2),
    };
  }

  /** Sort the corners, and keep the selection at least 1x1 inside the page. */
  #normalizeSelection() {
    const rect = this.#selectionRect();
    const bounds = this.#metrics.bounds;
    const right = rect.right - rect.left < 1 ? Math.min(rect.left + 1, bounds.right) : rect.right;
    const bottom = rect.bottom - rect.top < 1 ? Math.min(rect.top + 1, bounds.bottom) : rect.bottom;
    this.#selection = {
      x1: Math.min(rect.left, right - 1),
      y1: Math.min(rect.top, bottom - 1),
      x2: right,
      y2: bottom,
    };
  }

  #selectElement(target: Element) {
    const rect = topLevelRect(target);
    if (!rect) return;
    const page = clampRect(translate(rect, window.scrollX, window.scrollY), this.#metrics.bounds);
    if (isEmpty(page)) return;
    this.#selection = cornersOf(page);
    this.#selectedElement = target;
    this.#setState('selected');
  }

  #resizeTo(pagePoint: Point) {
    const mover = this.#mover;
    if (mover === 'highlight') {
      const moved = shiftInto(
        translate(
          this.#selectionRect(),
          pagePoint.x - this.#lastPagePoint.x,
          pagePoint.y - this.#lastPagePoint.y,
        ),
        this.#metrics.bounds,
      );
      this.#selection = cornersOf(moved);
      this.#lastPagePoint = pagePoint;
    } else if (mover) {
      for (const edge of MOVER_EDGES[mover]) {
        this.#selection[edge] = edge.startsWith('x') ? pagePoint.x : pagePoint.y;
      }
    }
  }

  /**
   * Arrow keys in the selected state, following Firefox: on the region they
   * move it, on a corner handle they move that corner. Shift moves by 10px.
   */
  #keyboardResize(event: KeyboardEvent, focused: Element | null): boolean {
    const id = focused?.id ?? '';
    const isHighlight = id === 'highlight';
    const corner = id.startsWith('mover-') ? id.slice(6) : '';
    if (!isHighlight && !CORNERS.has(corner)) return false;

    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    const bounds = this.#metrics.bounds;
    this.#normalizeSelection();
    const corners = this.#selection;

    if (isHighlight) {
      this.#selection = cornersOf(shiftInto(translate(this.#selectionRect(), dx, dy), bounds));
    } else {
      if (corner.endsWith('Left')) corners.x1 = clamp(corners.x1 + dx, bounds.left, corners.x2 - 1);
      else corners.x2 = clamp(corners.x2 + dx, corners.x1 + 1, bounds.right);
      if (corner.startsWith('top')) corners.y1 = clamp(corners.y1 + dy, bounds.top, corners.y2 - 1);
      else corners.y2 = clamp(corners.y2 + dy, corners.y1 + 1, bounds.bottom);
    }
    this.#scrollSelectionIntoView();
    this.#drawSelection();
    this.#drawButtons();
    return true;
  }

  #scrollSelectionIntoView() {
    const rect = this.#selectionRect();
    if (!intersect(viewportRect(measurePage()), rect)) {
      window.scrollTo({ left: rect.left - 20, top: rect.top - 20, behavior: 'instant' });
    }
  }

  /** Auto-scroll while dragging near the viewport edge (Firefox's scrollIfByEdge). */
  #scrollIfByEdge(clientX: number, clientY: number) {
    const { clientWidth, clientHeight } = this.#metrics;
    const towardsEdge = (position: number, size: number) => {
      if (position < SCROLL_BY_EDGE) return -(SCROLL_BY_EDGE - position);
      if (size - position < SCROLL_BY_EDGE) return SCROLL_BY_EDGE - (size - position);
      return 0;
    };
    const dx = towardsEdge(clientX, clientWidth);
    const dy = towardsEdge(clientY, clientHeight);
    if (dx || dy) {
      window.scrollBy({ left: dx, top: dy, behavior: 'instant' });
      this.#metrics = measurePage();
    }
  }

  #drawSelection() {
    const ui = this.#ui;
    const rect = translate(this.#selectionRect(), -window.scrollX, -window.scrollY);
    const rectWidth = width(rect);
    const rectHeight = height(rect);
    const { clientWidth, clientHeight } = this.#metrics;

    place(ui.highlight, { left: rect.left, top: rect.top, width: rectWidth, height: rectHeight });
    ui.highlight.classList.toggle('small', rectWidth < 40 || rectHeight < 40);
    place(ui.bgTop, { left: 0, top: 0, width: clientWidth, height: Math.max(0, rect.top) });
    place(ui.bgBottom, {
      left: 0,
      top: rect.bottom,
      width: clientWidth,
      height: Math.max(0, clientHeight - rect.bottom),
    });
    place(ui.bgLeft, { left: 0, top: rect.top, width: Math.max(0, rect.left), height: rectHeight });
    place(ui.bgRight, {
      left: rect.right,
      top: rect.top,
      width: Math.max(0, clientWidth - rect.right),
      height: rectHeight,
    });
    ui.size.textContent = sizeText(rect);
  }

  /** Put the action bar under the bottom-right of the selection, kept on screen (Firefox's rules). */
  #drawButtons() {
    const { buttons } = this.#ui;
    const rect = translate(this.#selectionRect(), -window.scrollX, -window.scrollY);
    const { clientWidth, clientHeight } = this.#metrics;
    if (!intersect(rect, { left: 0, top: 0, right: clientWidth, bottom: clientHeight })) {
      buttons.hidden = true;
      return;
    }
    buttons.hidden = false;
    const roomBelow = clientHeight - rect.bottom >= 70;
    const bottomOnScreen = rect.bottom < clientHeight;
    const topNearBottom = clientHeight - rect.top < 70;
    const top = roomBelow
      ? rect.bottom
      : bottomOnScreen
        ? rect.bottom - 60
        : topNearBottom
          ? rect.top - 60
          : clientHeight - 60;
    const barWidth = Math.ceil(buttons.getBoundingClientRect().width);
    const rightEdge = Math.max(Math.min(clientWidth, rect.right), barWidth);
    place(buttons, { top: Math.max(0, top), left: null, right: clientWidth - rightEdge });
  }

  #trapFocus(backwards: boolean): boolean {
    const candidates = Array.from(
      this.#shadow.querySelectorAll<HTMLElement>('button, [tabindex="0"]'),
    ).filter((candidate) => candidate.getClientRects().length > 0);
    if (candidates.length === 0) return true;
    const active = this.#shadow.activeElement;
    const index = candidates.findIndex((candidate) => candidate === active);
    const step = backwards ? -1 : 1;
    const nextIndex =
      index === -1
        ? backwards
          ? candidates.length - 1
          : 0
        : (index + step + candidates.length) % candidates.length;
    candidates[nextIndex]?.focus({ preventScroll: true });
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
      showToast(localize('errorClipboardInsecure'), 'error', LONG_NOTICE_MS);
      return;
    }
    const capture = this.#capture(this.#selectionRect(), this.#selectedElement, 'as-seen');
    // Start the clipboard write now, inside the user gesture.
    const written = copyPng(
      capture.then((result) => result.canvas.convertToBlob({ type: 'image/png' })),
    );
    Promise.all([capture, written]).then(
      ([result]) => {
        rememberSaveMethod('copy');
        this.destroy();
        const message = result.cropped
          ? `${localize('copied')}. ${localize('cropped')}`
          : localize('copied');
        showToast(message, 'info', result.cropped ? LONG_NOTICE_MS : SHORT_NOTICE_MS);
      },
      (error: unknown) => {
        this.#fail(error, 'copy', 'selected');
      },
    );
  }

  async #downloadSelection() {
    if (this.#state !== 'selected') return;
    const result = await this.#capture(
      this.#selectionRect(),
      this.#selectedElement,
      'as-seen',
    ).catch((error: unknown) => {
      this.#fail(error, 'capture', 'selected');
      return null;
    });
    if (!result) return;
    await this.#save(result, 'selected').catch((error: unknown) => {
      this.#fail(error, 'download', 'selected');
    });
  }

  async #captureForPreview(kind: 'visible' | 'fullpage') {
    const metrics = measurePage();
    const region = kind === 'visible' ? viewportRect(metrics) : metrics.bounds;
    try {
      const result = await this.#capture(region, null, 'first-tile');
      this.#previewResult = result;
      this.#setState('preview');
      this.#drawPreview(result.canvas);
      if (result.cropped) showToast(localize('cropped'), 'info', LONG_NOTICE_MS);
    } catch (error) {
      this.#fail(error, 'capture', 'crosshairs');
    }
  }

  #drawPreview(source: OffscreenCanvas) {
    const canvas = this.#ui.previewCanvas;
    const dpr = window.devicePixelRatio || 1;
    const maxCssWidth = Math.max(100, this.#metrics.clientWidth - 32);
    const cssWidth = Math.min(source.width / dpr, maxCssWidth);
    const scale = (cssWidth * dpr) / source.width;
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    canvas.style.width = `${cssWidth}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
  }

  #copyPreview() {
    const result = this.#previewResult;
    if (!result || this.#state !== 'preview') return;
    if (!clipboardAvailable()) {
      showToast(localize('errorClipboardInsecure'), 'error', LONG_NOTICE_MS);
      return;
    }
    copyPng(result.canvas.convertToBlob({ type: 'image/png' })).then(
      () => {
        rememberSaveMethod('copy');
        this.destroy();
        showToast(localize('copied'), 'info', SHORT_NOTICE_MS);
      },
      (error: unknown) => {
        this.#fail(error, 'copy', 'preview');
      },
    );
  }

  async #downloadPreview() {
    const result = this.#previewResult;
    if (!result || this.#state !== 'preview') return;
    const dialogButtons = this.#ui.dialog.querySelectorAll('button');
    dialogButtons.forEach((dialogButton) => (dialogButton.disabled = true));
    try {
      await this.#save(result, 'preview');
    } catch (error) {
      this.#fail(error, 'download', 'preview');
    } finally {
      dialogButtons.forEach((dialogButton) => (dialogButton.disabled = false));
    }
  }

  /** Encode and download; on cancel or error, return to `back`. */
  async #save(result: CaptureResult, back: 'selected' | 'preview') {
    const blob = await result.canvas.convertToBlob({ type: 'image/png' });
    const outcome = await download(blob, buildFilename(document.title, new Date()));
    if (outcome.ok) {
      rememberSaveMethod('download');
      this.destroy();
      if (result.cropped) showToast(localize('cropped'), 'info', LONG_NOTICE_MS);
      return;
    }
    if (this.#destroyed) return;
    this.#setState(back);
    if (!outcome.canceled) {
      showToast(localize('errorDownload', outcome.error ?? ''), 'error', LONG_NOTICE_MS);
    }
  }

  #fail(error: unknown, kind: 'copy' | 'capture' | 'download', back: State) {
    console.error('[Element Screenshotter]', error);
    if (this.#destroyed) return;
    this.#setState(back === 'preview' && !this.#previewResult ? 'crosshairs' : back);
    showToast(errorMessage(error, kind), 'error', LONG_NOTICE_MS);
  }
}

/** "400 x 200", in whole CSS pixels. */
function sizeText(rect: Rect): string {
  return localize('selectionSize', [
    String(Math.round(width(rect))),
    String(Math.round(height(rect))),
  ]);
}

export type SaveMethod = 'copy' | 'download';
const LAST_SAVE_METHOD_KEY = 'lastSaveMethod';

export async function loadLastSaveMethod(): Promise<SaveMethod> {
  const { [LAST_SAVE_METHOD_KEY]: value } = await chrome.storage.local.get(LAST_SAVE_METHOD_KEY);
  return value === 'copy' ? 'copy' : 'download';
}

function rememberSaveMethod(method: SaveMethod) {
  void chrome.storage.local.set({ [LAST_SAVE_METHOD_KEY]: method }).catch(() => undefined);
}

function clipboardAvailable(): boolean {
  return window.isSecureContext && 'clipboard' in navigator && typeof ClipboardItem !== 'undefined';
}

function errorMessage(error: unknown, kind: 'copy' | 'capture' | 'download'): string {
  if (error instanceof ClipboardUnavailableError) return localize('errorClipboardInsecure');
  const message = error instanceof Error ? error.message : String(error);
  const detail = message === 'tab-not-active' ? localize('errorTabNotActive') : message;
  const keys = {
    copy: 'errorClipboard',
    capture: 'errorCapture',
    download: 'errorDownload',
  } as const;
  return localize(keys[kind], detail);
}
