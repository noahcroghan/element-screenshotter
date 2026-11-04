# Notes for AI agents

Read this before working in the repository. Human-facing docs are [README.md](README.md) (users), [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) (setup, tests, conventions), and [docs/DESIGN.md](docs/DESIGN.md) (architecture and decisions). Keep all three accurate when behaviour changes.

## Ground rules

- **Do not publish anything** (push, create a GitHub repo or release, upload to a store) unless the owner explicitly asks in the current conversation. Local commits are fine.
- Use **pnpm**, never npm or yarn.
- The README must keep saying that the project is AI-generated.
- Prose should be plain, concise, and human. Avoid filler and marketing words.
- Make small commits with Conventional Commit messages. Run `pnpm check` before every commit, and `pnpm test:e2e` when behaviour changes. Chain commands with `&&` so a failing check stops the commit.

## Environment (the owner's machine)

- The shell is WSL bash, but the repo is on the Windows drive and the toolchain is Windows Node. Run project commands through `cmd.exe`, e.g. `cmd.exe /c "pnpm check"`, piping through `tr -d '\r'`. Running Linux Node on `node_modules` breaks esbuild's native binary.
- File tools (read/write/edit) take Windows paths: `C:/Users/Noah/Git/element-screenshotter/...`. Files under `/tmp` in WSL are not visible to them.
- The browser under test is **Helium** (Chromium 156) at `%LOCALAPPDATA%\imput\Helium\Application\chrome.exe`. It is also the owner's daily browser. Tests always use a throwaway profile, so never point anything at the real `User Data` folder.
- Zen (Firefox-based) is installed too, if you need to compare with real Firefox Screenshots.
- `gh` is authenticated as the owner. Read-only calls (`gh api ...`) are fine; see the ground rules for anything that writes.

## Things that cost time before

- **Helium bundles uBlock Origin** (`blockjmkbacgjkknlgpkjjiijinjdanf`). It can't be disabled or uninstalled, and it reloads every tab once when it finishes starting. That showed up as a mysterious "navigation" mid-test. `Harness.launch()` waits for it on a warm-up tab. Keep that, or tests become flaky.
- **`browser.extensions()` is empty right after launch.** The harness polls for it.
- **The overlay's shadow root is closed.** Tests read state through `__elementScreenshotter.snapshot()` in the extension's isolated world (`Harness.snapshot()`), not through the DOM.
- **Hit testing must turn off pointer events on the host element itself**, not just the shadow contents. Otherwise `elementFromPoint` returns our own host.
- **`all: initial` does not reset `direction`.** The host sets `dir` from `@@bidi_dir`, or RTL pages flip the UI.
- **The capture scale must come from `devicePixelRatio`** when it agrees with the bitmap. `bitmap.width / innerWidth` is off at fractional scales because `innerWidth` is rounded.
- **Chrome limits `captureVisibleTab` to 2 calls per second.** The service worker queues calls. Long pages are slow by design.
- **Data URLs over about 2 MB fail in `chrome.downloads`,** and messages are JSON-only and capped at 64 MiB. That's why downloads go through the offscreen document in base64 chunks.

## Scratch work

Put throwaway scripts in `.scratch/` (git-ignored, lint-ignored). To run a TypeScript scratch script that imports the test harness, bundle it first, because Node's type stripping can't handle the harness's parameter properties:

```sh
cmd.exe /c "pnpm exec esbuild .scratch\x.mts --bundle --platform=node --format=esm --packages=external --outfile=.scratch\out.mjs && node .scratch\out.mjs"
```

`page.screenshot()` from puppeteer captures the overlay too, which is the quickest way to look at UI changes. The read tool can open the PNG.

## Where things are

- UI state machine: `src/content/overlay.ts`
- Element heuristic and tree navigation: `src/content/element-picker.ts` (MPL, ported from Firefox)
- Stitching: `src/content/capture.ts`, with tile planning in `src/shared/geometry.ts`
- Message protocol: `src/shared/messages.ts`
- Firefox's original implementation, for reference: `browser/components/screenshots/` in <https://github.com/mozilla-firefox/firefox>. Use a sparse clone if you need it locally.
