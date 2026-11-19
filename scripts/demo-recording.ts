// Records a page with the DevTools screencast and encodes the frames as an
// animated GIF with sharp. Nothing outside `pnpm install` is needed.
//
// The screencast only sends a frame when the page changes, so frames are
// sampled at a fixed rate: each GIF frame shows the latest recorded frame
// at its time.

import type { CDPSession, Page } from 'puppeteer-core';
import sharp from 'sharp';

interface Frame {
  /** Milliseconds since the recording started. */
  time: number;
  png: Buffer;
}

export interface GifOptions {
  width: number;
  height: number;
  fps: number;
}

export class Recording {
  readonly #session: CDPSession;
  readonly #origin: number;
  readonly #frames: Frame[];

  private constructor(session: CDPSession, origin: number, frames: Frame[]) {
    this.#session = session;
    this.#origin = origin;
    this.#frames = frames;
  }

  static async start(page: Page): Promise<Recording> {
    const session = await page.createCDPSession();
    const origin = Date.now();
    const frames: Frame[] = [];
    session.on('Page.screencastFrame', (event) => {
      // The metadata timestamp is in seconds since the epoch.
      const epochMs = (event.metadata.timestamp ?? Date.now() / 1000) * 1000;
      frames.push({ time: epochMs - origin, png: Buffer.from(event.data, 'base64') });
      // Chrome sends no more frames until each one is acknowledged.
      void session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
    });
    await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    return new Recording(session, origin, frames);
  }

  /** Stop recording. Returns the length of the recording in milliseconds. */
  async stop(): Promise<number> {
    const length = Date.now() - this.#origin;
    await this.#session.send('Page.stopScreencast');
    await this.#session.detach();
    return length;
  }

  /** Encode the frames as a looping GIF of `options.width` x `options.height`. */
  async encodeGif(length: number, { width, height, fps }: GifOptions): Promise<Buffer> {
    const frames = this.#frames;
    const first = frames[0];
    if (!first) throw new Error('No frames were recorded');
    const count = Math.ceil((length * fps) / 1000);
    const interval = 1000 / fps;
    const frameBytes = width * height * 3;
    const pixels = Buffer.alloc(count * frameBytes);
    let index = 0;
    let decodedIndex = -1;
    let decoded = Buffer.alloc(0);
    for (let tick = 0; tick < count; tick++) {
      const time = tick * interval;
      // Frames arrive in time order, so the index only moves forward.
      while ((frames[index + 1]?.time ?? Infinity) <= time) index++;
      if (index !== decodedIndex) {
        const frame = frames[index] ?? first;
        decoded = await sharp(frame.png)
          .resize(width, height, { fit: 'fill' })
          .removeAlpha()
          .raw()
          .toBuffer();
        decodedIndex = index;
      }
      decoded.copy(pixels, tick * frameBytes);
    }
    return sharp(pixels, {
      raw: { width, height: height * count, channels: 3, pageHeight: height },
    })
      .gif({
        delay: Array.from({ length: count }, () => Math.round(interval)),
        loop: 0,
        colours: 256,
        effort: 7,
      })
      .toBuffer();
  }
}
