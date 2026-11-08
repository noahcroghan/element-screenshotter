# Security

## Reporting a vulnerability

Please don't report security problems in public issues. Report them privately through GitHub instead: on the repository's **Security** tab, click **Report a vulnerability**, or go straight to the [advisory form](https://github.com/noahcroghan/element-screenshotter/security/advisories/new).

Say what an attacker could do, how to reproduce it, and which browser and extension version you used. Replies and fixes are discussed in the private advisory. Once a fix is released, the advisory is published with credit to you, unless you'd rather not be named.

## Supported versions

Only the latest release gets security fixes.

## Scope

In scope is the extension as shipped in the release zip: the content script and overlay, the service worker, the offscreen document, and the options page. For example:

- a web page that can read, change, or trigger a screenshot without the user's action
- a web page that can run code with the extension's privileges, or see its isolated world
- screenshots or settings leaking anywhere other than where the user saved or copied them

Out of scope:

- Development tooling: build scripts, tests, CI, and dev dependencies. The exception is anything that could put malicious code into a released zip.
- Bugs in the browser itself. Report those to the browser vendor, for Chrome at <https://issues.chromium.org/>.
- Attacks that need a malicious extension or a compromised browser or computer.
- Pages the extension can't run on (see [Limitations](README.md#limitations)).
