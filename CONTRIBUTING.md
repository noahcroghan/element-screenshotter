# Contributing

Thanks for helping. Please note that this project is AI-generated: an AI coding agent wrote the code and docs (see the [README](README.md)). Contributions from people are welcome all the same, and they get the same review.

## Before you start

- **Bugs and ideas** go in [issues](../../issues/new/choose). The forms ask for what's needed to reproduce a bug.
- **Security problems** must not go in public issues. See the [security policy](SECURITY.md).
- **Scope.** The goal is Firefox Screenshots' behaviour in Chromium browsers. Bug fixes and closer matches to Firefox are welcome. Features or settings that Firefox doesn't have usually aren't, so open an issue to discuss those before writing code.

## Making a change

[docs/development.md](docs/development.md) covers setup, tests, and conventions, and [docs/design-notes.md](docs/design-notes.md) explains how the extension works. In short:

- Use [pnpm](https://pnpm.io/), not npm or yarn.
- Run `pnpm check` before each commit, and `pnpm test:e2e` when behaviour changes.
- Write commit messages as [Conventional Commits](https://www.conventionalcommits.org/) (`fix: ...`, `feat: ...`, `docs: ...`). A git hook and CI check them.
- When behaviour changes, update the README and the docs in the same pull request.
- Keep prose plain and ASCII-only.

Coding agents should also read [AGENTS.md](AGENTS.md).

## Pull requests

- Keep each pull request to one topic, in small commits.
- Fill in the template: what changed and how you tested it.
- CI must pass before a pull request is merged.

## License

By contributing, you agree that your contribution is licensed under the [Mozilla Public License 2.0](LICENSE), like the rest of the project.
