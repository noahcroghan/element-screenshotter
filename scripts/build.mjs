#!/usr/bin/env node
// Builds the unpacked extension into dist/.
//
//   node scripts/build.mjs           one-off build
//   node scripts/build.mjs --watch   rebuild on change
//   node scripts/build.mjs --zip     build and write artifacts/element-screenshotter-<version>.zip

import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipDirectory } from './zip.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const zip = args.has('--zip');

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

/** @type {esbuild.BuildOptions} */
const common = {
  bundle: true,
  target: 'chrome116',
  loader: { '.css': 'text' },
  sourcemap: watch ? 'inline' : false,
  minify: false,
  legalComments: 'inline',
  logLevel: 'info',
};

const entries = [
  // Content scripts injected with executeScript cannot be ES modules.
  { entryPoints: ['src/content/index.ts'], outfile: 'dist/content.js', format: 'iife' },
  { entryPoints: ['src/background/index.ts'], outfile: 'dist/background.js', format: 'esm' },
  { entryPoints: ['src/offscreen/index.ts'], outfile: 'dist/offscreen.js', format: 'esm' },
  { entryPoints: ['src/options/index.ts'], outfile: 'dist/options.js', format: 'esm' },
];

async function copyStatic() {
  await cp(join(root, 'static'), dist, { recursive: true });
  for (const file of [
    'src/options/options.html',
    'src/options/options.css',
    'src/offscreen/offscreen.html',
  ]) {
    await cp(join(root, file), join(dist, file.split('/').pop()));
  }
  const manifest = JSON.parse(await readFile(join(root, 'static/manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  await writeFile(join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (!existsSync(join(dist, 'icons/icon-128.png'))) {
    console.warn('warning: icons are missing; run `pnpm icons`');
  }
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await copyStatic();

if (watch) {
  const contexts = await Promise.all(
    entries.map((e) => esbuild.context({ ...common, ...e, absWorkingDir: root })),
  );
  await Promise.all(contexts.map((c) => c.watch()));
  const { watch: fsWatch } = await import('node:fs');
  for (const dir of ['static', 'src/options', 'src/offscreen']) {
    fsWatch(join(root, dir), { recursive: true }, (_event, file) => {
      if (file && /\.(html|css|json|png|svg)$/.test(file)) {
        copyStatic().then(
          () => console.log(`copied ${relative(root, join(dir, file))}`),
          console.error,
        );
      }
    });
  }
  console.log('Watching for changes. Reload the extension in the browser after each build.');
} else {
  await Promise.all(entries.map((e) => esbuild.build({ ...common, ...e, absWorkingDir: root })));
  if (zip) {
    const out = join(root, 'artifacts', `element-screenshotter-${pkg.version}.zip`);
    await mkdir(dirname(out), { recursive: true });
    await zipDirectory(dist, out);
    console.log(`wrote ${relative(root, out)}`);
  }
}
