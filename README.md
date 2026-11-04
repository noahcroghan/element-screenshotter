# Element Screenshotter

A screenshot tool for Chromium browsers that works like the one built into Firefox. Point at part of a page and it highlights the element under your cursor. Click to capture just that element, or drag to capture any region. You can also save the visible part of the page or the whole thing, top to bottom.

It works in Chrome, Edge, Brave, Vivaldi, Helium, and other Chromium-based browsers (version 116 or newer).

> [!NOTE]
> This project was written by an AI coding agent: Anthropic's Claude Opus 5.5, running in the Pi coding harness (version 1.5.0). Parts of it are adapted from Firefox's own screenshot code. See [Credits](#credits).

## Install

The extension isn't in any web store, so you load it yourself:

1. Download `element-screenshotter-<version>.zip` from the [latest release](../../releases/latest) and unzip it. Or [build it from source](docs/development.md#quick-start), which gives you a `dist` folder. Either way you need a folder containing `manifest.json`.
2. Open your browser's extensions page (`chrome://extensions`, `edge://extensions`, and so on).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick that folder. Keep the folder where it is: the browser loads the extension from it each time it starts.
5. Optionally, pin the extension to your toolbar.

To screenshot local files (`file://` pages), open the extension's details and turn on **Allow access to file URLs**.

## Taking a screenshot

Start a screenshot in any of these ways:

- Click the toolbar button.
- Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> (<kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> on a Mac).
- Right-click the page and choose **Take Screenshot**.

The page dims and the overlay waits for you. Press <kbd>Esc</kbd> or click the toolbar button again to leave without taking anything.

### Capture an element

Move the pointer over the page. The element under it is outlined, with a label showing its tag, id, classes, and size, for example `div#main.card 320 x 200`. Click to select it.

By default the picker is smart, the way Firefox's is. It skips headings in favour of the section they head, prefers whole articles, and ignores wrappers bigger than the screen. When it doesn't pick what you want, use the arrow keys:

| Key                                            | Moves the highlight to            |
| ---------------------------------------------- | --------------------------------- |
| <kbd>Up Arrow</kbd>                            | the parent element                |
| <kbd>Down Arrow</kbd>                          | back down to a child element      |
| <kbd>Left Arrow</kbd> / <kbd>Right Arrow</kbd> | the previous or next sibling      |
| <kbd>Enter</kbd>                               | (selects the highlighted element) |

This works inside shadow DOM and inside frames from the same site. A frame from another site can only be captured as a whole.

Elements taller or wider than the window are fine. The extension scrolls through them and stitches the pieces together.

### Capture a region

Press and drag to draw a rectangle. Once something is selected you can:

- drag the handles on the edges and corners to resize it
- drag the middle to move it
- use the keyboard: <kbd>Tab</kbd> to the selection and press the arrow keys to move it, or <kbd>Tab</kbd> to a corner handle and press them to resize. Hold <kbd>Shift</kbd> to move 10 pixels at a time.

Click outside the selection, or press <kbd>Esc</kbd>, to start over.

### Save the visible area or the full page

While the overlay is showing, use the buttons in the top-right corner:

- **Save visible** captures what's on screen right now.
- **Save full page** captures the entire page, scrolling through it automatically.

A preview opens with **Copy**, **Download**, **Retry**, and **Cancel**.

### Copy or download

With a selection or preview on screen:

| Action                           | Button       | Shortcut                     |
| -------------------------------- | ------------ | ---------------------------- |
| Copy the image to the clipboard  | **Copy**     | <kbd>Ctrl</kbd>+<kbd>C</kbd> |
| Save it to your Downloads folder | **Download** | <kbd>Ctrl</kbd>+<kbd>S</kbd> |

On a Mac, use <kbd>Command</kbd> instead of <kbd>Ctrl</kbd>. Whichever you used last is focused next time, so <kbd>Enter</kbd> repeats it.

Screenshots are saved as PNG files named like Firefox's: `Screenshot 2025-01-31 at 14-05-09 Page title.png`. If your browser is set to ask where to save each file, it will ask for these too.

## Settings

Right-click the toolbar button and choose **Options**.

- **Element detection.** Smart (the default, like Firefox), or Exact, which always starts from the element directly under the pointer.
- **Keyboard shortcut.** Shows the current shortcut, with a button to open the browser's shortcut page where you can change it.

## Permissions and privacy

The extension doesn't connect to the internet, collect data, or keep your screenshots anywhere except where you save or copy them. It only touches a page after you start a screenshot on it.

| Permission     | Why it's needed                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| `activeTab`    | To read and capture the current tab, only after you click the button, use the shortcut, or use the menu. |
| `scripting`    | To show the overlay on that tab.                                                                         |
| `downloads`    | To save screenshots to your Downloads folder. Chrome shows this as "Manage your downloads".              |
| `offscreen`    | To hand large images to the download manager (a background helper page with no UI).                      |
| `storage`      | To remember your settings and whether you last copied or downloaded.                                     |
| `contextMenus` | For the **Take Screenshot** menu item.                                                                   |

## Limitations

- **Some pages can't be captured.** Browsers don't let extensions run on their own pages (`chrome://` pages, the extensions page), the Chrome Web Store, other extensions' pages, or the built-in PDF viewer. The toolbar button shows a red `!` when this happens.
- **Copying needs HTTPS.** Browsers only allow copying images to the clipboard on secure pages. On plain `http://` sites, use Download instead.
- **Long captures take a moment.** Chromium allows two viewport captures per second, so a page that's ten screens tall takes about five seconds. The toolbar badge shows progress.
- **Fixed and sticky elements** (headers, cookie banners, chat buttons) appear once, at the top of a full-page capture. In stitched element or region captures they're left out unless they were already on screen where you selected.
- **Pages that scroll an inner panel** instead of the window (some web apps do this) can only be captured one screen at a time. Firefox has the same limitation.
- **Very large captures are cropped** to 32,766 pixels per side and about 125 million pixels in total. You'll be told when that happens.
- Pages that change as you scroll, like infinite feeds or lazy-loaded images, may look slightly different from what you saw.

## Credits

The interaction design is Firefox Screenshots'. The element-picking heuristic, the region and handle behaviour, and the little face on the overlay are adapted from Mozilla's code in [`browser/components/screenshots`](https://github.com/mozilla-firefox/firefox/tree/main/browser/components/screenshots).

The code was generated by an AI coding agent, as noted above. It has unit tests and end-to-end tests that run in a real browser (see [docs/development.md](docs/development.md)), but treat it like any young project and report problems you find.

## Contributing

Start with [docs/development.md](docs/development.md) for setup and [docs/design-notes.md](docs/design-notes.md) for how it works.

## License

[Mozilla Public License 2.0](LICENSE), the same license as the Firefox code it borrows from.
