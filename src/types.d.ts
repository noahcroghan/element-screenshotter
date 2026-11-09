/** CSS files are bundled as text by esbuild (see scripts/build.ts). */
declare module '*.css' {
  const css: string;
  export default css;
}

/** SVG files are bundled as element trees (see scripts/svg-plugin.ts). */
declare module '*.svg' {
  // Matches SvgNode in scripts/svg-plugin.ts.
  interface SvgNode {
    tag: string;
    attrs: Record<string, string>;
    children: SvgNode[];
  }
  const tree: SvgNode;
  export default tree;
}

/**
 * In the DOM types since TypeScript 6. Editors that bundle TypeScript 5
 * (such as Zed's vtsls) would otherwise flag it.
 */
interface FocusOptions {
  focusVisible?: boolean;
}
