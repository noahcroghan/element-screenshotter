# Web store listing

This is the text to paste into the Chrome Web Store Developer Dashboard and Microsoft Partner Center, and the store rules it was checked against. Keep it in step with the manifest, the README's "Permissions and privacy" section, and [the privacy policy](privacy-policy.md). The store documentation linked below is what counts when the rules change; it was last read on 2026-11-09.

## Chrome Web Store

The dashboard has three tabs to fill in: Store listing, Privacy, and Distribution ([Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish)).

### Store listing tab

The name and the short summary come from the manifest (`extName` and `extDescription` in `static/_locales/en/messages.json`), not from the dashboard ([Prepare your extension](https://developer.chrome.com/docs/webstore/prepare)). Today they read:

- **Name:** Element Screenshotter
- **Summary:** Screenshot an element, a region, or the whole page.

**Category:** Tools ("tools that don't fit into other categories", [Choose your extension's category well](https://developer.chrome.com/docs/webstore/best-practices)). Art & Design, for tools that view and edit images, is the alternative.

**Language:** English.

**Detailed description:**

```text
Take a screenshot of exactly the part of a page you want.

Point at the page and the element under your pointer is highlighted. Click to capture just that element, even if it is taller than the window. Or drag to capture any region, then fine-tune it with the handles or the arrow keys. You can also save the visible part of the page, or the full page from top to bottom.

A preview lets you copy the screenshot to the clipboard or download it as a PNG file.

Features:
- Element picking skips headings in favour of the section they head, and ignores wrappers bigger than the screen.
- Arrow keys move the highlight to the parent, child, or sibling element, so any element can be reached.
- Works inside shadow DOM and same-site frames.
- Long elements and full pages are scrolled and stitched into one image.
- Start from the toolbar button, Ctrl+Shift+S (Command+Shift+S on a Mac), or the right-click menu.

Privacy: the extension only reads a page after you start a screenshot on it. Everything happens on your device. It sends nothing over the network, and screenshots go only to your clipboard or downloads folder.

The interaction design follows the screenshot tool built into Firefox, and parts of the code are adapted from Firefox and the Zen browser under the Mozilla Public License 2.0. This extension is not made or endorsed by Mozilla or Zen.

Browsers don't let extensions capture their own pages (such as settings pages), web store pages, or the built-in PDF viewer.
```

**Graphic assets:** the store icon is `static/icons/icon-128.png`. At least one screenshot is required, 1280x800 (preferred) or 640x400, up to five. Make them with `pnpm store:screenshots` (see [Store screenshots](development.md#store-screenshots)) and upload all four from `out/store-screenshots/` in file name order. The promo tiles and video are optional; leave them out.

**Homepage and support URLs:** <https://github.com/noahcroghan/element-screenshotter> and <https://github.com/noahcroghan/element-screenshotter/issues>.

### Privacy tab

**Single purpose description:**

```text
Take screenshots of a web page: an element, a region the user selects, the visible area, or the full page, which the user then copies or downloads.
```

**Permission justifications:**

| Permission     | Justification                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `activeTab`    | Grants access to the current tab only when the user clicks the toolbar button, presses the shortcut, or chooses the context menu item. Used to capture the visible tab with captureVisibleTab.   |
| `scripting`    | Injects the screenshot overlay (element highlight, region selection, preview) into the tab the user invoked the extension on, with executeScript. No content scripts run on any page by default. |
| `downloads`    | Saves the screenshot as a PNG file when the user clicks Download.                                                                                                                                |
| `offscreen`    | Chrome rejects large data URLs in downloads, and the service worker can't create blob URLs. An offscreen document (reason BLOBS) turns the image into a blob URL for the download.               |
| `storage`      | Stores the user's settings, whether they last chose Copy or Download, and where they moved the Save buttons. Local only.                                                                         |
| `contextMenus` | Adds the "Take Screenshot" item to the page's context menu, one of the three ways to start a screenshot.                                                                                         |

There are no host permissions, so no host permission justification is needed.

**Remote code:** No, I am not using remote code. Everything is bundled in the package.

**Data usage:** tick **Website content**. Chrome counts screenshots of a page as user data even when they never leave the device ([User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), questions 2 to 4). The page title also goes into the file name. Leave every other data type unticked: settings contain no personal data, and nothing else is read. Then tick all three certifications (no selling or transfer to third parties, no unrelated use, no creditworthiness use); all are true.

**Privacy policy URL:** <https://github.com/noahcroghan/element-screenshotter/blob/main/docs/privacy-policy.md>, the public page for [the privacy policy](privacy-policy.md). Chrome requires one even though data stays on the device (User Data FAQ, question 14).

### Distribution tab

Free, public, all regions. Optionally, choose deferred publishing in the submission dialog, so an approved item waits for you to publish it ([Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish)).

## Microsoft Edge Add-ons

Edge uses Partner Center, with Packages, Availability, Properties, Privacy, and Store listings pages ([Publish a Microsoft Edge extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)). Reuse the Chrome text. Where Edge differs:

- **Name and short description** come from the manifest, as in Chrome.
- **Description:** required, 250 to 10,000 characters. The Chrome detailed description above fits as is.
- **Extension logo:** square, at least 128x128, 300x300 recommended. `static/icons/icon-128.png` meets the minimum.
- **Search terms:** optional. Leave empty rather than risk keyword stuffing.
- **Screenshots:** optional, up to six, 640x480 or 1280x800. Upload the same four as Chrome, since 1280x800 is allowed in both stores.
- **Promotional tiles and video:** optional; leave them out.
- **Privacy policy:** required when the extension handles personal information. Use the same URL as Chrome.
- **Properties page:** category Productivity, the closest match among the Edge Add-ons categories, and optionally a website and support contact: the same repository and issues URLs as Chrome.
- **Privacy page:** the same single purpose, permission justifications, data practices, and "no remote code" answers as the Chrome Privacy tab. Microsoft requires them to match what the extension does and the privacy policy ([Microsoft Edge Add-ons developer policies](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies)).
- **Submission:** the **Publish** button on Store listings sends the extension to certification, and it goes live as soon as it passes; there is no deferred publishing.
- **Notes for certification:** "Click the toolbar button on any web page, hover an element, and click it. Then use Copy or Download in the toolbar under the selection. No account or test credentials are needed."

The end-to-end suite passed in Edge 157 on Windows (45 of 45 tests, 2026-11-09).

## Policy checks

Each point below was checked against the current text of the linked policy.

| Policy                                                                                                                                                                            | Check                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Single purpose](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq)                                                                              | Every feature serves taking a screenshot of a page.                                                                                                                              |
| [Use of permissions](https://developer.chrome.com/docs/webstore/program-policies/permissions)                                                                                     | Six permissions, each used by a current feature. `activeTab` instead of host permissions, so there's no "read all your data" warning. Only `downloads` shows an install warning. |
| [Limited use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) and [user data](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) | Page content is used only to make the screenshot the user asked for, on the device. Disclosed as website content, with a privacy policy.                                         |
| [Disclosure requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)                                                                    | Nothing is collected in a way users wouldn't expect: reading the page is the feature they invoked. The listing says so.                                                          |
| [Privacy policies](https://developer.chrome.com/docs/webstore/program-policies/privacy)                                                                                           | Policy says what is handled, how it is used, and that nothing is shared.                                                                                                         |
| [Listing requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements)                                                                          | Description and icon are ready. Screenshots must show the real UI.                                                                                                               |
| [Keyword spam](https://developer.chrome.com/docs/webstore/program-policies/spam-faq)                                                                                              | No keyword lists, no other extensions named. Firefox and Zen are named only in the attribution at the end of the description.                                                    |
| [Impersonation and intellectual property](https://developer.chrome.com/docs/webstore/program-policies/impersonation-and-intellectual-property)                                    | The description says the extension isn't made or endorsed by Mozilla or Zen. The name, icon, and screenshots don't use their marks.                                              |
| [Code readability](https://developer.chrome.com/docs/webstore/program-policies/code-readability)                                                                                  | esbuild bundles but doesn't minify, so reviewers can read the code.                                                                                                              |
| [Mature content](https://developer.chrome.com/docs/webstore/rating)                                                                                                               | Not mature.                                                                                                                                                                      |
| [Image guidelines](https://developer.chrome.com/docs/webstore/images)                                                                                                             | 128 px icon with 96x96 artwork and 16 px transparent padding; screenshots 1280x800.                                                                                              |
| [Edge developer policies](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies)                                                                   | The same answers apply: accurate listing, minimal permissions, a privacy policy, no remote code.                                                                                 |
