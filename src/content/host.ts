import { uiDirection } from '../shared/i18n';

/**
 * Our UI is mounted in a custom element that is promoted to the top layer
 * with the Popover API, so it renders above everything the page does
 * regardless of z-index or stacking contexts.
 */

/** Tag name for every element we insert. Unregistered custom elements are inert. */
export const HOST_TAG = 'element-screenshotter-ui';

/**
 * Inline `!important` declarations beat any author stylesheet, including
 * the UA `[popover]` defaults (border, padding, fit-content sizing).
 * They are set through CSSOM, which CSP `style-src` does not restrict.
 */
export function styleHost(host: HTMLElement, { interactive }: { interactive: boolean }) {
  host.popover = 'manual';
  // `all: initial` does not reset direction, so a right-to-left page would
  // otherwise flip our UI. Follow the UI language instead, as Firefox does.
  const dir = uiDirection();
  host.dir = dir;
  const s = host.style;
  const set = (name: string, value: string) => {
    s.setProperty(name, value, 'important');
  };
  set('display', 'block');
  set('position', 'fixed');
  set('inset', '0');
  set('width', 'auto');
  set('height', 'auto');
  set('max-width', 'none');
  set('max-height', 'none');
  set('margin', '0');
  set('padding', '0');
  set('border', '0');
  set('background', 'transparent');
  set('overflow', 'visible');
  set('opacity', '1');
  set('visibility', 'visible');
  set('transform', 'none');
  set('filter', 'none');
  set('clip-path', 'none');
  set('color-scheme', 'normal');
  set('z-index', '2147483647');
  set('direction', dir);
  set('unicode-bidi', 'isolate');
  set('pointer-events', interactive ? 'auto' : 'none');
}

/** Remove UI left behind by an earlier copy of the content script (e.g. after an update). */
export function removeStaleHosts() {
  for (const el of document.querySelectorAll(HOST_TAG)) el.remove();
}
