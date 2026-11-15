// Builds the unpacked extension into dist/.
//
//   pnpm exec tsx scripts/build.ts           one-off build
//   pnpm exec tsx scripts/build.ts --watch   rebuild on change
//   pnpm exec tsx scripts/build.ts --zip     build and write out/element-screenshotter-<version>.zip

import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { watch as watchFiles } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { svgPlugin } from './svg-plugin.ts';
import { zipDirectory } from './zip.ts';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
const args = new Set(process.argv.slice(2));

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string };

const common: esbuild.BuildOptions = {
  bundle: true,
  target: 'chrome116',
  loader: { '.css': 'text' },
  plugins: [svgPlugin],
  sourcemap: args.has('--watch') ? 'inline' : false,
  legalComments: 'inline',
  logLevel: 'info',
  absWorkingDir: root,
};

const entries: esbuild.BuildOptions[] = [
  // Content scripts injected with executeScript cannot be ES modules.
  { entryPoints: ['src/content/index.ts'], outfile: 'dist/content.js', format: 'iife' },
  { entryPoints: ['src/background/index.ts'], outfile: 'dist/background.js', format: 'esm' },
  { entryPoints: ['src/offscreen/index.ts'], outfile: 'dist/offscreen.js', format: 'esm' },
  { entryPoints: ['src/options/index.ts'], outfile: 'dist/options.js', format: 'esm' },
];

const PAGES = [
  'src/options/options.html',
  'src/options/options.css',
  'src/offscreen/offscreen.html',
];

async function copyStatic() {
  // icon.svg is the source for the PNGs and doesn't need to ship.
  await cp(join(root, 'static'), dist, { recursive: true, filter: (src) => !src.endsWith('.svg') });
  for (const page of PAGES) await cp(join(root, page), join(dist, basename(page)));
  const manifest = JSON.parse(await readFile(join(root, 'static/manifest.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  manifest.version = pkg.version;
  await writeFile(join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await copyStatic();

if (args.has('--watch')) {
  const contexts = await Promise.all(
    entries.map((entry) => esbuild.context({ ...common, ...entry })),
  );
  await Promise.all(contexts.map((context) => context.watch()));
  for (const dir of ['static', 'src/options', 'src/offscreen']) {
    watchFiles(join(root, dir), { recursive: true }, (_event, file) => {
      if (file && /\.(html|css|json|png)$/.test(file)) {
        copyStatic().then(
          () => {
            console.log(`copied ${relative(root, join(dir, file))}`);
          },
          (error: unknown) => {
            console.error(error);
          },
        );
      }
    });
  }
  console.log('Watching for changes. Reload the extension in the browser after each build.');
} else {
  await Promise.all(entries.map((entry) => esbuild.build({ ...common, ...entry })));
  if (args.has('--zip')) {
    const out = join(root, 'out', `element-screenshotter-${pkg.version}.zip`);
    await mkdir(dirname(out), { recursive: true });
    await zipDirectory(dist, out);
    console.log(`wrote ${relative(root, out)}`);
  }
}
