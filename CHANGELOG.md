# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

Changes since the last release.

## [1.1.0] - 2026-11-11

New settings for the arrow keys, cursor, element label, and save buttons, and fixes for the overlay.

### Added

- An **Arrow keys** setting. Choose **Move the pointer** and the arrow keys move the pointer by 1 pixel (10 with `Shift`), `Enter` selects the element under it, and `Space` draws a region. The default still moves the highlight through the element tree.
- A **Cursor** setting, off by default, to use the extension's crosshair instead of the system cursor. The cursor then looks the same whether the mouse or the arrow keys move it.
- Icons on the **Save visible** and **Save full page** buttons.
- Drag the **Save visible** and **Save full page** buttons anywhere by the bar along their top to get them out of the way. They stay where you put them. Double-click the bar to put them back. Turn this off with the new **Save buttons** setting to keep them in the top-right corner.

### Changed

- A redrawn icon that stays legible at 16 px in the toolbar.
- The extension's description and settings no longer compare it to Firefox. The README credits Firefox as the original.
- The label with the highlighted element's tag, id, classes, and size is now off by default. Turn it on with the new **Element label** setting.

### Fixed

- The highlight and its label no longer draw over the **Save visible** and **Save full page** buttons when the highlighted element runs under them.
- Opening the overlay with the keyboard shortcut highlights the element under the mouse straight away, without moving the mouse. The arrow keys then start from the mouse instead of the middle of the page.
- Scrolling while a long capture is in progress no longer puts pieces of the page in the wrong place. The page can't be scrolled until the capture is done.

### Install

Download `element-screenshotter-1.1.0.zip` below, unzip it, and load the folder from `chrome://extensions` with **Developer mode** on (**Load unpacked**). The README's Install section has details. `SHA256SUMS.txt` lets you check the download.

## [1.0.0] - 2026-11-05

The first release. Element Screenshotter brings Firefox's screenshot tool to Chromium browsers.

### Added

- Hover to highlight an element and click to capture it, using Firefox's element-picking rules.
- Arrow keys to move the highlight to the parent, child, or sibling element, then Enter to select it.
- Elements inside shadow DOM and same-site frames can be picked.
- Drag to capture any region. Resize or move it with the handles or the keyboard.
- **Save visible** and **Save full page**, with a preview before you copy or download.
- Elements and regions larger than the window are captured by scrolling and stitching, without repeated headers.
- Copy to the clipboard or download as PNG, named like Firefox's screenshots.
- `Ctrl+Shift+S` shortcut and a **Take Screenshot** context menu item.
- A setting for element detection: smart (like Firefox) or exact.
- Works on pages with strict Content Security Policies and Trusted Types, and on right-to-left pages.

### Install

Download `element-screenshotter-1.0.0.zip` below, unzip it, and load the folder from `chrome://extensions` with **Developer mode** on (**Load unpacked**). The README's Install section has details. `SHA256SUMS.txt` lets you check the download.
