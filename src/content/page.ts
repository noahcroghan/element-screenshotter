import type { Rect, ScrollRange } from '../shared/geometry';

/** A snapshot of the top-level document's scroll geometry, in CSS pixels. */
export interface PageMetrics {
  /** Viewport size excluding scrollbars. */
  clientWidth: number;
  clientHeight: number;
  scrollX: number;
  scrollY: number;
  /** The whole scrollable page, in page coordinates (`clientX + scrollX`). */
  bounds: Rect;
  range: ScrollRange;
}

function scrollingBox(doc: Document): Element {
  const body = doc.body as HTMLElement | null;
  return doc.compatMode === 'BackCompat' && body ? body : doc.documentElement;
}

export function measurePage(win: Window = window): PageMetrics {
  const doc = win.document;
  const box = scrollingBox(doc);
  const clientWidth = box.clientWidth || win.innerWidth;
  const clientHeight = box.clientHeight || win.innerHeight;
  const root = doc.scrollingElement ?? doc.documentElement;
  const scrollWidth = Math.max(root.scrollWidth, clientWidth);
  const scrollHeight = Math.max(root.scrollHeight, clientHeight);

  // In right-to-left documents Chromium uses negative horizontal offsets:
  // scrollX runs from -(scrollWidth - clientWidth) up to 0.
  const rtl = win.getComputedStyle(doc.documentElement).direction === 'rtl';
  const minX = rtl ? clientWidth - scrollWidth : 0;

  return {
    clientWidth,
    clientHeight,
    scrollX: win.scrollX,
    scrollY: win.scrollY,
    bounds: { left: minX, top: 0, right: minX + scrollWidth, bottom: scrollHeight },
    range: {
      minX,
      minY: 0,
      maxX: minX + scrollWidth - clientWidth,
      maxY: scrollHeight - clientHeight,
    },
  };
}

/** The visible viewport in page coordinates. */
export function viewportRect(m: PageMetrics): Rect {
  return {
    left: m.scrollX,
    top: m.scrollY,
    right: m.scrollX + m.clientWidth,
    bottom: m.scrollY + m.clientHeight,
  };
}

export function nextFrame(win: Window = window): Promise<void> {
  return new Promise((resolve) => {
    win.requestAnimationFrame(() => {
      resolve();
    });
  });
}

/** Wait until the browser has painted the current DOM state. */
export async function afterPaint(win: Window = window): Promise<void> {
  await nextFrame(win);
  await nextFrame(win);
}
