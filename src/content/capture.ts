/**
 * Capture an arbitrary page region by scrolling the window and stitching
 * `captureVisibleTab` tiles onto a canvas. See docs/design-notes.md, "Capturing
 * pixels".
 */

import { dataUrlToBlob } from '../shared/bytes';
import {
  clampOutputSize,
  clampRect,
  contains,
  height,
  intersect,
  isEmpty,
  planTiles,
  roundRect,
  toDeviceSpan,
  width,
  type Point,
  type Rect,
} from '../shared/geometry';
import { afterPaint, measurePage, viewportRect, type PageMetrics } from './page';

export interface CaptureOptions {
  /** Region to capture, in page coordinates. */
  region: Rect;
  /**
   * What to do with `position: fixed` / `sticky` elements when stitching
   * several tiles, so headers and toolbars do not repeat:
   *  - 'first-tile': keep them in the first tile only (full-page captures,
   *    where the header belongs at the top).
   *  - 'as-seen': keep them only if the first tile is exactly what the user
   *    is looking at. Otherwise hide them, except inside `keep`, where
   *    sticky parts (e.g. table headers) stay for the first tile.
   * Single-tile captures never hide anything.
   */
  fixedElements: 'first-tile' | 'as-seen';
  /** Never hide this element's fixed/sticky ancestors (it is what the user picked). */
  keep?: Element | null;
  /** Elements to leave alone entirely, e.g. our own overlay host. */
  ignore?: Element[];
  /** Returns a PNG data URL of the visible viewport. */
  captureViewport: (progress: { done: number; total: number }) => Promise<string>;
}

export interface CaptureResult {
  canvas: OffscreenCanvas;
  /** True if the output was cropped to fit canvas size limits. */
  cropped: boolean;
}

/** The output canvas, created when the first tile tells us the scale. */
interface Output {
  canvas: OffscreenCanvas;
  context: OffscreenCanvasRenderingContext2D;
  scale: number;
  region: Rect;
  cropped: boolean;
}

export async function captureRegion(opts: CaptureOptions): Promise<CaptureResult> {
  const metrics = measurePage();
  const region = clampRect(roundRect(opts.region), metrics.bounds);
  if (isEmpty(region)) throw new Error('The selected region is empty');

  const tiles: Point[] = contains(viewportRect(metrics), region)
    ? [{ x: metrics.scrollX, y: metrics.scrollY }]
    : planTiles(
        region,
        { width: metrics.clientWidth, height: metrics.clientHeight },
        metrics.range,
        { x: metrics.scrollX, y: metrics.scrollY },
      );
  const firstTile = tiles[0];
  const firstIsAsSeen =
    !!firstTile && firstTile.x === metrics.scrollX && firstTile.y === metrics.scrollY;

  const scrollGuard = new ScrollGuard();
  const hider = new FixedElementHider(opts.keep ?? null, opts.ignore ?? []);
  let output: Output | null = null;
  try {
    scrollGuard.engage();
    for (const [index, tile] of tiles.entries()) {
      if (index === 0 && tiles.length > 1 && opts.fixedElements === 'as-seen' && !firstIsAsSeen) {
        hider.hide('outside-keep');
      }
      if (index === 1) hider.hide('all');
      output = await captureTile(opts, metrics, region, tile, output, {
        done: index,
        total: tiles.length,
      });
    }
  } finally {
    hider.restore();
    scrollGuard.release();
  }

  if (!output) throw new Error('Nothing was captured');
  return { canvas: output.canvas, cropped: output.cropped };
}

/** Scroll to one tile, capture it, and draw its part of the region. */
async function captureTile(
  opts: CaptureOptions,
  metrics: PageMetrics,
  region: Rect,
  tile: Point,
  previous: Output | null,
  progress: { done: number; total: number },
): Promise<Output> {
  if (window.scrollX !== tile.x || window.scrollY !== tile.y) {
    window.scrollTo({ left: tile.x, top: tile.y, behavior: 'instant' });
  }
  await afterPaint();
  // Use where the browser actually scrolled to, not where we asked.
  const scrolledTo = { x: window.scrollX, y: window.scrollY };
  const bitmap = await createImageBitmap(dataUrlToBlob(await opts.captureViewport(progress)));
  try {
    const output = previous ?? createOutput(region, captureScale(bitmap.width));
    const visible: Rect = {
      left: scrolledTo.x,
      top: scrolledTo.y,
      right: scrolledTo.x + metrics.clientWidth,
      bottom: scrolledTo.y + metrics.clientHeight,
    };
    const part = intersect(output.region, visible);
    if (part) drawPart(output, bitmap, part, scrolledTo);
    return output;
  } finally {
    bitmap.close();
  }
}

function createOutput(region: Rect, scale: number): Output {
  const size = clampOutputSize({
    width: Math.round(width(region) * scale),
    height: Math.round(height(region) * scale),
  });
  const outputRegion = size.cropped
    ? {
        ...region,
        right: region.left + size.width / scale,
        bottom: region.top + size.height / scale,
      }
    : region;
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create a canvas this large');
  // Tiles are copied pixel for pixel. When a tile is stretched by a pixel at
  // fractional scales, smoothing would blend colours across edges.
  context.imageSmoothingEnabled = false;
  return { canvas, context, scale, region: outputRegion, cropped: size.cropped };
}

function drawPart(output: Output, bitmap: ImageBitmap, part: Rect, scrolledTo: Point) {
  const { scale, region } = output;
  const destX = toDeviceSpan(part.left, part.right, region.left, scale);
  const destY = toDeviceSpan(part.top, part.bottom, region.top, scale);
  const sourceX = Math.round((part.left - scrolledTo.x) * scale);
  const sourceY = Math.round((part.top - scrolledTo.y) * scale);
  // At fractional scales the bitmap can be a pixel short of the ideal
  // size. Stretching that last pixel is better than a transparent row.
  const sourceWidth = Math.min(destX.length, bitmap.width - sourceX);
  const sourceHeight = Math.min(destY.length, bitmap.height - sourceY);
  if (sourceWidth > 0 && sourceHeight > 0) {
    output.context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      destX.start,
      destY.start,
      destX.length,
      destY.length,
    );
  }
}

/**
 * Device pixels per CSS pixel in the captured bitmap. The bitmap covers the
 * whole window, scrollbars included. `innerWidth` is rounded to whole CSS
 * pixels, so the measured ratio is slightly off at fractional scales like
 * 1.25. Trust devicePixelRatio when it agrees with the bitmap.
 */
function captureScale(bitmapWidth: number): number {
  const measured = bitmapWidth / window.innerWidth;
  const dpr = window.devicePixelRatio || 1;
  return Math.abs(measured - dpr) < 0.01 ? dpr : measured;
}

interface SavedStyle {
  element: HTMLElement | SVGElement;
  props: Array<{ name: string; value: string; priority: string }>;
}

function overrideStyle(
  element: HTMLElement | SVGElement,
  props: Record<string, string>,
): SavedStyle {
  const saved = Object.keys(props).map((name) => ({
    name,
    value: element.style.getPropertyValue(name),
    priority: element.style.getPropertyPriority(name),
  }));
  for (const [name, value] of Object.entries(props)) {
    element.style.setProperty(name, value, 'important');
  }
  return { element, props: saved };
}

function restoreStyle(saved: SavedStyle) {
  for (const { name, value, priority } of saved.props) {
    if (value) saved.element.style.setProperty(name, value, priority);
    else saved.element.style.removeProperty(name);
  }
}

/** Makes programmatic scrolling instant and exact, and restores the user's position. */
class ScrollGuard {
  #saved: SavedStyle[] = [];
  #scrollX = 0;
  #scrollY = 0;

  engage() {
    this.#scrollX = window.scrollX;
    this.#scrollY = window.scrollY;
    // document.body can be null (e.g. frameset or SVG documents).
    const roots: (HTMLElement | null)[] = [document.documentElement, document.body];
    this.#saved = roots
      .filter((root) => root !== null)
      .map((root) =>
        overrideStyle(root, { 'scroll-behavior': 'auto', 'scroll-snap-type': 'none' }),
      );
  }

  release() {
    window.scrollTo({ left: this.#scrollX, top: this.#scrollY, behavior: 'instant' });
    this.#saved.forEach(restoreStyle);
    this.#saved = [];
  }
}

/** Temporarily hides fixed and sticky elements while stitching. */
class FixedElementHider {
  #saved: SavedStyle[] = [];
  #hidden = new Set<Element>();
  readonly #keep: Element | null;
  readonly #ignore: Element[];

  constructor(keep: Element | null, ignore: Element[]) {
    this.#keep = keep;
    this.#ignore = ignore;
  }

  /** 'outside-keep' leaves descendants of `keep` alone; 'all' hides those too. */
  hide(scope: 'outside-keep' | 'all') {
    const keep = this.#keep;
    const targets = allElements().filter((element) => {
      const position = getComputedStyle(element).position;
      return (
        (position === 'fixed' || position === 'sticky') &&
        !this.#ignore.includes(element) &&
        !this.#hidden.has(element) &&
        // Hiding an ancestor of the picked element would hide the element itself.
        !(keep && element.contains(keep)) &&
        !(scope === 'outside-keep' && keep?.contains(element))
      );
    });
    for (const element of targets) {
      this.#hidden.add(element);
      this.#saved.push(
        overrideStyle(element, { opacity: '0', transition: 'none', animation: 'none' }),
      );
    }
  }

  restore() {
    this.#saved.forEach(restoreStyle);
    this.#saved = [];
    this.#hidden.clear();
  }
}

function allElements(): (HTMLElement | SVGElement)[] {
  return Array.from(document.querySelectorAll('*')).filter(
    (element) => element instanceof HTMLElement || element instanceof SVGElement,
  );
}
