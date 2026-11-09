/**
 * Minimal DOM builder. The overlay never uses innerHTML, so pages that
 * enforce Trusted Types cannot break it.
 */

import type { SvgNode } from '../../scripts/svg-plugin';

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

export function buildElement<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[Tag] {
  const created = document.createElement(tag);
  setAttrs(created, attrs);
  created.append(...children.filter(isPresent));
  return created;
}

function isPresent(child: Child): child is Node | string {
  return !!child;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Build an SVG imported from a .svg file (see scripts/svg-plugin.ts). */
export function buildSvgTree(node: SvgNode): SVGElement {
  const created = document.createElementNS(SVG_NS, node.tag);
  setAttrs(created, node.attrs);
  created.append(...node.children.map(buildSvgTree));
  return created;
}

function setAttrs(target: Element, attrs: Attrs) {
  const present = Object.entries(attrs).filter(
    ([, value]) => value !== undefined && value !== false,
  );
  for (const [name, value] of present) {
    target.setAttribute(name, value === true ? '' : String(value));
  }
}

/** Set several pixel-valued style properties via CSSOM (allowed under any CSP). */
export function place(
  target: HTMLElement,
  box: Partial<Record<'left' | 'top' | 'right' | 'bottom' | 'width' | 'height', number | null>>,
) {
  for (const [property, value] of Object.entries(box)) {
    target.style.setProperty(property, typeof value === 'number' ? `${value}px` : '');
  }
}
