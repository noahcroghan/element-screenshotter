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

import { sameRect, type Rect } from '../shared/geometry';
import type { ElementDetection } from '../shared/settings';

// An autoselection smaller than these is ignored entirely.
const MIN_DETECT_ABSOLUTE_HEIGHT = 10;
const MIN_DETECT_ABSOLUTE_WIDTH = 30;
// An autoselection smaller than these will not be preferred.
const MIN_DETECT_HEIGHT = 30;
const MIN_DETECT_WIDTH = 100;

const DO_NOT_AUTOSELECT = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

/** How deep to follow nested shadow roots and frames when hit testing. */
const MAX_HIT_TEST_DEPTH = 32;

export interface DetectLimits {
  /** Elements wider than this are not auto-selected (Firefox: viewport + 100, at least 1000). */
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
export type RectFn = (element: Element) => Rect | null;

function isShadowRoot(node: Node): node is ShadowRoot {
  return node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in node;
}

/** Composed-tree parent: crosses shadow roots and same-origin frame boundaries. */
export function composedParent(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  if (isShadowRoot(root)) return root.host;
  try {
    return element.ownerDocument.defaultView?.frameElement ?? null;
  } catch {
    return null;
  }
}

/** Composed-tree children: shadow root contents and same-origin frame documents. */
export function composedChildren(element: Element): Element[] {
  const frameDoc = sameOriginFrameDocument(element);
  if (frameDoc?.documentElement) return [frameDoc.documentElement];
  const root = shadowRootOf(element);
  return Array.from(root ? root.children : element.children);
}

export function shadowRootOf(element: Element): ShadowRoot | null {
  // chrome.dom.openOrClosedShadowRoot is only available to content scripts.
  const dom = (globalThis as { chrome?: typeof chrome }).chrome?.dom;
  if (!dom?.openOrClosedShadowRoot) return element.shadowRoot;
  try {
    return dom.openOrClosedShadowRoot(element as HTMLElement);
  } catch {
    return element.shadowRoot;
  }
}

export function isFrame(element: Element): element is HTMLIFrameElement {
  return element.localName === 'iframe' || element.localName === 'frame';
}

export function sameOriginFrameDocument(element: Element): Document | null {
  if (!isFrame(element)) return null;
  try {
    return element.contentDocument;
  } catch {
    return null;
  }
}

/**
 * Offset of a frame's viewport inside its parent viewport: the iframe's
 * border box plus its border and padding.
 */
function frameContentOffset(frame: Element): { x: number; y: number } {
  const box = frame.getBoundingClientRect();
  const style = frame.ownerDocument.defaultView?.getComputedStyle(frame);
  const paddingLeft = style ? parseFloat(style.paddingLeft) || 0 : 0;
  const paddingTop = style ? parseFloat(style.paddingTop) || 0 : 0;
  return {
    x: box.left + frame.clientLeft + paddingLeft,
    y: box.top + frame.clientTop + paddingTop,
  };
}

/** The frame elements between `element`'s window and the top window, innermost first. */
function frameChain(element: Element): Element[] {
  const frames: Element[] = [];
  try {
    let frame = element.ownerDocument.defaultView?.frameElement ?? null;
    while (frame) {
      frames.push(frame);
      frame = frame.ownerDocument.defaultView?.frameElement ?? null;
    }
  } catch {
    // A cross-origin ancestor: we can't be inside it in the first place.
  }
  return frames;
}

/** The element's rect in top-level client coordinates, accumulating frame offsets. */
export function topLevelRect(element: Element): Rect | null {
  if (typeof element.getBoundingClientRect !== 'function') return null;
  const box = element.getBoundingClientRect();
  const offset = frameChain(element)
    .map(frameContentOffset)
    .reduce((sum, next) => ({ x: sum.x + next.x, y: sum.y + next.y }), { x: 0, y: 0 });
  return {
    left: box.left + offset.x,
    top: box.top + offset.y,
    right: box.right + offset.x,
    bottom: box.bottom + offset.y,
  };
}

/** One step into a shadow root or same-origin frame at a point, if there is one. */
function stepInto(
  element: Element,
  point: { x: number; y: number },
): { element: Element; point: { x: number; y: number } } | null {
  const inner = shadowRootOf(element)?.elementFromPoint(point.x, point.y);
  if (inner && inner !== element) return { element: inner, point };
  const frameDoc = sameOriginFrameDocument(element);
  if (!frameDoc) return null;
  const offset = frameContentOffset(element);
  const framePoint = { x: point.x - offset.x, y: point.y - offset.y };
  const inFrame = frameDoc.elementFromPoint(framePoint.x, framePoint.y);
  return inFrame ? { element: inFrame, point: framePoint } : null;
}

/**
 * Find the deepest element at a top-level client point. It enters shadow
 * roots (open or closed) and same-origin iframes. `ignore` is our own
 * overlay host. Pointer events must already be disabled on it, the way
 * Firefox does it.
 */
export function deepElementFromPoint(
  doc: Document,
  clientX: number,
  clientY: number,
  ignore?: Element,
): Element | null {
  const hit = doc.elementFromPoint(clientX, clientY);
  if (!hit || hit === ignore) return null;
  let current = { element: hit, point: { x: clientX, y: clientY } };
  let next = stepInto(current.element, current.point);
  let depth = 0;
  while (next && depth < MAX_HIT_TEST_DEPTH) {
    current = next;
    next = stepInto(current.element, current.point);
    depth++;
  }
  return current.element;
}

function rectSize(rect: Rect) {
  return { width: rect.right - rect.left, height: rect.bottom - rect.top };
}

/** Elements we never offer: the root containers fill the page anyway. */
function isRootContainer(element: Element): boolean {
  return (
    element === element.ownerDocument.documentElement || element === element.ownerDocument.body
  );
}

/**
 * Firefox's walk from the hovered element up to the element to highlight.
 *  - Too small to be preferred: keep it (it may still be rejected as tiny).
 *  - Too big: the previous, smaller element wins.
 *  - A heading: try its parent.
 *  - Otherwise: keep it.
 */
function walkToCandidate(start: Element, limits: DetectLimits, rectOf: RectFn): Element | null {
  let node: Element | null = start;
  let previous: Element | null = null;
  while (node) {
    const rect = rectOf(node);
    if (!rect) return previous;
    const size = rectSize(rect);
    if (size.width < MIN_DETECT_WIDTH || size.height < MIN_DETECT_HEIGHT) return node;
    if (size.width > limits.maxWidth || size.height > limits.maxHeight) return previous;
    if (!DO_NOT_AUTOSELECT.has(node.tagName.toUpperCase())) return node;
    previous = node;
    node = composedParent(node);
  }
  // Only headings all the way up: nothing to offer.
  return null;
}

/** Firefox's evenBetterElement: prefer an enclosing role="article" that fits. */
function articleAncestor(node: Element, limits: DetectLimits, rectOf: RectFn): Element | null {
  let ancestor = composedParent(node);
  while (ancestor && ancestor.getAttribute('role') !== 'article') {
    ancestor = composedParent(ancestor);
  }
  const rect = ancestor ? rectOf(ancestor) : null;
  if (!ancestor || !rect) return null;
  const size = rectSize(rect);
  return size.width <= limits.maxWidth && size.height <= limits.maxHeight ? ancestor : null;
}

/**
 * Firefox's heuristic. Returns the element to highlight for a hovered
 * element, or null if nothing reasonable is found.
 */
export function bestElement(start: Element, limits: DetectLimits, rectOf: RectFn): Element | null {
  const candidate = walkToCandidate(start, limits, rectOf);
  if (!candidate) return null;
  const chosen = articleAncestor(candidate, limits, rectOf) ?? candidate;
  const rect = rectOf(chosen);
  if (!rect || isRootContainer(chosen)) return null;
  const size = rectSize(rect);
  const tiny = size.width < MIN_DETECT_ABSOLUTE_WIDTH || size.height < MIN_DETECT_ABSOLUTE_HEIGHT;
  return tiny ? null : chosen;
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

export function hasArea(element: Element, rectOf: RectFn = topLevelRect): boolean {
  const rect = rectOf(element);
  return !!rect && rect.right - rect.left >= 1 && rect.bottom - rect.top >= 1;
}

function sameBox(first: Element, second: Element, rectOf: RectFn): boolean {
  const firstRect = rectOf(first);
  const secondRect = rectOf(second);
  return !!firstRect && !!secondRect && sameRect(firstRect, secondRect);
}

/**
 * Nearest ancestor whose box differs from `element`'s. Wrappers with an
 * identical box would make "go to parent" look like nothing happened. Stops
 * below <html>.
 */
export function visibleParent(element: Element, rectOf: RectFn = topLevelRect): Element | null {
  const isCandidate = (node: Element) => hasArea(node, rectOf) && !sameBox(node, element, rectOf);
  let parent = composedParent(element);
  while (parent && parent !== parent.ownerDocument.documentElement && !isCandidate(parent)) {
    parent = composedParent(parent);
  }
  return parent && parent !== parent.ownerDocument.documentElement ? parent : null;
}

/** Visible children with distinct boxes, looking through same-box wrappers. */
function visibleChildren(element: Element, rectOf: RectFn): Element[] {
  const collect = (parent: Element, depth: number): Element[] =>
    composedChildren(parent)
      .filter((child) => hasArea(child, rectOf))
      .flatMap((child) =>
        sameBox(child, element, rectOf) && depth < 16 ? collect(child, depth + 1) : [child],
      );
  return collect(element, 0);
}

/**
 * A child to descend into: the one containing `point` (top-level client
 * coordinates) if any, else the first visible child.
 */
export function visibleChild(
  element: Element,
  point: { x: number; y: number } | null,
  rectOf: RectFn = topLevelRect,
): Element | null {
  const children = visibleChildren(element, rectOf);
  const underPoint = point
    ? children.find((child) => {
        const rect = rectOf(child);
        return (
          !!rect &&
          point.x >= rect.left &&
          point.x < rect.right &&
          point.y >= rect.top &&
          point.y < rect.bottom
        );
      })
    : undefined;
  return underPoint ?? children[0] ?? null;
}

/** Next or previous sibling (in the composed tree) that has a visible box. */
export function visibleSibling(
  element: Element,
  direction: 1 | -1,
  rectOf: RectFn = topLevelRect,
): Element | null {
  const parent = composedParent(element);
  if (!parent) return null;
  const siblings = composedChildren(parent);
  const index = siblings.indexOf(element);
  const candidates =
    direction === 1 ? siblings.slice(index + 1) : siblings.slice(0, Math.max(0, index)).reverse();
  return candidates.find((sibling) => hasArea(sibling, rectOf)) ?? null;
}

/** A short CSS-like label, e.g. `div#main.card.wide`. */
export function describeElement(element: Element, maxClasses = 3): string {
  const id = element.id ? `#${element.id}` : '';
  const classes = Array.from(element.classList)
    .slice(0, maxClasses)
    .map((name) => `.${name}`)
    .join('');
  const more = element.classList.length > maxClasses ? '...' : '';
  const label = `${element.localName}${id}${classes}${more}`;
  return label.length > 80 ? `${label.slice(0, 77)}...` : label;
}
