/**
 * Pure geometry helpers. Everything here works in CSS pixels unless a name
 * says otherwise, and has no DOM dependencies so it can be unit tested.
 */

/** An axis-aligned rectangle given by its edges. `right`/`bottom` are exclusive. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export function width(rect: Rect): number {
  return rect.right - rect.left;
}

export function height(rect: Rect): number {
  return rect.bottom - rect.top;
}

export function isEmpty(rect: Rect): boolean {
  return width(rect) <= 0 || height(rect) <= 0;
}

export function translate(rect: Rect, dx: number, dy: number): Rect {
  return {
    left: rect.left + dx,
    top: rect.top + dy,
    right: rect.right + dx,
    bottom: rect.bottom + dy,
  };
}

export function intersect(first: Rect, second: Rect): Rect | null {
  const overlap = {
    left: Math.max(first.left, second.left),
    top: Math.max(first.top, second.top),
    right: Math.min(first.right, second.right),
    bottom: Math.min(first.bottom, second.bottom),
  };
  return isEmpty(overlap) ? null : overlap;
}

export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.left >= outer.left &&
    inner.top >= outer.top &&
    inner.right <= outer.right &&
    inner.bottom <= outer.bottom
  );
}

/**
 * Where a box sits, as its distance from the nearest side edge and the nearest
 * top or bottom edge. A box near the bottom right stays there when the
 * window is resized.
 */
export interface EdgeAnchor {
  horizontal: 'left' | 'right';
  x: number;
  vertical: 'top' | 'bottom';
  y: number;
}

export function anchorOf(rect: Rect, bounds: Rect): EdgeAnchor {
  const left = rect.left - bounds.left;
  const right = bounds.right - rect.right;
  const top = rect.top - bounds.top;
  const bottom = bounds.bottom - rect.bottom;
  return {
    horizontal: left <= right ? 'left' : 'right',
    x: Math.min(left, right),
    vertical: top <= bottom ? 'top' : 'bottom',
    y: Math.min(top, bottom),
  };
}

/** The rect of a box of `size` placed by `anchor`, kept inside `bounds`. */
export function anchoredRect(anchor: EdgeAnchor, size: Size, bounds: Rect): Rect {
  const left =
    anchor.horizontal === 'left' ? bounds.left + anchor.x : bounds.right - anchor.x - size.width;
  const top =
    anchor.vertical === 'top' ? bounds.top + anchor.y : bounds.bottom - anchor.y - size.height;
  return shiftInto({ left, top, right: left + size.width, bottom: top + size.height }, bounds);
}

/** True if every edge of the two rects is within `tolerance` pixels. */
export function sameRect(first: Rect, second: Rect, tolerance = 0.5): boolean {
  return (
    Math.abs(first.left - second.left) <= tolerance &&
    Math.abs(first.top - second.top) <= tolerance &&
    Math.abs(first.right - second.right) <= tolerance &&
    Math.abs(first.bottom - second.bottom) <= tolerance
  );
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Clamp every edge of `rect` into `bounds`. */
export function clampRect(rect: Rect, bounds: Rect): Rect {
  return {
    left: clamp(rect.left, bounds.left, bounds.right),
    top: clamp(rect.top, bounds.top, bounds.bottom),
    right: clamp(rect.right, bounds.left, bounds.right),
    bottom: clamp(rect.bottom, bounds.top, bounds.bottom),
  };
}

/**
 * Move `rect` (without resizing it) so it lies inside `bounds` where possible.
 * If `rect` is larger than `bounds` on an axis it is aligned to the start edge.
 */
export function shiftInto(rect: Rect, bounds: Rect): Rect {
  const dx = Math.max(bounds.left - rect.left, Math.min(0, bounds.right - rect.right));
  const dy = Math.max(bounds.top - rect.top, Math.min(0, bounds.bottom - rect.bottom));
  return translate(rect, dx, dy);
}

/** Round edges to whole CSS pixels, the way Firefox does before capturing. */
export function roundRect(rect: Rect): Rect {
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
  };
}

/**
 * Scroll positions along one axis needed to bring [start, end) into view
 * with a viewport of `size`, given the scroll range [minScroll, maxScroll].
 * Positions are clamped to the scroll range, so the final tile may overlap
 * the previous one.
 *
 * If `current` (the scroll position the user is looking at) already shows
 * `start`, the first stop is `current`. The part the user saw is then
 * captured exactly as seen.
 */
export function scrollStops(
  start: number,
  end: number,
  size: number,
  minScroll: number,
  maxScroll: number,
  current?: number,
): number[] {
  if (size <= 0) throw new Error('viewport size must be positive');
  const startsOnScreen = current !== undefined && start >= current && start < current + size;
  let stop = clamp(startsOnScreen ? current : start, minScroll, maxScroll);
  const stops = [stop];
  // Keep scrolling while the region extends past the viewport and scrolling
  // can still reveal more of it.
  while (stop + size < end && stop < maxScroll) {
    stop = clamp(stop + size, minScroll, maxScroll);
    stops.push(stop);
  }
  return stops;
}

export interface ScrollRange {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Every scroll position (row-major) needed to cover `region`. */
export function planTiles(
  region: Rect,
  viewport: Size,
  range: ScrollRange,
  current?: Point,
): Point[] {
  const columns = scrollStops(
    region.left,
    region.right,
    viewport.width,
    range.minX,
    range.maxX,
    current?.x,
  );
  const rows = scrollStops(
    region.top,
    region.bottom,
    viewport.height,
    range.minY,
    range.maxY,
    current?.y,
  );
  return rows.flatMap((rowTop) => columns.map((columnLeft) => ({ x: columnLeft, y: rowTop })));
}

/**
 * Canvas limits. These match Firefox (`MAX_CAPTURE_DIMENSION` and its
 * documented area limit). They are also safely inside Chromium's own canvas
 * limits.
 */
export const MAX_CAPTURE_DIMENSION = 32766;
export const MAX_CAPTURE_AREA = 124925329;

/** Shrink a device-pixel size so it fits the canvas limits. */
export function clampOutputSize(size: Size): Size & { cropped: boolean } {
  const clampedWidth = Math.min(size.width, MAX_CAPTURE_DIMENSION);
  const sideLimitedHeight = Math.min(size.height, MAX_CAPTURE_DIMENSION);
  const clampedHeight = Math.min(sideLimitedHeight, Math.floor(MAX_CAPTURE_AREA / clampedWidth));
  return {
    width: clampedWidth,
    height: clampedHeight,
    cropped: clampedWidth !== size.width || clampedHeight !== size.height,
  };
}

/**
 * Map a CSS-pixel span to device pixels so that neighbouring spans share
 * edges exactly (no gaps or double-drawn rows when stitching).
 */
export function toDeviceSpan(start: number, end: number, origin: number, scale: number) {
  const first = Math.round((start - origin) * scale);
  const last = Math.round((end - origin) * scale);
  return { start: first, length: last - first };
}
