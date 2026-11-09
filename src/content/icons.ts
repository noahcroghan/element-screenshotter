/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * The overlay's SVGs live in ./svg; each file says where it comes from. */

import { buildSvgTree } from './dom';
import close from './svg/close.svg';
import copy from './svg/copy.svg';
import cursorTree from './svg/cursor.svg';
import download from './svg/download.svg';
import faceTree from './svg/face.svg';
import retry from './svg/retry.svg';

const ICONS = { close, copy, download, retry } as const;

export type IconName = keyof typeof ICONS;

function decorative(root: SVGElement): SVGElement {
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('focusable', 'false');
  return root;
}

export function icon(name: IconName): SVGElement {
  return decorative(buildSvgTree(ICONS[name]));
}

export function cursor(): SVGElement {
  return decorative(buildSvgTree(cursorTree));
}

export interface Face {
  root: SVGElement;
  leftPupil: SVGElement;
  rightPupil: SVGElement;
}

export function face(): Face {
  const root = decorative(buildSvgTree(faceTree));
  const [leftPupil, rightPupil] = root.querySelectorAll<SVGElement>('.face-pupil');
  if (!leftPupil || !rightPupil) throw new Error('face.svg needs two .face-pupil elements');
  return { root, leftPupil, rightPupil };
}
