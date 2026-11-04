/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * The face is Firefox Screenshots' "preview face" from
 * browser/components/screenshots/ScreenshotsOverlayChild.sys.mjs.
 * The button icons are original to this project. */

import { svg } from './dom';

const ICONS = {
  close:
    'M4.7 3.3 8 6.6l3.3-3.3 1.4 1.4L9.4 8l3.3 3.3-1.4 1.4L8 9.4l-3.3 3.3-1.4-1.4L6.6 8 3.3 4.7z',
  copy: 'M5 1h8a2 2 0 0 1 2 2v8h-2V3H5zM3 4h7a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v7h5V6z',
  download: 'M7 1h2v7.6l2.8-2.8 1.4 1.4L8 12.4 2.8 7.2l1.4-1.4L7 8.6zM2 13h12v2H2z',
  retry:
    'M8 2a6 6 0 1 0 5.66 8h-2.13A4 4 0 1 1 8 4c1.1 0 2.1.45 2.83 1.17L9 7h5V2l-1.76 1.76A6 6 0 0 0 8 2z',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): SVGElement {
  return svg(
    'svg',
    { viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { d: ICONS[name], 'fill-rule': 'evenodd' }),
  );
}

export interface Face {
  root: SVGElement;
  leftPupil: SVGElement;
  rightPupil: SVGElement;
}

export function face(): Face {
  const line = (d: string) => svg('path', { d, class: 'face-line' });
  const leftPupil = svg('ellipse', { cx: 25, cy: 30, rx: 3, ry: 3, class: 'face-pupil' });
  const rightPupil = svg('ellipse', { cx: 45, cy: 30, rx: 3, ry: 3, class: 'face-pupil' });
  const root = svg(
    'svg',
    { viewBox: '0 0 64 64', 'aria-hidden': 'true' },
    svg(
      'g',
      {},
      line('M11.4.9v2.9h-6c-.9 0-1.5.8-1.5 1.5v6H.8V3.8C.8 2.1 2.2.7 3.9.7h7.6v.2z'),
      line('M63.2 11.4h-3.1v-6c0-.8-.6-1.5-1.5-1.5h-6v-3h7.6c1.7 0 3.1 1.4 3.1 3.1z'),
      line('M52.6 63.2v-3.1h6c.9 0 1.5-.6 1.5-1.5v-6h3.1v7.6c0 1.7-1.4 3.1-3.1 3.1z'),
      line('M.8 52.7h3.1v6c0 .9.6 1.5 1.5 1.5h6v3.1H3.8c-1.7 0-3.1-1.4-3.1-3.1z'),
      line(
        'M33.3 49.2H33c-4.6-.1-7.8-3.6-7.9-3.8-.6-.8-.6-2 .1-2.7.8-.8 1.9-.6 2.6.1 0 0 2.3 2.6 5.2 2.6 1.8 0 3.6-.9 5.2-2.6.8-.8 1.9-.8 2.7 0 .8.8.8 1.9 0 2.7-2.2 2.4-4.9 3.7-7.6 3.7z',
      ),
      svg('ellipse', { cx: 23, cy: 26, rx: 5, ry: 7, class: 'face-line' }),
      svg('ellipse', { cx: 43, cy: 26, rx: 5, ry: 7, class: 'face-line' }),
      leftPupil,
      rightPupil,
    ),
  );
  return { root, leftPupil, rightPupil };
}
