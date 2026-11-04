/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * The "smart" heuristic is adapted from Firefox's
 * browser/components/screenshots/overlayHelpers.mjs (getBestRectForElement
 * and evenBetterElement). Differences from Firefox:
 *  - It always resolves to a real element. Firefox can merge an element
 *    with its next sibling's rect, but our arrow-key tree navigation needs
 *    an element to move from.
 *  - It walks the composed tree, through shadow roots and same-origin
 *    iframes.
 */

import type { Rect } from '../shared/geometry';
import type { ElementDetection } from '../shared/settings';

// An autoselection smaller than these is ignored entirely.
const MIN_DETECT_ABSOLUTE_HEIGHT = 10;
const MIN_DETECT_ABSOLUTE_WIDTH = 30;
// An autoselection smaller than these will not be preferred.
const MIN_DETECT_HEIGHT = 30;
const MIN_DETECT_WIDTH = 100;

const DO_NOT_AUTOSELECT = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

export interface DetectLimits {
  /** Elements bigger than this are not auto-selected (Firefox: viewport + 100, at least 1000). */
  maxWidth: number;
  /** Elements taller than this are not auto-selected (Firefox: viewport + 100, at least 700). */
  maxHeight: number;
}

export function detectLimitsForViewport(clientWidth: number, clientHeight: number): DetectLimits {
  return {
    maxWidth: Math.max(clientWidth + 100, 1000),
    maxHeight: Math.max(clientHeight + 100, 700),
  };
}

/** Rect of an element in the top-level viewport's client coordinates. */
export type RectFn = (el: Element) => Rect | null;

/** Composed-tree parent: crosses shadow roots and same-origin frame boundaries. */
export function composedParent(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  if (isShadowRoot(root)) return root.host;
  try {
    return el.ownerDocument.defaultView?.frameElement ?? null;
  } catch {
    return null;
  }
}

function isShadowRoot(node: Node): node is ShadowRoot {
  return node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in node;
}

/** Composed-tree children: shadow root contents and same-origin frame documents. */
export function composedChildren(el: Element): Element[] {
  const frameDoc = sameOriginFrameDocument(el);
  if (frameDoc?.documentElement) return [frameDoc.documentElement];
  const root = shadowRootOf(el);
  if (root) return Array.from(root.children);
  return Array.from(el.children);
}

export function shadowRootOf(el: Element): ShadowRoot | null {
  // chrome.dom.openOrClosedShadowRoot is only available to content scripts.
  const dom = (globalThis as { chrome?: typeof chrome }).chrome?.dom;
  if (dom?.openOrClosedShadowRoot) {
    try {
      return dom.openOrClosedShadowRoot(el as HTMLElement);
    } catch {
      return el.shadowRoot;
    }
  }
  return el.shadowRoot;
}

export function isFrame(el: Element): el is HTMLIFrameElement {
  return el.localName === 'iframe' || el.localName === 'frame';
}

export function sameOriginFrameDocument(el: Element): Document | null {
  if (!isFrame(el)) return null;
  try {
    return el.contentDocument;
  } catch {
    return null;
  }
}

/**
 * Offset of a frame's viewport inside its parent viewport: the iframe's
 * border box plus its border and padding.
 */
function frameContentOffset(frame: Element): { x: number; y: number } {
  const r = frame.getBoundingClientRect();
  const style = frame.ownerDocument.defaultView?.getComputedStyle(frame);
  const padLeft = style ? parseFloat(style.paddingLeft) || 0 : 0;
  const padTop = style ? parseFloat(style.paddingTop) || 0 : 0;
  return { x: r.left + frame.clientLeft + padLeft, y: r.top + frame.clientTop + padTop };
}

/** The element's rect in top-level client coordinates, accumulating frame offsets. */
export function topLevelRect(el: Element): Rect | null {
  if (typeof el.getBoundingClientRect !== 'function') return null;
  const r = el.getBoundingClientRect();
  let dx = 0;
  let dy = 0;
  let win: Window | null = el.ownerDocument.defaultView;
  try {
    while (win && win !== win.parent && win.frameElement) {
      const off = frameContentOffset(win.frameElement);
      dx += off.x;
      dy += off.y;
      win = win.parent;
    }
  } catch {
    // Cross-origin ancestor: we cannot be inside it in the first place.
  }
  return { left: r.left + dx, top: r.top + dy, right: r.right + dx, bottom: r.bottom + dy };
}

/**
 * Find the deepest element at a top-level client point. It enters shadow
 * roots (open or closed) and same-origin iframes. `ignore` is our own
 * overlay host. Pointer events must already be disabled on it, the way
 * Firefox does it.
 */
export function deepElementFromPoint(
  doc: Document,
  x: number,
  y: number,
  ignore?: Element,
): Element | null {
  let el = doc.elementFromPoint(x, y);
  if (!el || el === ignore) return null;
  for (let depth = 0; depth < 32; depth++) {
    const root = shadowRootOf(el);
    if (root) {
      const inner = root.elementFromPoint(x, y);
      if (inner && inner !== el) {
        el = inner;
        continue;
      }
    }
    const frameDoc = sameOriginFrameDocument(el);
    if (frameDoc) {
      const off = frameContentOffset(el);
      const inner = frameDoc.elementFromPoint(x - off.x, y - off.y);
      if (inner) {
        el = inner;
        x -= off.x;
        y -= off.y;
        continue;
      }
    }
    break;
  }
  return el;
}

function rectSize(r: Rect) {
  return { w: r.right - r.left, h: r.bottom - r.top };
}

/** Elements we never offer: the root containers fill the page anyway. */
function isRootContainer(el: Element): boolean {
  return el === el.ownerDocument.documentElement || el === el.ownerDocument.body;
}

/**
 * Firefox's heuristic. Returns the element to highlight for a hovered
 * element, or null if nothing reasonable is found.
 */
export function bestElement(start: Element, limits: DetectLimits, rectOf: RectFn): Element | null {
  let node: Element | null = start;
  let lastNode: Element | null = null;
  let chosen: Element | null = null;

  while (node) {
    const rect = rectOf(node);
    if (!rect) {
      chosen = lastNode;
      break;
    }
    const { w, h } = rectSize(rect);
    if (w < MIN_DETECT_WIDTH || h < MIN_DETECT_HEIGHT) {
      // Small element: Firefox stops here and keeps it, unless it is tiny.
      chosen = node;
      break;
    }
    if (w > limits.maxWidth || h > limits.maxHeight) {
      // Too big: the previous (smaller) element was better.
      chosen = lastNode;
      break;
    }
    if (!DO_NOT_AUTOSELECT.has(node.tagName.toUpperCase())) {
      chosen = node;
      break;
    }
    lastNode = node;
    node = composedParent(node);
  }

  if (chosen) {
    const better = articleAncestor(chosen, limits, rectOf);
    if (better) chosen = better;
  }

  if (chosen) {
    const rect = rectOf(chosen);
    if (!rect) return null;
    const { w, h } = rectSize(rect);
    if (w < MIN_DETECT_ABSOLUTE_WIDTH || h < MIN_DETECT_ABSOLUTE_HEIGHT) return null;
    if (isRootContainer(chosen)) return null;
  }
  return chosen;
}

/** Firefox's evenBetterElement: prefer an enclosing role="article" that fits. */
function articleAncestor(node: Element, limits: DetectLimits, rectOf: RectFn): Element | null {
  let el = composedParent(node);
  while (el) {
    if (el.getAttribute('role') === 'article') {
      const rect = rectOf(el);
      if (!rect) return null;
      const { w, h } = rectSize(rect);
      return w <= limits.maxWidth && h <= limits.maxHeight ? el : null;
    }
    el = composedParent(el);
  }
  return null;
}

/** The element to highlight for a hovered element under the given mode. */
export function pickElement(
  hovered: Element,
  mode: ElementDetection,
  limits: DetectLimits,
  rectOf: RectFn = topLevelRect,
): Element | null {
  if (mode === 'smart') return bestElement(hovered, limits, rectOf);
  return hasArea(hovered, rectOf) ? hovered : null;
}

export function hasArea(el: Element, rectOf: RectFn = topLevelRect): boolean {
  const r = rectOf(el);
  return !!r && r.right - r.left >= 1 && r.bottom - r.top >= 1;
}

function sameBox(a: Element, b: Element, rectOf: RectFn): boolean {
  const ra = rectOf(a);
  const rb = rectOf(b);
  if (!ra || !rb) return false;
  return (
    Math.abs(ra.left - rb.left) < 0.5 &&
    Math.abs(ra.top - rb.top) < 0.5 &&
    Math.abs(ra.right - rb.right) < 0.5 &&
    Math.abs(ra.bottom - rb.bottom) < 0.5
  );
}

/**
 * Nearest ancestor whose box differs from `el`'s. Wrappers with an identical
 * box would make "go to parent" look like nothing happened. Stops at <body>.
 */
export function visibleParent(el: Element, rectOf: RectFn = topLevelRect): Element | null {
  let p = composedParent(el);
  while (p) {
    if (p === p.ownerDocument.documentElement) return null;
    if (hasArea(p, rectOf) && !sameBox(p, el, rectOf)) return p;
    p = composedParent(p);
  }
  return null;
}

/** Visible children (with distinct boxes, looking through same-box wrappers). */
function visibleChildren(el: Element, rectOf: RectFn): Element[] {
  const out: Element[] = [];
  const visit = (parent: Element, depth: number) => {
    for (const child of composedChildren(parent)) {
      if (!hasArea(child, rectOf)) continue;
      if (sameBox(child, el, rectOf) && depth < 16) visit(child, depth + 1);
      else out.push(child);
    }
  };
  visit(el, 0);
  return out;
}

/**
 * A child to descend into: the one containing `point` (top-level client
 * coordinates) if any, else the first visible child.
 */
export function visibleChild(
  el: Element,
  point: { x: number; y: number } | null,
  rectOf: RectFn = topLevelRect,
): Element | null {
  const kids = visibleChildren(el, rectOf);
  if (point) {
    const hit = kids.find((k) => {
      const r = rectOf(k);
      return r && point.x >= r.left && point.x < r.right && point.y >= r.top && point.y < r.bottom;
    });
    if (hit) return hit;
  }
  return kids[0] ?? null;
}

/** Next or previous sibling (in the composed tree) that has a visible box. */
export function visibleSibling(
  el: Element,
  direction: 1 | -1,
  rectOf: RectFn = topLevelRect,
): Element | null {
  const parent = composedParent(el);
  if (!parent) return null;
  const siblings = composedChildren(parent);
  let i = siblings.indexOf(el) + direction;
  for (; i >= 0 && i < siblings.length; i += direction) {
    const s = siblings[i];
    if (s && hasArea(s, rectOf)) return s;
  }
  return null;
}

/** A short CSS-like label, e.g. `div#main.card.wide`. */
export function describeElement(el: Element, maxClasses = 3): string {
  let label = el.localName;
  if (el.id) label += `#${el.id}`;
  const classes = Array.from(el.classList).slice(0, maxClasses);
  for (const c of classes) label += `.${c}`;
  if (el.classList.length > maxClasses) label += '…';
  return label.length > 80 ? `${label.slice(0, 79)}…` : label;
}
