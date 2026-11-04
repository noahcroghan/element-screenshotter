/**
 * Minimal DOM builder. The overlay never uses innerHTML, so pages that
 * enforce Trusted Types cannot break it.
 */

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

export function buildSvg(tag: string, attrs: Attrs = {}, ...children: Child[]): SVGElement {
  const created = document.createElementNS(SVG_NS, tag);
  setAttrs(created, attrs);
  created.append(...children.filter(isPresent));
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
