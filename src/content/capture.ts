/**
 * Capture an arbitrary page region by scrolling the window and stitching
 * `captureVisibleTab` tiles onto a canvas. See docs/DESIGN.md, "Capturing
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
import { afterPaint, measurePage, viewportRect } from './page';

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

export class CaptureError extends Error {
  constructor(
    message: string,
    readonly code: 'empty' | 'canvas',
  ) {
    super(message);
  }
}

export async function captureRegion(opts: CaptureOptions): Promise<CaptureResult> {
  const metrics = measurePage();
  let region = clampRect(roundRect(opts.region), metrics.bounds);
  if (isEmpty(region)) throw new CaptureError('The selected region is empty', 'empty');

  const tiles: Point[] = contains(viewportRect(metrics), region)
    ? [{ x: metrics.scrollX, y: metrics.scrollY }]
    : planTiles(
        region,
        { width: metrics.clientWidth, height: metrics.clientHeight },
        metrics.range,
        { x: metrics.scrollX, y: metrics.scrollY },
      );
  const first = tiles[0];
  const firstIsAsSeen = !!first && first.x === metrics.scrollX && first.y === metrics.scrollY;

  const scrollGuard = new ScrollGuard();
  const hider = new FixedElementHider(opts.keep ?? null, opts.ignore ?? []);
  let canvas: OffscreenCanvas | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  let scale = 1;
  let cropped = false;

  try {
    scrollGuard.engage();
    for (const [i, tile] of tiles.entries()) {
      if (i === 0 && tiles.length > 1 && opts.fixedElements === 'as-seen' && !firstIsAsSeen) {
        hider.hide('outside-keep');
      }
      if (i === 1) hider.hide('all');
      if (window.scrollX !== tile.x || window.scrollY !== tile.y) {
        window.scrollTo({ left: tile.x, top: tile.y, behavior: 'instant' });
      }
      await afterPaint();
      // Use where the browser actually scrolled to, not where we asked.
      const at = { x: window.scrollX, y: window.scrollY };

      const dataUrl = await opts.captureViewport({ done: i, total: tiles.length });
      const bitmap = await createImageBitmap(dataUrlToBlob(dataUrl));
      try {
        if (!canvas) {
          scale = captureScale(bitmap.width);
          const size = clampOutputSize({
            width: Math.round(width(region) * scale),
            height: Math.round(height(region) * scale),
          });
          if (size.cropped) {
            cropped = true;
            region = {
              ...region,
              right: region.left + size.width / scale,
              bottom: region.top + size.height / scale,
            };
          }
          canvas = new OffscreenCanvas(size.width, size.height);
          ctx = canvas.getContext('2d');
          if (!ctx) throw new CaptureError('Could not create a canvas this large', 'canvas');
        }

        const visible: Rect = {
          left: at.x,
          top: at.y,
          right: at.x + metrics.clientWidth,
          bottom: at.y + metrics.clientHeight,
        };
        const part = intersect(region, visible);
        if (!part || !ctx) continue;
        const dx = toDeviceSpan(part.left, part.right, region.left, scale);
        const dy = toDeviceSpan(part.top, part.bottom, region.top, scale);
        const sx = Math.round((part.left - at.x) * scale);
        const sy = Math.round((part.top - at.y) * scale);
        // At fractional scales the bitmap can be a pixel short of the ideal
        // size. Stretching that last pixel is better than a transparent row.
        const sw = Math.min(dx.length, bitmap.width - sx);
        const sh = Math.min(dy.length, bitmap.height - sy);
        if (sw > 0 && sh > 0) {
          ctx.drawImage(bitmap, sx, sy, sw, sh, dx.start, dy.start, dx.length, dy.length);
        }
      } finally {
        bitmap.close();
      }
    }
  } finally {
    hider.restore();
    scrollGuard.release();
  }

  if (!canvas) throw new CaptureError('Nothing was captured', 'empty');
  return { canvas, cropped };
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
  el: HTMLElement | SVGElement;
  props: Array<{ name: string; value: string; priority: string }>;
}

function overrideStyle(el: HTMLElement | SVGElement, props: Record<string, string>): SavedStyle {
  const saved: SavedStyle = { el, props: [] };
  for (const [name, value] of Object.entries(props)) {
    saved.props.push({
      name,
      value: el.style.getPropertyValue(name),
      priority: el.style.getPropertyPriority(name),
    });
    el.style.setProperty(name, value, 'important');
  }
  return saved;
}

function restoreStyle(saved: SavedStyle) {
  for (const { name, value, priority } of saved.props) {
    if (value) saved.el.style.setProperty(name, value, priority);
    else saved.el.style.removeProperty(name);
  }
}

/** Makes programmatic scrolling instant and exact, and restores the user's position. */
class ScrollGuard {
  #saved: SavedStyle[] = [];
  #x = 0;
  #y = 0;

  engage() {
    this.#x = window.scrollX;
    this.#y = window.scrollY;
    // document.body can be null (e.g. frameset or SVG documents).
    const roots: (HTMLElement | null)[] = [document.documentElement, document.body];
    for (const el of roots) {
      if (el) {
        this.#saved.push(
          overrideStyle(el, { 'scroll-behavior': 'auto', 'scroll-snap-type': 'none' }),
        );
      }
    }
  }

  release() {
    window.scrollTo({ left: this.#x, top: this.#y, behavior: 'instant' });
    this.#saved.forEach(restoreStyle);
    this.#saved = [];
  }
}

/** Temporarily hides fixed and sticky elements while stitching. */
class FixedElementHider {
  #saved: SavedStyle[] = [];
  #hidden = new Set<Element>();

  constructor(
    private readonly keep: Element | null,
    private readonly ignore: Element[],
  ) {}

  /** 'outside-keep' leaves descendants of `keep` alone; 'all' hides those too. */
  hide(scope: 'outside-keep' | 'all') {
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node as Element;
      if (!(el instanceof HTMLElement || el instanceof SVGElement)) continue;
      if (this.ignore.includes(el)) continue;
      const position = getComputedStyle(el).position;
      if (position !== 'fixed' && position !== 'sticky') continue;
      // Hiding an ancestor of the picked element would hide the element itself.
      if (this.keep && el.contains(this.keep)) continue;
      if (scope === 'outside-keep' && this.keep?.contains(el)) continue;
      if (this.#hidden.has(el)) continue;
      this.#hidden.add(el);
      this.#saved.push(overrideStyle(el, { opacity: '0', transition: 'none', animation: 'none' }));
    }
  }

  restore() {
    this.#saved.forEach(restoreStyle);
    this.#saved = [];
    this.#hidden.clear();
  }
}
