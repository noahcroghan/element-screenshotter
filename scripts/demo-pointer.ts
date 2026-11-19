// Moves the mouse in the demo recording the way a hand does, following the
// usual model of human pointing:
//
// - Each move takes longer the farther and smaller its target (Fitts's law).
// - A fast first movement speeds up quickly, slows down for longer, and lands
//   a little short or to the side. A short, slower second movement corrects it.
// - The path bends slightly, the same way each time, like a wrist turning.
// - The pointer only takes whole pixels, trembles a little while moving, and
//   drifts by a pixel or two while the hand rests.
//
// All randomness comes from a seeded generator, so every run moves the same way.

import type { Page } from 'puppeteer-core';
import { type Rect, sleep } from '../test/e2e/harness.ts';

export interface Point {
  x: number;
  y: number;
}

/** The pause between positions when the pointer didn't move a whole pixel. */
const IDLE_MS = 4;

/** A seeded random generator (mulberry32), so every run moves the same way. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Starts and stops gently, with no sudden acceleration (minimum jerk). */
function minimumJerk(progress: number): number {
  return progress * progress * progress * (progress * (6 * progress - 15) + 10);
}

/** A point on a cubic Bezier curve from `start` to `end` at `time` (0 to 1). */
function cubic(start: Point, first: Point, second: Point, end: Point, time: number): Point {
  const rest = 1 - time;
  const w0 = rest * rest * rest;
  const w1 = 3 * rest * rest * time;
  const w2 = 3 * rest * time * time;
  const w3 = time * time * time;
  return {
    x: w0 * start.x + w1 * first.x + w2 * second.x + w3 * end.x,
    y: w0 * start.y + w1 * first.y + w2 * second.y + w3 * end.y,
  };
}

export class Pointer {
  readonly #page: Page;
  readonly #random: () => number;
  #position: Point;

  private constructor(page: Page, start: Point, random: () => number) {
    this.#page = page;
    this.#random = random;
    this.#position = start;
  }

  static async create(page: Page, start: Point, random: () => number): Promise<Pointer> {
    const rounded = { x: Math.round(start.x), y: Math.round(start.y) };
    await page.mouse.move(rounded.x, rounded.y);
    return new Pointer(page, rounded, random);
  }

  /** A normally distributed number (Box-Muller). */
  #gaussian(mean: number, deviation: number): number {
    const radius = Math.sqrt(-2 * Math.log(1 - this.#random()));
    return mean + deviation * radius * Math.cos(2 * Math.PI * this.#random());
  }

  /**
   * Move to a point in `box`, near `aim` (fractions of its width and height,
   * the middle unless given) but not exactly on it.
   */
  async moveInto(box: Rect, aim = { x: 0.5, y: 0.5 }) {
    const width = box.right - box.left;
    const height = box.bottom - box.top;
    const point = {
      x: clamp(
        this.#gaussian(box.left + width * aim.x, width * 0.06),
        box.left + width * 0.1,
        box.right - width * 0.1,
      ),
      y: clamp(
        this.#gaussian(box.top + height * aim.y, height * 0.1),
        box.top + height * 0.15,
        box.bottom - height * 0.15,
      ),
    };
    await this.moveTo(point, Math.max(8, Math.min(width, height)));
  }

  /** Move by an offset, for example off a selection after clicking it. */
  async moveBy(dx: number, dy: number) {
    await this.moveTo({ x: this.#position.x + dx, y: this.#position.y + dy }, 40);
  }

  /** Point at `aim`, a target `size` pixels across: a fast move, then a correction. */
  async moveTo(aim: Point, size: number) {
    const from = this.#position;
    const distance = Math.hypot(aim.x - from.x, aim.y - from.y);
    if (distance < 1) return;
    const along = { x: (aim.x - from.x) / distance, y: (aim.y - from.y) / distance };
    const across = { x: -along.y, y: along.x };

    // Fitts's law, a little slower than a fast user, so viewers can follow.
    const total =
      (300 + 170 * Math.log2(distance / size + 1)) * clamp(this.#gaussian(1, 0.08), 0.85, 1.15);

    // The first movement lands a few percent short and slightly to the side.
    const short = distance * this.#gaussian(0.04, 0.025);
    const side = this.#gaussian(0, distance * 0.015);
    const landing = {
      x: aim.x - along.x * short + across.x * side,
      y: aim.y - along.y * short + across.y * side,
    };
    // Always bent the same way, as a wrist turns, by a varying amount.
    const bend = distance * this.#gaussian(0.05, 0.02);
    const curve = (fraction: number, scale: number) => ({
      x: from.x + (landing.x - from.x) * fraction + across.x * bend * scale,
      y: from.y + (landing.y - from.y) * fraction + across.y * bend * scale,
    });
    const first = curve(0.3, 1);
    const second = curve(0.7, 0.8);
    // Speed peaks at about 40% of the time, not halfway: humans brake longer.
    await this.#travel(total * 0.78, (time) =>
      cubic(from, first, second, landing, minimumJerk(time ** 0.82)),
    );

    const miss = Math.hypot(aim.x - landing.x, aim.y - landing.y);
    if (miss < 2) return;
    await this.rest(40 + this.#random() * 50);
    const start = this.#position;
    await this.#travel(110 + 50 * Math.log2(miss + 1), (time) => {
      const progress = minimumJerk(time);
      return {
        x: start.x + (aim.x - start.x) * progress,
        y: start.y + (aim.y - start.y) * progress,
      };
    });
  }

  /**
   * Follow `path` (time 0 to 1) for `ms` milliseconds, trembling slightly.
   * Positions come from the clock and are sent as fast as the browser takes
   * them, because timers are too coarse on Windows (about 16 ms) to pace them.
   */
  async #travel(ms: number, path: (time: number) => Point) {
    const phase = [this.#random(), this.#random()].map((value) => value * 2 * Math.PI);
    const started = performance.now();
    for (;;) {
      const elapsed = performance.now() - started;
      const time = Math.min(1, elapsed / ms);
      const point = path(time);
      // About 9 Hz, a fraction of a pixel, gone by the end of the move.
      const tremble = 0.6 * Math.sin(Math.PI * time);
      const wave = (2 * Math.PI * 9 * elapsed) / 1000;
      const moved = await this.#report({
        x: point.x + tremble * Math.sin(wave + (phase[0] ?? 0)),
        y: point.y + tremble * Math.sin(wave * 1.3 + (phase[1] ?? 0)),
      });
      if (time >= 1) return;
      if (!moved) await sleep(IDLE_MS);
    }
  }

  /** Hold still for `ms` milliseconds, drifting by a pixel now and then. */
  async rest(ms: number) {
    const anchor = this.#position;
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await sleep(Math.min(end - Date.now(), 70 + this.#random() * 150));
      if (Date.now() < end && this.#random() < 0.35) {
        const step = (): number => Math.round(this.#random() * 2 - 1);
        await this.#report({
          x: clamp(this.#position.x + step(), anchor.x - 2, anchor.x + 2),
          y: clamp(this.#position.y + step(), anchor.y - 2, anchor.y + 2),
        });
      }
    }
  }

  /** Press and release where the pointer is, for as long as a finger takes. */
  async click() {
    await this.#page.mouse.down();
    await sleep(70 + this.#random() * 45);
    await this.#page.mouse.up();
  }

  /**
   * Mice report whole pixels, so the pointer moves in whole pixels too.
   * Returns whether it moved.
   */
  async #report(point: Point): Promise<boolean> {
    const rounded = { x: Math.round(point.x), y: Math.round(point.y) };
    if (rounded.x === this.#position.x && rounded.y === this.#position.y) return false;
    this.#position = rounded;
    await this.#page.mouse.move(rounded.x, rounded.y);
    return true;
  }
}
