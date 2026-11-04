# Development

How to build, run, and test the extension, and what to know before changing it. For how it works inside, read [DESIGN.md](DESIGN.md).

## Quick start

You need [Node.js](https://nodejs.org/) 22.12 or newer, [pnpm](https://pnpm.io/) 11, and a Chromium-based browser.

```sh
pnpm install
pnpm build        # writes the unpacked extension to dist/
```

Then load it: open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the `dist` folder.

## Everyday loop

```sh
pnpm watch
```

This rebuilds `dist/` on every save. Chrome doesn't pick up changes by itself. After a rebuild, click the reload icon on the extension's card at `chrome://extensions`, then reload the page you're testing on. A content script that's already injected keeps running the old code until the page reloads.

Before you commit:

```sh
pnpm check        # typecheck, ESLint, markdownlint, Prettier, unit tests
pnpm test:e2e     # builds, then runs the browser tests
```

`pnpm format` fixes formatting.

## Scripts

| Command                        | What it does                                                               |
| ------------------------------ | -------------------------------------------------------------------------- |
| `pnpm build`                   | Bundle `src/` with esbuild and copy `static/` into `dist/`                 |
| `pnpm watch`                   | Same, rebuilding on change                                                 |
| `pnpm package`                 | Build and zip `dist/` into `artifacts/element-screenshotter-<version>.zip` |
| `pnpm icons`                   | Re-render `static/icons/*.png` from `icon.svg` using the test browser      |
| `pnpm typecheck`               | `tsc --noEmit` (TypeScript 7)                                              |
| `pnpm lint`                    | ESLint with type-aware typescript-eslint rules                             |
| `pnpm lint:md`                 | markdownlint on every Markdown file                                        |
| `pnpm format` / `format:check` | Prettier                                                                   |
| `pnpm test`                    | Unit tests (Vitest + happy-dom)                                            |
| `pnpm test:e2e`                | End-to-end tests in a real browser                                         |
| `pnpm check`                   | Everything except end-to-end tests                                         |

## Project layout

```text
src/
  background/     service worker: entry points, captureVisibleTab, downloads
  content/        injected into the page: overlay, element picker, capture
    overlay.ts      the UI state machine (start here)
    element-picker.ts
    capture.ts      scroll-and-stitch
    output.ts       clipboard and download plumbing
  offscreen/      turns image bytes into a blob: URL for chrome.downloads
  options/        settings page
  shared/         pure helpers used everywhere (geometry, filenames, settings, messages)
static/           manifest.json, icons, _locales (copied into dist/ as is)
scripts/          build, zip, icon rendering, browser lookup
test/unit/        fast tests for pure logic
test/e2e/         browser tests and fixture pages
docs/             design notes and this guide
```

## Tests

### Unit tests

`test/unit/` covers the code that doesn't need a real browser: geometry and tile planning, filenames, settings parsing, byte encoding, and the element-picker rules. happy-dom has no layout, so picker tests give elements fake boxes through a `data-box` attribute.

### End-to-end tests

`test/e2e/` launches a real browser with the built extension through [puppeteer-core](https://pptr.dev/guides/chrome-extensions). It serves the pages in `test/e2e/fixtures/` and drives the extension the way a person would. The toolbar button is clicked with `page.triggerExtensionAction`, which grants `activeTab` for real. The tests then check the pixels of the downloaded or copied PNGs.

The fixtures use solid colours at known coordinates, so a test can say "the pixel at the bottom of the stitched image is magenta". Adding `/strict/` to a fixture path serves it with a strict Content Security Policy and Trusted Types enforced.

Environment variables:

| Variable       | Effect                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `BROWSER_PATH` | Browser executable to use. Otherwise it looks for Helium, then Chromium, then Chrome ([scripts/browser-path.mjs](../scripts/browser-path.mjs)). |
| `HEADFUL=1`    | Show the browser window. Handy for watching a failing test.                                                                                     |
| `DPR=1.25`     | Force a device scale factor. CI runs at 1, 1.25, and 2 because fractional scales catch stitching bugs.                                          |

To run one file or test: `pnpm exec vitest run --project e2e test/e2e/capture.test.ts -t "full page"`. Run `pnpm build` first, because only `test:e2e` builds for you.

The overlay lives in a closed shadow root, so tests can't query it. Instead, the content script exposes a read-only `snapshot()` (state, hovered element, selection) in its isolated world, and `Harness.snapshot()` reads it through puppeteer's extension realm. Pages can't see it.

Google Chrome 137 and newer ignores `--load-extension`. Puppeteer loads the extension over the DevTools protocol instead, which works in Chrome for Testing, Chromium, and Helium.

## Debugging

- **Service worker.** At `chrome://extensions`, click **service worker** on the extension's card to open DevTools for it.
- **Content script.** Open DevTools on the page. In the Console, switch the context dropdown from `top` to **Element Screenshotter**. Then `__elementScreenshotter.snapshot()` shows the overlay state.
- **Offscreen document.** It appears under **Inspect views** on the extension card while a download is in flight.
- **Overlay DOM.** The shadow root is closed, but DevTools shows it anyway. Look for `<element-screenshotter-ui>` at the end of `<html>`.

## Conventions

- TypeScript in strict mode, with type-aware ESLint (`strictTypeChecked`). Don't silence a rule without saying why in a comment.
- Content-script code must survive hostile pages. Never use `innerHTML`, which breaks under Trusted Types; build DOM with `h()` from `src/content/dom.ts`. Set styles through CSSOM (`el.style.setProperty`), never with `setAttribute('style')`, and keep CSS in the constructable stylesheet. Don't load images from `data:` URLs; draw on a canvas instead.
- Keep `src/shared/` free of DOM and `chrome.*` calls where possible, so it can be unit tested.
- Every UI string goes through `t()` and lives in `static/_locales/en/messages.json`.
- Files adapted from Firefox keep the MPL header and say what they're adapted from.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

## Two TypeScript versions, on purpose

`package.json` installs both:

```json
"@typescript/native": "npm:typescript@^7.0.2",
"typescript": "npm:@typescript/typescript6@^6.0.2"
```

TypeScript 7 (the Go-based compiler) is what `tsc` runs, so `pnpm typecheck` gets its speed. But 7.0 ships no JavaScript API, and typescript-eslint needs one. So the package named `typescript` is the official 6.0 compatibility package, which is what ESLint loads. This is the [setup the TypeScript team recommends](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0). Once typescript-eslint supports TypeScript 7.1's API, replace both with a plain `typescript` dependency. Dependabot is told to leave the alias alone until then.

## Releasing

Nothing is published automatically. To make a build to share:

1. Bump `version` in `package.json`. The build copies it into the manifest.
2. Run `pnpm check` and `pnpm test:e2e`.
3. Run `pnpm package` and share `artifacts/element-screenshotter-<version>.zip`.

CI (`.github/workflows/ci.yml`) runs the same checks on every push and pull request, and uploads the zip as a build artifact.
