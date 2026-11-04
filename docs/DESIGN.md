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
  the one we asked for.
- `position: fixed` and `sticky` elements are hidden after the first tile, so
  headers do not repeat. The first tile shows the page as the user saw it.
- The capture scale is measured from the captured bitmap
  (`bitmap.width / innerWidth`). It covers both device pixel ratio and zoom.
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
- Pointer, mouse, and key events are stopped at the host, so page handlers
  inside the overlay never see them.

### Element picker

`src/content/element-picker.ts` ports Firefox's `getBestRectForElement`
heuristic. Starting from the element under the cursor, it walks up to the
first ancestor that is big enough (at least 100×30), skips headings, prefers
`role="article"` containers, and rejects anything bigger than the viewport.
On top of that, we add:

- **Element-tree navigation.** Arrow keys go to the parent, child, and
  siblings, so any element is reachable. Firefox uses the arrows to move the
  cursor, which extensions can't do.
- An **"exact" mode** (setting) that starts at the element under the cursor
  instead of the heuristic's choice.
- **Shadow DOM piercing**, including closed roots via
  `chrome.dom.openOrClosedShadowRoot`.
- **Same-origin iframes** are entered. Cross-origin iframes are selected as a
  whole.
- A **label** showing the element's tag, id, and classes plus its size.

## Decisions and open questions

These were decided up front. Each one can be changed.

| Topic | Decision | Why / risk |
| --- | --- | --- |
| License | MPL-2.0 | The element heuristic, region math, and face SVG are ported from Firefox (MPL-2.0). MPL is file-level copyleft, so the rest could be relicensed, but one license is simpler. |
| Capture backend | `captureVisibleTab` + stitching | No infobar or scary permission. Costs: about 0.5 s per tile, and `fixed`/`sticky` handling is heuristic. |
| Permissions | `activeTab`, `scripting`, `downloads`, `offscreen`, `storage`, `contextMenus` | Only `downloads` shows an install warning ("Manage your downloads"). No host permissions. |
| Default shortcut | `Ctrl+Shift+S` (`Cmd+Shift+S` on macOS) | Same as Firefox. Chrome silently skips it if another extension already uses it. |
| Clipboard | `navigator.clipboard.write` in the content script | Fails on plain `http://` pages (not a secure context). Download still works there, and the user gets a clear message. |
| Scope | Top frame only | Same-origin iframes are pierced. Cross-origin iframes can only be captured as a whole rectangle. |
| Inner scrollers | Not stitched | "Full page" scrolls the window only. Apps that scroll an inner `<div>` capture just the viewport, as in Firefox. |
| Restricted pages | Not supported | `chrome://`, the Web Store, other extensions' pages and the PDF viewer can't be scripted. The toolbar badge shows an error. |
| Browser support | Chromium 116+ | Needs `runtime.getContexts`, popover, and `offscreen`. Tested on Helium (Chromium 156). |
| Distribution | Unpacked only | Nothing is published to a store or remote until the owner says so. |
