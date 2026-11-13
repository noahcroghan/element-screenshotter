# Element Screenshotter

A screenshot tool for Chromium browsers, modelled on the one built into Firefox. Point at part of a page and it highlights the element under your cursor. Click to capture just that element, or drag to capture any region. You can also save the visible part of the page or the full page, top to bottom.

It works in Chrome, Edge, Brave, Vivaldi, Helium, and other Chromium-based browsers (version 116 or newer).

> [!NOTE]
> This project was written by an AI coding agent: Anthropic's Claude Opus 5.5, running in the Pi coding harness (version 1.5.0). Parts of it are adapted from Firefox's own screenshot code and the Zen browser's changes to it. See [Credits](#credits).

## Install

The extension isn't in any web store, so you load it yourself:

1. Download `element-screenshotter-[version].zip` from the [latest release](../../releases/latest) and unzip it. Or [build it from source](docs/development.md#quick-start), which gives you a `dist` folder. Either way you need a folder containing `manifest.json`.
2. Open your browser's extensions page (`chrome://extensions`, `edge://extensions`, and so on).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick that folder. Keep the folder where it is: the browser loads the extension from it each time it starts.
5. Optionally, pin the extension to your toolbar.

To screenshot local files (`file://` pages), open the extension's details and turn on **Allow access to file URLs**.

## Taking a screenshot

Start a screenshot in any of these ways:

- Click the toolbar button.
- Press `Ctrl+Shift+S` (`Command+Shift+S` on a Mac).
- Right-click the page and choose **Take Screenshot**.

The page dims and the overlay waits for you. Press `Esc` or click the toolbar button again to leave without taking anything.

### Capture an element

Move the pointer over the page. The element under it is outlined. Click to select it. To also see a label with its tag, id, classes, and size, for example `div#main.card 320 x 200`, turn on the element label under **Highlight** in the settings.

By default the picker is smart. It skips headings in favour of the section they head, prefers whole articles, and ignores wrappers bigger than the screen. When it doesn't pick what you want, use the arrow keys:

| Key                          | Moves the highlight to            |
| ---------------------------- | --------------------------------- |
| `Up Arrow`                   | the parent element                |
| `Down Arrow`                 | back down to a child element      |
| `Left Arrow` / `Right Arrow` | the previous or next sibling      |
| `Enter`                      | (selects the highlighted element) |

To move the pointer with the arrow keys instead, set **Arrow keys** to move the pointer in the settings. Then each arrow key moves the pointer by 1 pixel, or 10 with `Shift`, and the highlight follows it. `Enter` selects the element under the pointer, and `Space` starts drawing a region from it: move the far corner with the arrow keys and press `Enter` or `Space` to finish. Moving the mouse takes over again.

This works inside shadow DOM and inside frames from the same site. A frame from another site can only be captured as a whole.

Elements taller or wider than the window are fine. The extension scrolls through them and stitches the pieces together.

### Capture a region

Press and drag to draw a rectangle. Once something is selected you can:

- drag the handles on the edges and corners to resize it
- drag the middle to move it
- use the keyboard: `Tab` to the selection and press the arrow keys to move it, or `Tab` to a corner handle and press them to resize. Hold `Shift` to move 10 pixels at a time.

Click outside the selection, or press `Esc`, to start over.

### Save the visible area or the full page

While the overlay is showing, use the buttons in the top-right corner:

- **Save visible** captures what's on screen right now.
- **Save full page** captures the full page, scrolling through it automatically.

A preview opens with **Copy**, **Download**, **Retry**, and **Cancel**.

If the buttons are in the way, drag them anywhere by the bar along their top. They stay where you put them next time. Double-click the bar to put them back in the top-right corner.

### Copy or download

With a selection or preview on screen:

| Action                           | Button       | Shortcut |
| -------------------------------- | ------------ | -------- |
| Copy the image to the clipboard  | **Copy**     | `Ctrl+C` |
| Save it to your Downloads folder | **Download** | `Ctrl+S` |

On a Mac, use `Command` instead of `Ctrl`. Whichever you used last is focused next time, so `Enter` repeats it.

Screenshots are saved as PNG files named like `Screenshot 2025-01-31 at 14-05-09 Page title.png`. If your browser is set to ask where to save each file, it will ask for these too.

## Settings

Right-click the toolbar button and choose **Options**.

- **Element detection** is Smart (the default, like Firefox) or Exact. Exact always starts from the element directly under the pointer.
- **Highlight** has two options for the outline around the hovered element:
  - A rounded outline that slides from one element to the next, like Zen. It's on by default. Turn it off for Firefox's dashed outline.
  - A label next to it with the element's tag, id, classes, and size. It's off by default. Screen readers announce the element either way.
- **Arrow keys** sets whether the arrow keys move the highlight through the element tree (the default) or move the pointer, like Firefox. See [Capture an element](#capture-an-element).
- **Save buttons** lets you drag the Save visible and Save full page buttons anywhere, and keeps them there. It's on by default. Turn it off to keep them in the top-right corner.
- **Cursor** uses the extension's crosshair instead of the system cursor. It's off by default. The arrow keys can't move the real cursor, so they move a crosshair the extension draws, which may not look like your system's. Turn this on to use that crosshair for the mouse too.
- **Keyboard shortcut** shows the current shortcut, with a button to open the browser's shortcut page where you can change it.

## Permissions and privacy

The extension doesn't connect to the internet, collect data, or keep your screenshots anywhere except where you save or copy them. It only touches a page after you start a screenshot on it.

| Permission     | Why it's needed                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| `activeTab`    | To read and capture the current tab, only after you click the button, use the shortcut, or use the menu. |
| `scripting`    | To show the overlay on that tab.                                                                         |
| `downloads`    | To save screenshots to your Downloads folder. Chrome shows this as "Manage your downloads".              |
| `offscreen`    | To pass large images to the download manager (a background helper page with no UI).                      |
| `storage`      | To remember your settings, whether you last copied or downloaded, and where you put the Save buttons.    |
| `contextMenus` | For the **Take Screenshot** menu item.                                                                   |

## Limitations

- Browsers don't let extensions run on their own pages (`chrome://` pages, the extensions page), the Chrome Web Store, other extensions' pages, or the built-in PDF viewer. On those pages the toolbar button shows a red `!`.
- Browsers only allow copying images to the clipboard on secure pages. On plain `http://` sites, use Download instead.
- Chromium allows two viewport captures per second, so a page that's ten screens tall takes about five seconds to capture. The toolbar badge shows progress, and the page can't be scrolled until it's done.
- Fixed and sticky elements (headers, cookie banners, chat buttons) appear once, at the top of a full-page capture. In stitched element or region captures they're left out unless they were already on screen where you selected.
- Pages that scroll an inner panel instead of the window (some web apps do this) can only be captured one screen at a time.
- Very large captures are cropped to 32,766 pixels per side and about 125 million pixels in total. You'll be told when that happens.
- Pages that change as you scroll, like infinite feeds or lazy-loaded images, may look slightly different from what you saw.

## Credits

The design and behaviour come from Firefox Screenshots, the screenshot tool built into Firefox. The element-picking heuristic, the region and handle behaviour, the little face on the overlay, and the "Save visible" and "Save full page" icons are adapted from Mozilla's code in [`browser/components/screenshots`](https://github.com/mozilla-firefox/firefox/tree/main/browser/components/screenshots).

The rounded, sliding highlight comes from the Zen browser, which is based on Firefox. Zen restyles Firefox's highlight in [`src/browser/components/screenshots/overlay/overlay-css.patch`](https://github.com/zen-browser/desktop/blob/dev/src/browser/components/screenshots/overlay/overlay-css.patch), also under the Mozilla Public License 2.0.

The code was generated by an AI coding agent, as noted above. It has unit tests and end-to-end tests that run in a real browser (see [the development guide](docs/development.md)), but treat it like any young project and report problems you find.

## Contributing

Read [the contributing guide](CONTRIBUTING.md) first. [The development guide](docs/development.md) covers setup and [the design notes](docs/design-notes.md) explain how it works. Report security problems privately, as described in [the security policy](SECURITY.md).

## License

[Mozilla Public License 2.0](LICENSE)
