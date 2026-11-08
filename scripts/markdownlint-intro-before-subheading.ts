// Custom markdownlint rule: a heading followed straight away by a deeper
// heading needs some text in between, e.g. "# Security" then "## Scope".
// markdownlint has no built-in rule for this. `pnpm lint:md` runs
// markdownlint-cli2 through tsx so it can load this file.

import type { MicromarkToken, Rule } from 'markdownlint';

function headingLevel(token: MicromarkToken): number {
  if (token.type === 'atxHeading') {
    return token.children.find((child) => child.type === 'atxHeadingSequence')?.text.length ?? 0;
  }
  const underline = token.children.find((child) => child.type === 'setextHeadingLine');
  return underline?.text.startsWith('=') ? 1 : 2;
}

const blank = new Set<string>(['lineEnding', 'lineEndingBlank', 'linePrefix']);
const headings = new Set<string>(['atxHeading', 'setextHeading']);

const introBeforeSubheading: Rule = {
  names: ['intro-before-subheading'],
  description: 'Text between a heading and its first subheading',
  tags: ['headings'],
  parser: 'micromark',
  function: (params, onError) => {
    const blocks = params.parsers.micromark.tokens.filter((token) => !blank.has(token.type));
    blocks.forEach((token, index) => {
      const next = blocks[index + 1];
      if (
        headings.has(token.type) &&
        next !== undefined &&
        headings.has(next.type) &&
        headingLevel(next) > headingLevel(token)
      ) {
        onError({
          lineNumber: token.startLine,
          detail: 'Add an introduction before the subheading.',
        });
      }
    });
  },
};

export default introBeforeSubheading;
