import { describe, expect, test } from 'vitest';
import {
  clampOutputSize,
  clampRect,
  fromPoints,
  intersect,
  MAX_CAPTURE_AREA,
  MAX_CAPTURE_DIMENSION,
  planTiles,
  scrollStops,
  shiftInto,
  toDeviceSpan,
} from '../../src/shared/geometry';

describe('scrollStops', () => {
  test('a span that fits needs one stop at its start', () => {
    expect(scrollStops(100, 500, 800, 0, 3000)).toEqual([100]);
  });

  test('a long span is covered in viewport-sized steps', () => {
    expect(scrollStops(0, 2000, 800, 0, 3000)).toEqual([0, 800, 1600]);
  });

  test('stops are clamped to the scroll range, so the last tile overlaps', () => {
    // Page is 2000 tall, viewport 800: max scroll is 1200.
    expect(scrollStops(0, 2000, 800, 0, 1200)).toEqual([0, 800, 1200]);
  });

  test('starts at the current scroll position when the span already starts on screen', () => {
    expect(scrollStops(60, 2460, 800, 0, 3200, 0)).toEqual([0, 800, 1600, 2400]);
  });

  test('ignores the current position when the span starts off screen', () => {
    expect(scrollStops(1000, 2000, 800, 0, 3200, 0)).toEqual([1000, 1800]);
  });

  test('negative ranges (right-to-left pages) work', () => {
    expect(scrollStops(-1500, 0, 800, -1500, -700)).toEqual([-1500, -700]);
  });

  test('never loops forever when the span extends past the scrollable area', () => {
    expect(scrollStops(0, 10_000, 800, 0, 0)).toEqual([0]);
  });

  test('rejects an empty viewport', () => {
    expect(() => scrollStops(0, 10, 0, 0, 0)).toThrow();
  });
});

describe('planTiles', () => {
  test('covers a region row by row', () => {
    const tiles = planTiles(
      { left: 0, top: 0, right: 1500, bottom: 1000 },
      { width: 1000, height: 600 },
      { minX: 0, minY: 0, maxX: 500, maxY: 400 },
    );
    expect(tiles).toEqual([
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 0, y: 400 },
      { x: 500, y: 400 },
    ]);
  });
});

describe('rect helpers', () => {
  test('fromPoints normalises any two corners', () => {
    expect(fromPoints({ x: 10, y: 50 }, { x: 5, y: 2 })).toEqual({
      left: 5,
      top: 2,
      right: 10,
      bottom: 50,
    });
  });

  test('intersect returns null for disjoint rects', () => {
    expect(
      intersect(
        { left: 0, top: 0, right: 10, bottom: 10 },
        { left: 10, top: 0, right: 20, bottom: 10 },
      ),
    ).toBeNull();
  });

  test('clampRect keeps edges inside bounds', () => {
    expect(
      clampRect(
        { left: -5, top: 10, right: 50, bottom: 500 },
        { left: 0, top: 0, right: 40, bottom: 100 },
      ),
    ).toEqual({ left: 0, top: 10, right: 40, bottom: 100 });
  });

  test('shiftInto moves without resizing', () => {
    expect(
      shiftInto(
        { left: 90, top: -10, right: 110, bottom: 10 },
        { left: 0, top: 0, right: 100, bottom: 100 },
      ),
    ).toEqual({ left: 80, top: 0, right: 100, bottom: 20 });
  });
});

describe('clampOutputSize', () => {
  test('leaves normal sizes alone', () => {
    expect(clampOutputSize({ width: 1920, height: 20_000 })).toEqual({
      width: 1920,
      height: 20_000,
      cropped: false,
    });
  });

  test('caps each side', () => {
    const r = clampOutputSize({ width: 100, height: 50_000 });
    expect(r.height).toBe(MAX_CAPTURE_DIMENSION);
    expect(r.cropped).toBe(true);
  });

  test('caps the total area by trimming the height', () => {
    const r = clampOutputSize({ width: 10_000, height: 20_000 });
    expect(r.width).toBe(10_000);
    expect(r.width * r.height).toBeLessThanOrEqual(MAX_CAPTURE_AREA);
    expect(r.cropped).toBe(true);
  });
});

describe('toDeviceSpan', () => {
  test('adjacent spans share edges exactly at fractional scales', () => {
    const scale = 1.25;
    const a = toDeviceSpan(0, 333, 0, scale);
    const b = toDeviceSpan(333, 666, 0, scale);
    expect(a.start + a.length).toBe(b.start);
  });
});
