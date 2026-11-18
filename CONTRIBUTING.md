# Contributing

Thanks for helping. This project is AI-generated: an AI coding agent wrote the code and docs (see the [README](README.md)). Contributions from people are welcome all the same, and they get the same review.

## Before you start

- Report bugs and ideas in [issues](../../issues/new/choose). The forms ask for what's needed to reproduce a bug.
- Don't report security problems in public issues. See the [security policy](SECURITY.md).
- Follow the [code of conduct](CODE_OF_CONDUCT.md).
- The goal is to work like Firefox Screenshots in Chromium browsers. Bug fixes and closer matches to Firefox are welcome. Features or settings that Firefox doesn't have usually aren't, so open an issue to discuss those before writing code.

## Making a change

[The development guide](docs/development.md) covers setup, tests, and conventions, and [the design notes](docs/design-notes.md) explain how the extension works. In short:

- Use [pnpm](https://pnpm.io/), not npm or yarn.
- Run `pnpm check` before each commit, and `pnpm test:e2e` when behaviour changes.
- Write commit messages as [Conventional Commits](https://www.conventionalcommits.org/) (`fix: ...`, `feat: ...`, `docs: ...`). A git hook and CI check them.
- When behaviour changes, update the README and the docs in the same pull request.
- Keep prose plain and ASCII-only.

Coding agents should also read [the notes for AI agents](AGENTS.md).

## Pull requests

- Keep each pull request to one topic, in small commits.
- Fill in the template: what changed and how you tested it.
- CI must pass before a pull request is merged.

## License

By contributing, you agree that your contribution is licensed under the [Mozilla Public License 2.0](LICENSE), like the rest of the project.
