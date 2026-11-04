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

export function width(r: Rect): number {
  return r.right - r.left;
}

export function height(r: Rect): number {
  return r.bottom - r.top;
}

export function isEmpty(r: Rect): boolean {
  return width(r) <= 0 || height(r) <= 0;
}

/** Build a rect from two arbitrary corners. */
export function fromPoints(a: Point, b: Point): Rect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}

export function translate(r: Rect, dx: number, dy: number): Rect {
  return { left: r.left + dx, top: r.top + dy, right: r.right + dx, bottom: r.bottom + dy };
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const r = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return isEmpty(r) ? null : r;
}

export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.left >= outer.left &&
    inner.top >= outer.top &&
    inner.right <= outer.right &&
    inner.bottom <= outer.bottom
  );
}

export function sameRect(a: Rect, b: Rect, tolerance = 0.5): boolean {
  return (
    Math.abs(a.left - b.left) <= tolerance &&
    Math.abs(a.top - b.top) <= tolerance &&
    Math.abs(a.right - b.right) <= tolerance &&
    Math.abs(a.bottom - b.bottom) <= tolerance
  );
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Clamp every edge of `r` into `bounds`. */
export function clampRect(r: Rect, bounds: Rect): Rect {
  return {
    left: clamp(r.left, bounds.left, bounds.right),
    top: clamp(r.top, bounds.top, bounds.bottom),
    right: clamp(r.right, bounds.left, bounds.right),
    bottom: clamp(r.bottom, bounds.top, bounds.bottom),
  };
}

/**
 * Move `r` (without resizing it) so it lies inside `bounds` where possible.
 * If `r` is larger than `bounds` on an axis it is aligned to the start edge.
 */
export function shiftInto(r: Rect, bounds: Rect): Rect {
  let dx = 0;
  let dy = 0;
  if (r.right > bounds.right) dx = bounds.right - r.right;
  if (r.left + dx < bounds.left) dx = bounds.left - r.left;
  if (r.bottom > bounds.bottom) dy = bounds.bottom - r.bottom;
  if (r.top + dy < bounds.top) dy = bounds.top - r.top;
  return translate(r, dx, dy);
}

/** Round edges to whole CSS pixels, the way Firefox does before capturing. */
export function roundRect(r: Rect): Rect {
  return {
    left: Math.round(r.left),
    top: Math.round(r.top),
    right: Math.round(r.right),
    bottom: Math.round(r.bottom),
  };
}

/**
 * Scroll positions along one axis needed to bring [start, end) into view
 * with a viewport of `size`, given the scroll range [minScroll, maxScroll].
 * Positions are clamped to the scroll range, so the final tile may overlap
 * the previous one.
 */
export function scrollStops(
  start: number,
  end: number,
  size: number,
  minScroll: number,
  maxScroll: number,
): number[] {
  if (size <= 0) throw new Error('viewport size must be positive');
  const stops: number[] = [];
  let want = start;
  for (;;) {
    const stop = clamp(want, minScroll, maxScroll);
    if (stops.length === 0 || stop !== stops[stops.length - 1]) stops.push(stop);
    if (stop + size >= end) break;
    // The region extends past what scrolling can reveal; nothing more to do.
    if (stop >= maxScroll) break;
    want = stop + size;
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
export function planTiles(region: Rect, viewport: Size, range: ScrollRange): Point[] {
  const xs = scrollStops(region.left, region.right, viewport.width, range.minX, range.maxX);
  const ys = scrollStops(region.top, region.bottom, viewport.height, range.minY, range.maxY);
  const tiles: Point[] = [];
  for (const y of ys) for (const x of xs) tiles.push({ x, y });
  return tiles;
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
  let { width: w, height: h } = size;
  let cropped = false;
  if (w > MAX_CAPTURE_DIMENSION) {
    w = MAX_CAPTURE_DIMENSION;
    cropped = true;
  }
  if (h > MAX_CAPTURE_DIMENSION) {
    h = MAX_CAPTURE_DIMENSION;
    cropped = true;
  }
  if (w * h > MAX_CAPTURE_AREA) {
    h = Math.floor(MAX_CAPTURE_AREA / w);
    cropped = true;
  }
  return { width: w, height: h, cropped };
}

/**
 * Map a CSS-pixel span to device pixels so that neighbouring spans share
 * edges exactly (no gaps or double-drawn rows when stitching).
 */
export function toDeviceSpan(start: number, end: number, origin: number, scale: number) {
  const a = Math.round((start - origin) * scale);
  const b = Math.round((end - origin) * scale);
  return { start: a, length: b - a };
}
