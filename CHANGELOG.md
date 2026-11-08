# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

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
