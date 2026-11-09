// esbuild plugin: `import tree from './x.svg'` gives the SVG as a plain
// { tag, attrs, children } tree, which buildSvgTree() in src/content/dom.ts
// turns into DOM nodes. The content script can't parse markup (no innerHTML
// under Trusted Types) or load images (page CSP), so the parsing happens here.
//
// The parser covers the subset our SVG files use: elements, double-quoted
// attributes, comments, and whitespace. Anything else fails the build.

import type { Plugin } from 'esbuild';
import { readFile } from 'node:fs/promises';

export interface SvgNode {
  tag: string;
  attrs: Record<string, string>;
  children: SvgNode[];
}

const TOKEN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:-]+="[^"&<]*")*)\s*(\/?)>|\s+/y;
const ATTR = /([\w:-]+)="([^"]*)"/g;

export function parseSvg(source: string): SvgNode {
  const root: SvgNode = { tag: '', attrs: {}, children: [] };
  const stack = [root];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length) {
    const at = TOKEN.lastIndex;
    const match = TOKEN.exec(source);
    if (!match) throw new Error(`Unsupported SVG syntax at offset ${at}`);
    const [, closing, opening, attrText = '', selfClosing] = match;
    const parent = stack[stack.length - 1] ?? root;
    if (opening) {
      const attrs: Record<string, string> = {};
      for (const [, name = '', value = ''] of attrText.matchAll(ATTR)) {
        // createElementNS sets the namespace; xmlns attributes are not needed.
        if (name !== 'xmlns' && !name.startsWith('xmlns:')) attrs[name] = value;
      }
      const node: SvgNode = { tag: opening, attrs, children: [] };
      parent.children.push(node);
      if (!selfClosing) stack.push(node);
    } else if (closing) {
      if (closing !== parent.tag) throw new Error(`Unexpected </${closing}> at offset ${at}`);
      stack.pop();
    }
  }
  const [svg, ...rest] = root.children;
  if (stack.length !== 1 || svg?.tag !== 'svg' || rest.length > 0) {
    throw new Error('Expected a single, closed <svg> root element');
  }
  return svg;
}

export const svgPlugin: Plugin = {
  name: 'svg-tree',
  setup(build) {
    build.onLoad({ filter: /\.svg$/ }, async (args) => {
      try {
        const tree = parseSvg(await readFile(args.path, 'utf8'));
        return { contents: JSON.stringify(tree), loader: 'json', watchFiles: [args.path] };
      } catch (error) {
        return { errors: [{ text: (error as Error).message }], watchFiles: [args.path] };
      }
    });
  },
};
