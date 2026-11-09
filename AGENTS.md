# Notes for AI agents

Human-facing docs come first: [README.md](README.md) for users, [docs/development.md](docs/development.md) for setup, tests, and conventions, and [docs/design-notes.md](docs/design-notes.md) for architecture and decisions. Keep all three accurate when behaviour changes.

## Ground rules

- The GitHub repository is **private**. Never change its visibility, and don't publish anywhere else (web stores, package registries) unless the owner asks. Ask before any other outward-facing action (accounts, secrets, settings) your task doesn't name.
- Work is tracked as issues on the repo's GitHub Project board. Close or update the issues you work on.
- Use **pnpm**, never npm or yarn.
- The README must keep saying that the project is AI-generated.
- Follow YAGNI. Clone Firefox's behaviour and fix real problems; don't add settings or features nobody asked for.
- Write prose that is plain, concise, and ASCII-only.
- Leave changes uncommitted for the owner to review and test. Before handing work over, run `pnpm check`, and `pnpm test:e2e` when behaviour changes.
- Commit only when the owner asks you to commit, and push only when they ask you to push. Being asked to commit is not permission to push.
- Make atomic commits: one logical change per commit, with its code, tests, and docs together, so each commit builds and passes checks on its own. Split unrelated changes, even in the same file, into separate commits. Use Conventional Commit messages; the husky hook runs commitlint. After pushing, check CI. Changes that only touch Markdown files don't need it, since `pnpm check` already lints them. CI runs only on pushes to `main` and on pull requests, so a branch without a pull request gets none. Runs on pull requests from forks may wait for a maintainer to approve them; say so in your report rather than waiting.
- Finish with a short report: what changed, how you verified it, how the owner can test it, and anything the owner still has to do.

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

`page.screenshot()` from puppeteer captures the overlay too. It's the quickest way to check visual changes. Don't pass `clip`: it resizes the viewport, and the overlay drops the hover highlight on resize.

Firefox's original implementation is in `browser/components/screenshots/` at <https://github.com/mozilla-firefox/firefox>. Use a sparse clone if you need it locally.
