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
| `pnpm lint:commits`            | commitlint on commits not yet on `origin/main`                             |

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
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `test:`, `docs:`, `ci:`, `chore:`, and so on), checked by [commitlint](https://commitlint.js.org/) with `@commitlint/config-conventional`. `pnpm install` sets up a [husky](https://typicode.github.io/husky/) `commit-msg` hook that rejects a bad message before the commit is made. CI checks every pushed commit too. `pnpm lint:commits` checks everything not yet on `origin/main`.

## Two TypeScript versions, on purpose

`package.json` installs both:

```json
"@typescript/native": "npm:typescript@^7.0.2",
"typescript": "npm:@typescript/typescript6@^6.0.2"
```

TypeScript 7 (the Go-based compiler) is what `tsc` runs, so `pnpm typecheck` gets its speed. But 7.0 ships no JavaScript API, and typescript-eslint needs one. So the package named `typescript` is the official 6.0 compatibility package, which is what ESLint loads. This is the [setup the TypeScript team recommends](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0). Once typescript-eslint supports TypeScript 7.1's API, replace both with a plain `typescript` dependency. Dependabot is told to leave the alias alone until then.

## Continuous integration

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every push to `main` and every pull request:

- **Commit messages.** commitlint over the new commits.
- **Check.** typecheck, ESLint, markdownlint, Prettier, unit tests, and a packaged build, which is uploaded as an artifact.
- **End-to-end.** The browser tests in Chrome for Testing at device pixel ratios 1, 1.25, and 2. If a test fails, its page screenshot is uploaded.

Actions are pinned to commit SHAs. Dependabot updates them and the npm dependencies weekly, using Conventional Commit messages.

## Releasing

Releases are built by [`.github/workflows/release.yml`](../.github/workflows/release.yml) when a version tag is pushed. It runs the whole CI pipeline first, then publishes a GitHub release with the zip and a `SHA256SUMS.txt`, using that version's `CHANGELOG.md` section as the notes.

1. Bump `version` in `package.json`. The build copies it into the manifest.
2. Add a `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md`. The release fails without one.
3. Commit (`chore: release x.y.z`) and push to `main`. Wait for CI to pass.
4. Tag and push the tag:

   ```sh
   git tag -a vx.y.z -m "vx.y.z"
   git push origin vx.y.z
   ```

The workflow refuses a tag that doesn't match `package.json`. Tags with a hyphen (`v1.1.0-beta.1`) become pre-releases. Once the repository is public, the workflow also attaches build provenance (`gh attestation verify <zip> --repo noahcroghan/element-screenshotter`). GitHub only offers that for public repositories on free plans.

For a local build to share without releasing, run `pnpm package` and use `artifacts/element-screenshotter-<version>.zip`.
