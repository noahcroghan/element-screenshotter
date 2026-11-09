/** CSS files are bundled as text by esbuild (see scripts/build.ts). */
declare module '*.css' {
  const css: string;
  export default css;
}

/**
 * In the DOM types since TypeScript 6. Editors that bundle TypeScript 5
 * (such as Zed's vtsls) would otherwise flag it.
 */
interface FocusOptions {
  focusVisible?: boolean;
}
