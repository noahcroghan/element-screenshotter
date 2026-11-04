// Commit messages follow Conventional Commits (https://www.conventionalcommits.org/).
// Checked locally by the husky commit-msg hook and in CI.
import type { UserConfig } from '@commitlint/types';

const config: UserConfig = {
  extends: ['@commitlint/config-conventional'],
  // Dependabot writes long, URL-heavy bodies that break the line-length rules.
  ignores: [(message) => message.includes('Signed-off-by: dependabot[bot]')],
};

export default config;
