# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-03

The first release. Element Screenshotter brings Firefox's screenshot tool to Chromium browsers.

### Added

- Hover to highlight an element and click to capture it, using Firefox's element-picking rules.
- Arrow keys to move the highlight to the parent, child, or sibling element, then Enter to select it.
- Elements inside shadow DOM and same-site frames can be picked.
- Drag to capture any region. Resize or move it with the handles or the keyboard.
- **Save visible** and **Save full page**, with a preview before you copy or download.
- Elements and regions larger than the window are captured by scrolling and stitching, without repeated headers.
- Copy to the clipboard or download as PNG or JPEG, named like Firefox's screenshots.
- <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> shortcut, a **Take Screenshot** context menu item, and optional shortcuts for visible and full-page captures.
- Settings for element detection (smart or exact), image format, a downloads sub-folder, and "ask where to save".
- Works on pages with strict Content Security Policies and Trusted Types, and on right-to-left pages.

### Install

Download `element-screenshotter-1.0.0.zip` below, unzip it, and load the folder from `chrome://extensions` with **Developer mode** on (**Load unpacked**). See the [README](https://github.com/noahcroghan/element-screenshotter#install) for details. `SHA256SUMS.txt` lets you check the download.

[1.0.0]: https://github.com/noahcroghan/element-screenshotter/releases/tag/v1.0.0
