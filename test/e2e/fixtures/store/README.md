# Store screenshot page

`screenshot-article.html` is the page in the store screenshots. `pnpm store:screenshots` loads it from the test server with every other request blocked, so the screenshots only change when the extension or this file does.

It is a saved copy of the English Wikipedia article [Screenshot](https://en.wikipedia.org/w/index.php?title=Screenshot&oldid=1368636598), revision 1368636598, made with `scripts/store-page.ts` on 2026-11-18. The script removed the scripts, inlined the stylesheets and the article's first image, and blanked the other images, including Wikipedia's logos.

## Licenses

This folder is not under the project's Mozilla Public License.

- **Article text:** by [Wikipedia contributors](https://en.wikipedia.org/w/index.php?title=Screenshot&action=history), under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- **Image:** [QEMU 6.2 screenshot (cropped)](<https://commons.wikimedia.org/wiki/File:QEMU_6.2_screenshot_(cropped).png>) by VulcanSphere, showing software by the OpenIndiana Project, KDE, MATE, htop, and QEMU, under the [CDDL](https://opensource.org/license/cddl-1-0).
- **Stylesheets:** from MediaWiki, its Vector skin, and Codex, under [GPL-2.0-or-later](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html).

Wikipedia is a trademark of the Wikimedia Foundation. This project is not made or endorsed by the Wikimedia Foundation.

## Replacing the page

Run `pnpm exec tsx scripts/store-page.ts [url]` only to change the page on purpose. Then update the revision, date, and licenses above, run `pnpm store:screenshots`, and check every image: positions in `scripts/store-screenshots.ts` are tied to this page's layout.
