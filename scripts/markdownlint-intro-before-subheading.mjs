// Custom markdownlint rule: a heading followed straight away by a deeper
// heading needs some text in between, e.g. "# Security" then "## Scope".
// markdownlint has no built-in rule for this. JavaScript, because
// markdownlint-cli2 imports custom rules with Node's own loader.

/** @param {import('markdownlint').MicromarkToken} token */
function headingLevel(token) {
  if (token.type === 'atxHeading') {
    return token.children.find((child) => child.type === 'atxHeadingSequence')?.text.length ?? 0;
  }
  const underline = token.children.find((child) => child.type === 'setextHeadingLine');
  return underline?.text.startsWith('=') ? 1 : 2;
}

/** @type {Set<string>} */
const blank = new Set(['lineEnding', 'lineEndingBlank', 'linePrefix']);
/** @type {Set<string>} */
const headings = new Set(['atxHeading', 'setextHeading']);

/** @type {import('markdownlint').Rule} */
export default {
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
