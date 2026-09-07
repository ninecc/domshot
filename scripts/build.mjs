import { build, context } from 'esbuild';
import { snapdomCompatibility } from './snapdom-compat.mjs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outdir = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await Promise.all([
  cp(resolve(root, 'public/manifest.json'), resolve(outdir, 'manifest.json')),
  cp(resolve(root, 'public/popup.html'), resolve(outdir, 'popup.html')),
  cp(resolve(root, 'public/permission.html'), resolve(outdir, 'permission.html')),
  cp(resolve(root, 'public/_locales'), resolve(outdir, '_locales'), { recursive: true }),
  cp(resolve(root, 'LICENSE'), resolve(outdir, 'LICENSE.txt')),
  cp(resolve(root, 'THIRD_PARTY_NOTICES.md'), resolve(outdir, 'third-party-licenses.txt')),
  ...[16, 32, 48, 128].map((size) => cp(resolve(root, `public/icon${size}.png`), resolve(outdir, `icon${size}.png`))),
]);

const config = {
  entryPoints: {
    background: resolve(root, 'src/background.ts'),
    popup: resolve(root, 'src/popup.ts'),
    permission: resolve(root, 'src/permission.ts'),
    content: resolve(root, 'src/content.ts'),
  },
  bundle: true,
  plugins: [snapdomCompatibility],
  outdir,
  format: 'iife',
  target: 'chrome120',
  sourcemap: true,
  minify: !watch,
};

if (watch) {
  const ctx = await context(config);
  await ctx.watch();
  console.log('Watching extension sources…');
} else {
  await build(config);
  console.log('Built unpacked extension in dist/');
}
