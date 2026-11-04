/**
 * Minimal DOM builder. The overlay never uses innerHTML, so pages that
 * enforce Trusted Types cannot break it.
 */

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  for (const c of children) if (c) el.append(c);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag: string, attrs: Attrs = {}, ...children: Child[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  for (const c of children) if (c) el.append(c);
  return el;
}

function setAttrs(el: Element, attrs: Attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
}

/** Set several pixel-valued style properties via CSSOM (allowed under any CSP). */
export function place(
  el: HTMLElement,
  box: Partial<Record<'left' | 'top' | 'right' | 'bottom' | 'width' | 'height', number | null>>,
) {
  for (const [k, v] of Object.entries(box)) {
    el.style.setProperty(k, typeof v === 'number' ? `${v}px` : '');
  }
}
