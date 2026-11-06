# Notes for AI agents

Human-facing docs come first: [README.md](README.md) for users, [docs/development.md](docs/development.md) for setup, tests, and conventions, and [docs/design-notes.md](docs/design-notes.md) for architecture and decisions. Keep all three accurate when behaviour changes.

## Ground rules

- The GitHub repository is **private**. Never change its visibility, and don't publish anywhere else (web stores, package registries) unless the owner asks. Ask before any other outward-facing action (accounts, secrets, settings) your task doesn't name.
- Work is tracked as issues on the repo's GitHub Project board. Close or update the issues you work on.
- Use **pnpm**, never npm or yarn.
- The README must keep saying that the project is AI-generated.
- Follow YAGNI. Clone Firefox's behaviour and fix real problems; don't add settings or features nobody asked for.
- Write prose that is plain, concise, and ASCII-only.
- Make small commits with Conventional Commit messages; the husky hook runs commitlint. Run `pnpm check` before every commit, and `pnpm test:e2e` when behaviour changes. After pushing, watch CI until it passes.
- Finish with a short report: what changed, how you verified it, and anything the owner still has to do.

## Things that cost time before

- **The overlay's shadow root is closed.** Tests read state through `__elementScreenshotter.snapshot()` in the extension's isolated world (`Harness.snapshot()`), not through the DOM.
- **Hit testing must turn off pointer events on the host element itself**, not just the shadow contents. Otherwise `elementFromPoint` returns our own host.
- **`all: initial` does not reset `direction`.** The host sets `dir="ltr"`, or right-to-left pages flip the UI.
- **The capture scale must come from `devicePixelRatio`** when it agrees with the bitmap. `bitmap.width / innerWidth` is off at fractional scales because `innerWidth` is rounded.
- **The first injection after a toolbar click can be refused** ("Cannot access contents of the page") even though `activeTab` was granted: the renderer learns about the grant a moment later. It showed up as rare CI failures on slow Linux runners. The service worker retries briefly when `tab.url` is visible (proof of the grant).
- **Chrome limits `captureVisibleTab` to 2 calls per second.** The service worker queues calls. Long pages are slow by design.
- **Data URLs over about 2 MB fail in `chrome.downloads`,** and messages are JSON-only and capped at 64 MiB. That's why downloads go through the offscreen document in base64 chunks.
- **Downloads in progress have different names per OS:** `*.crdownload` on Windows and macOS, hidden `.org.chromium.Chromium.*` files on Linux. The harness skips both.
- **Case-only renames are invisible on Windows and macOS.** With `core.ignorecase`, `git mv README.md readme.md` changes nothing in the index, and Linux checkouts break. Use `git rm --cached <old>` then `git add <new>`, and check `git ls-files`.
- **Helium bundles uBlock Origin,** which reloads open tabs once at startup. When `BROWSER_PATH` points at Helium, `Harness.launch()` waits for that reload on a warm-up tab.

## Looking at the UI

`page.screenshot()` from puppeteer captures the overlay too. It's the quickest way to check visual changes. Put throwaway scripts in `.scratch/`, which git and ESLint ignore.

Firefox's original implementation is in `browser/components/screenshots/` at <https://github.com/mozilla-firefox/firefox>. Use a sparse clone if you need it locally.
