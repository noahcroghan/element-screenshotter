# Design notes

This document explains how Element Screenshotter works and why it is built
the way it is. Read it before making non-trivial changes.

## Goal

Recreate Firefox Screenshots (`browser/components/screenshots` in
mozilla-central) as a Chromium Manifest V3 extension:

- Hover to highlight a sensible element, click to select it.
- Drag to select an arbitrary region; resize or move it with handles or the
  keyboard.
- "Save visible" and "Save full page" with a preview dialog.
- Copy to clipboard or download as an image.

Element selection is the priority feature.

## Architecture

```mermaid
flowchart TD
    user(["Toolbar click / shortcut / context menu"])

    sw["<b>Service worker</b><br/>src/background/<br/><i>captureVisibleTab, downloads,<br/>offscreen lifecycle</i>"]

    cs["<b>Content script</b> (top frame)<br/>src/content/<br/><i>overlay UI (shadow DOM), element picker,<br/>scroll + stitch on a canvas, clipboard</i>"]

    off["<b>Offscreen document</b><br/>src/offscreen/<br/><i>rebuilds the Blob, makes a blob: URL</i>"]

    user --> sw
    sw -- "executeScript + toggle" --> cs
    cs -- "capture-visible" --> sw
    sw -- "PNG data URL" --> cs
    cs -- "port: image-transfer<br/>(base64 chunks)" --> off
    off -- "offscreen-download (blob: URL)" --> sw
    sw -- "chrome.downloads" --> disk[("Downloads folder")]
```

### Why each piece exists

- **Service worker.** It is the only context that can call
  `chrome.tabs.captureVisibleTab` and `chrome.downloads`. It holds no session
  state, because MV3 service workers can be killed at any time.
- **Content script.** It owns the whole screenshot session: the overlay, the
  element picker, scrolling, and compositing. It is injected on demand with
  `chrome.scripting.executeScript`, so the extension only needs `activeTab`
  and gets no "read all your data on all websites" warning.
- **Offscreen document.** Chrome rejects data URLs over about 2 MB in
  downloads, and service workers cannot call `URL.createObjectURL`. The
  offscreen document (reason `BLOBS`) turns the image bytes back into a Blob
  and returns a `blob:` URL that `chrome.downloads` can save.
  Extension messaging is JSON-only and capped at 64 MiB, so images are sent
  in base64 chunks over a port.

### Capturing pixels

Firefox uses the privileged `drawSnapshot`, which can render any part of the
page. Extensions have two options:

1. `chrome.tabs.captureVisibleTab`. This captures the viewport only, with no
   infobar and no extra permission, but Chrome limits it to 2 calls per
   second.
2. `chrome.debugger` + `Page.captureScreenshot`. This can render beyond the
   viewport, but shows a "started debugging this browser" infobar. It also
   resizes the viewport, which breaks `vh`-based layouts, and it needs a scary
   permission.

We use option 1. Anything bigger than the viewport is captured by scrolling
and stitching tiles (`src/content/capture.ts`):

- Scrolling is instant, and `scroll-snap-type` / `scroll-behavior` are
  overridden for the duration.
- Tile placement uses the scroll position the browser actually reached, not
  the one we asked for. Right-to-left pages (negative `scrollX`) work.
- The user can't scroll while tiles are taken. Each capture waits in the
  service worker's queue, so a scroll between reading the position and
  getting the pixels would draw a tile in the wrong place. Non-passive
  `wheel` and `touchmove` listeners cancel scrolling, a middle-button
  `mousedown` is cancelled so autoscroll can't start, and keys are already
  swallowed. Dragging the scrollbar can't be cancelled, so the position is
  read again after each capture, and the tile is taken again if it moved. A
  page that keeps moving fails the capture after 5 tries. We don't set
  `overflow: hidden` on the root: it removes the scrollbar and can change
  the layout under the tiles.
- If the region already starts on screen, the first tile is taken at the
  user's current scroll position. What they saw is captured as they saw it.
- `position: fixed` and `sticky` elements would repeat on every tile. The
  rules:
  - **Full page:** they stay in the first tile (the top of the page) and are
    hidden after it.
  - **Element or region:** if the first tile is exactly what the user sees,
    it is captured as is, and everything fixed is hidden after that.
    Otherwise, fixed elements outside the selection are hidden from the
    start, so a header can't cover the top of a scrolled-to element. Sticky
    parts inside the selected element (a table header, say) stay for the
    first tile.
  - Ancestors of the selected element are never hidden, since that would
    hide the element.
- The capture scale is `devicePixelRatio` when it agrees with the bitmap.
  Otherwise it is the measured `bitmap.width / innerWidth`. The measured
  ratio is slightly wrong at fractional scales like 1.25, because
  `innerWidth` is rounded to whole pixels. Either way it accounts for zoom.
- Output is clamped to 32,766 px per side and about 124.9 M px in total,
  matching Firefox, and the user is told when the image is cropped.

The overlay is made transparent (`opacity: 0`) rather than removed while
capturing. It still swallows pointer events, so page `:hover` styles do not
flash into the screenshot.

### Overlay UI

- A custom element is placed in the **top layer** using `popover="manual"`.
  This puts it above any page `z-index` or stacking context.
- It uses a **closed shadow root** with **constructable stylesheets**
  (`adoptedStyleSheets`), which page CSP `style-src` does not block. Inline
  positions are set through CSSOM (`el.style.foo = ...`), which CSP also
  allows.
- Images (the preview) are drawn on `<canvas>`, never `<img src=data:>`, so a
  page `img-src` CSP cannot block them.
- Pointer and mouse events are stopped inside the shadow root, so page
  handlers never see clicks on the overlay. Keys are handled by a
  capture-phase listener on `window`, the earliest point an extension can
  reach, so pages can't swallow Escape or fire their own shortcuts.
- The host sets `dir="ltr"` explicitly. `all: initial` does not reset
  `direction`, so without it a right-to-left page flips the (English) UI.

### Element picker

`src/content/element-picker.ts` ports Firefox's `getBestRectForElement`
heuristic. It starts from the element under the cursor:

- an element smaller than 100x30 is kept as is, unless it is under 30x10, in
  which case nothing is highlighted
- headings are skipped in favour of their parent
- if the element is bigger than the viewport plus 100 px (at least
  1000x700), the previous, smaller element wins
- an enclosing `role="article"` that fits is preferred

Firefox can also merge the chosen element with its next sibling. We drop
that, so the highlight is always a real element, which the tree navigation
below needs.

On top of that, we add:

- **Element-tree navigation.** Arrow keys go to the parent, child, and
  siblings, so any element is reachable. This is the default.
- A **pointer mode** for the arrow keys (setting) that follows Firefox. Firefox
  moves the real cursor with `sendNativeMouseEvent`, which extensions can't
  do. We keep a virtual pointer instead: the arrows move it, we hide the real
  cursor and draw a crosshair there, and hit testing uses it. `Space` starts a
  region from it and `Enter` or `Space` ends it, as in Firefox. A mouse event
  at a new position hands control back to the mouse. Events that repeat the
  mouse's last position don't, so a click without moving the mouse acts where
  the keys put the pointer.
- **The mouse's position before it moves.** Pages can't ask where the mouse
  is, but Chrome fires `pointerover` with its position when the overlay
  appears under it. We use that, so the highlight and the arrow keys start
  at the mouse. Opened from the toolbar button, the mouse isn't on the page
  and nothing fires, so the arrow keys start in the middle of the viewport.
- An **own cursor** setting, off by default. The crosshair we draw for the
  arrow keys can't look like the system cursor (pages can't read the cursor
  scheme), so switching between mouse and keys changes the cursor. With the
  setting on, we draw our crosshair for the mouse too. An `own-cursor` class
  turns the cursor to `none` exactly where it would be `crosshair`, and we
  draw ours wherever the element under the mouse has a computed cursor of
  `none`. Buttons and selection handles keep their system cursors. Chrome
  fires `pointerover` when what is under a still mouse changes, which keeps
  this right across state changes and scrolling.
- An **"exact" mode** (setting) that starts at the element under the cursor
  instead of the heuristic's choice.
- **Shadow DOM piercing**, including closed roots via
  `chrome.dom.openOrClosedShadowRoot`.
- **Same-origin iframes** are entered. Cross-origin iframes are selected as a
  whole.
- An optional **label** (setting, off by default like Firefox) showing the
  element's tag, id, and classes plus its size. When it is off, the label
  stays in the DOM, visually hidden, so its live region still tells screen
  readers which element is highlighted.
- A **movable Save visible / Save full page panel** (setting, on by
  default). Firefox's panel sits in the browser chrome and only overlaps the
  top of the page, but ours sits on the page and can cover what you want to
  capture. It gets a bar along its top, like a window's title bar, and only
  the bar drags it, so the buttons stay plain buttons. Its position is kept in
  `chrome.storage.local` as the distance from the nearest side and the
  nearest top or bottom edge, so it stays near the same corner when the
  window is resized, and is kept inside the viewport. Double-clicking the bar
  puts it back in the top-right corner and forgets the stored position. With
  the setting off it stays in the top-right corner, like Firefox.
- A **Zen browser highlight style** (setting, on by default). Zen, a
  Firefox-based browser, patches Firefox's hover highlight
  (`src/browser/components/screenshots/overlay/overlay-css.patch` in
  `zen-browser/desktop`): a solid, translucent, rounded outline with
  `transition: all 0.1s`, so it slides from one element to the next. We copy
  those three rules behind a `zen-browser-style` class, and the element label
  slides with the outline. Firefox's highlight is attached to the page, so it
  scrolls with it, but ours is redrawn after each scroll. When the same
  element has moved, the transition is turned off (a `still` class), or the
  outline would trail the page. Every mouse move redraws the highlight too, so
  a redraw that changes nothing is skipped, or it would cut the slide short.
  Zen's patch also changes the dimming colour, to the value Firefox already
  uses, and positions a panel id that Firefox has since renamed, so neither
  changes anything. Code and settings that copy Zen say
  "Zen browser" (`zenBrowserStyle`), so they are easy to find and rename.

## Decisions and open questions

Most of these were decided up front, and each one can be changed.

| Topic            | Decision                                                                      | Why / risk                                                                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| License          | MPL-2.0                                                                       | The element heuristic, region math, face SVG, and save icons are ported from Firefox (MPL-2.0), and the Zen highlight style from Zen (MPL-2.0). MPL is file-level copyleft, so the rest could be relicensed, but one license is simpler. |
| Capture backend  | `captureVisibleTab` + stitching                                               | No infobar or scary permission. Costs: about 0.5 s per tile, and `fixed`/`sticky` handling is heuristic.                                                                                                                                 |
| Permissions      | `activeTab`, `scripting`, `downloads`, `offscreen`, `storage`, `contextMenus` | Only `downloads` shows an install warning ("Manage your downloads"). No host permissions.                                                                                                                                                |
| Default shortcut | `Ctrl+Shift+S` (`Cmd+Shift+S` on macOS)                                       | Same as Firefox. Chrome silently skips it if another extension already uses it.                                                                                                                                                          |
| Clipboard        | `navigator.clipboard.write` in the content script                             | Fails on plain `http://` pages (not a secure context). Download still works there, and the user gets a clear message.                                                                                                                    |
| Scope            | Top frame only                                                                | Same-origin iframes are pierced. Cross-origin iframes can only be captured as a whole rectangle.                                                                                                                                         |
| Inner scrollers  | Not stitched                                                                  | "Full page" scrolls the window only. Apps that scroll an inner `<div>` capture just the viewport, as in Firefox.                                                                                                                         |
| Restricted pages | Not supported                                                                 | `chrome://`, the Web Store, other extensions' pages and the PDF viewer can't be scripted. The toolbar badge shows an error.                                                                                                              |
| Browser support  | Chromium 116+                                                                 | Needs `runtime.getContexts`, popover, and `offscreen`. Tested on Helium (Chromium 156).                                                                                                                                                  |
| Distribution     | GitHub releases (zip), loaded unpacked                                        | Chrome Web Store and Edge Add-ons listings are prepared (docs/web-store-listing.md) but not submitted.                                                                                                                                   |
| TypeScript       | `tsc` is TS 7; the `typescript` package is the TS 6 API                       | typescript-eslint can't load TS 7.0, which has no JS API. Remove the alias once typescript-eslint supports TS 7.1. See development.md.                                                                                                   |
| CI/CD            | GitHub Actions + Dependabot; tag-triggered releases                           | Checks and e2e run on Linux, Windows, and macOS. CodeQL scans the code, and releases carry provenance attestations. Tests download Chrome for Testing.                                                                                   |
