# Going public

A one-off checklist for making the repository public. Work through it top to bottom on the day. The workflows need no edits: CodeQL, release provenance, and the full pull request matrix switch on by themselves (see [Private or public](development.md#private-or-public)). Delete this file once everything is ticked.

The commands use the [GitHub CLI](https://cli.github.com/) from a clone of the repository. The settings pages are under <https://github.com/noahcroghan/element-screenshotter/settings>.

## Before

- [ ] Scan the whole history for secrets. It should print `no leaks found`. (Last run on 2026-11-07, 33 commits: clean.)

  ```sh
  docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest git /repo --redact
  ```

- [ ] Check the author and committer addresses that become public. On 2026-11-07 the only one was `noahcroghan0@gmail.com`, which your GitHub profile already shows. Hiding an address now would mean rewriting history.

  ```sh
  git log --format='%an <%ae>%n%cn <%ce>' | sort -u
  ```

- [ ] Read through issues, pull requests (open and closed), and release notes for anything private. Their comments become public too. (Checked on 2026-11-07, issues and pull requests #1 to #18: nothing private.)
- [ ] Remember that Actions run logs and uploaded artifacts become public. The workflows use no secrets, and the e2e artifacts only show test pages.
- [ ] Check that the README, [contributing.md](../contributing.md), and [security.md](../security.md) still match how the project works.
- [ ] Open **New issue** and check that the chooser lists **Bug report**, **Feature request**, and **Report a security vulnerability**. Then open any compare page, for example <https://github.com/noahcroghan/element-screenshotter/compare>, pick a branch, and check that the pull request body is prefilled from the template.

## Flip

- [ ] Make the repository public: **Settings > General > Danger Zone > Change repository visibility > Change to public**. Or:

  ```sh
  gh repo edit noahcroghan/element-screenshotter --visibility public --accept-visibility-change-consequences
  ```

- [ ] Make the [project board](https://github.com/users/noahcroghan/projects/5) public, since docs/development.md links to it: on the board, **... > Settings > Danger zone > Change visibility > Public**. Otherwise the link is a 404 for everyone else.

## Settings

- [ ] **Settings > General > Features**: untick **Wikis**. The docs live in the repository, and the wiki is empty.
- [ ] Add a ruleset for `main`: **Settings > Rules > Rulesets > New ruleset > New branch ruleset**.
  - **Ruleset name**: `main`. **Enforcement status**: Active.
  - **Bypass list**: add **Repository admin** (always allow). You and your coding agents push straight to `main`; everyone else goes through pull requests, which then need green checks. If you'd rather send all changes through pull requests, leave the bypass list empty, tick **Require a pull request before merging**, and update AGENTS.md to match.
  - **Target branches**: **Add target > Include default branch**.
  - Keep **Restrict deletions** and **Block force pushes** ticked (the defaults).
  - Tick **Require linear history**.
  - Tick **Require status checks to pass** and add these checks. A check only appears in the search box after it has run once in the past week, so wait for the CodeQL run (below) if `Analyze` is missing.
    - `Commit messages`
    - `Check (ubuntu-latest)`, `Check (windows-latest)`, `Check (macos-latest)`
    - `End-to-end (ubuntu-latest, DPR 1)`, `End-to-end (ubuntu-latest, DPR 1.25)`, `End-to-end (ubuntu-latest, DPR 2)`
    - `End-to-end (windows-latest, DPR 1)`, `End-to-end (macos-latest, DPR 1)`
    - `Analyze (JavaScript and TypeScript)`
  - Click **Create**.
- [ ] **Settings > Advanced Security** (<https://github.com/noahcroghan/element-screenshotter/settings/security_analysis>):
  - **Private vulnerability reporting**: Enable. security.md and the issue chooser link to it.
  - **Dependency graph**: on (it is automatic for public repositories).
  - **Dependabot alerts** and **Dependabot security updates**: on. Both were already on while private.
  - **Code scanning**: leave **CodeQL analysis** on "Not set up" or "Advanced". Don't choose **Default** setup: `.github/workflows/codeql.yml` is the advanced setup, and GitHub rejects uploads from it while default setup is on.
  - **Secret Protection**: Enable, then enable **Push protection** below it.

## Confirm

- [ ] Settings took effect. Expect `public`, then `"enabled":true` for vulnerability reporting, and `enabled` for both secret scanning entries:

  ```sh
  gh api repos/noahcroghan/element-screenshotter --jq '.visibility, .security_and_analysis'
  gh api repos/noahcroghan/element-screenshotter/private-vulnerability-reporting
  gh api repos/noahcroghan/element-screenshotter/rulesets --jq '.[].name'
  ```

- [ ] CodeQL ran. Making the repository public triggers it once (event `public`). If no run shows up, start one with `gh workflow run codeql.yml`.

  ```sh
  gh run list --workflow codeql.yml --limit 3
  ```

  Then check that **Security > Code scanning** (<https://github.com/noahcroghan/element-screenshotter/security/code-scanning>) lists the CodeQL tool, with no configuration errors.

- [ ] The Community Standards page (<https://github.com/noahcroghan/element-screenshotter/community>) ticks the description, README, license, contributing guide, security policy, issue templates, and pull request template. Code of conduct stays unticked: the project has none.
- [ ] The **Security** tab shows the policy and a **Report a vulnerability** button.
- [ ] Pull requests run the full matrix. On the next pull request (a Dependabot one will do), the checks include Windows and macOS:

  ```sh
  gh pr checks <number>
  ```

- [ ] The next release has a provenance attestation. v1.0.0 has none, because it was released while private. After the next tag is published:

  ```sh
  gh release download vx.y.z --pattern '*.zip'
  gh attestation verify element-screenshotter-x.y.z.zip --repo noahcroghan/element-screenshotter
  ```

## Afterwards

- [ ] In AGENTS.md, replace the first ground rule ("The GitHub repository is **private**...") with: "The repository is public. Don't publish anywhere else (web stores, package registries) unless the owner asks. Ask before any other outward-facing action (accounts, secrets, settings) your task doesn't name."
- [ ] In docs/design-notes.md, delete "The repository is private for now." from the Distribution row.
- [ ] Delete this file and its link in docs/development.md, in one commit (`docs: remove the going-public checklist`).
