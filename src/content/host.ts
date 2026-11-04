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
  // `all: initial` does not reset direction, so set it explicitly or a
  // right-to-left page would flip our (English, left-to-right) UI.
  host.dir = 'ltr';
  const declarations: Record<string, string> = {
    display: 'block',
    position: 'fixed',
    inset: '0',
    width: 'auto',
    height: 'auto',
    'max-width': 'none',
    'max-height': 'none',
    margin: '0',
    padding: '0',
    border: '0',
    background: 'transparent',
    overflow: 'visible',
    opacity: '1',
    visibility: 'visible',
    transform: 'none',
    filter: 'none',
    'clip-path': 'none',
    'color-scheme': 'normal',
    'z-index': '2147483647',
    direction: 'ltr',
    'unicode-bidi': 'isolate',
    'pointer-events': interactive ? 'auto' : 'none',
  };
  for (const [name, value] of Object.entries(declarations)) {
    host.style.setProperty(name, value, 'important');
  }
}

/** Remove UI left behind by an earlier copy of the content script (e.g. after an update). */
export function removeStaleHosts() {
  for (const stale of document.querySelectorAll(HOST_TAG)) stale.remove();
}
