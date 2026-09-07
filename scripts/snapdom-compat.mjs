import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

// Version-guarded fixes for SnapDOM 2.24.10: document scrolling and font
// embedding. Patch engine decisions, not generated DOM or page-specific names.
export const snapdomCompatibility = {
  name: 'snapdom-compatibility',
  setup(build) {
    let applied = false;
    build.onEnd(result => {
      if (!applied && !result.errors.length) return { errors: [{ text: "SnapDOM compatibility entry was not loaded; review dependency resolution" }] };
    });
    build.onLoad({ filter: /@zumer[\/]snapdom[\/]dist[\/]snapdom\.mjs$/ }, async ({ path }) => {
      const input = await readFile(path, 'utf8');
      if (!input.includes('v2.24.10')) throw new Error('Review the SnapDOM document-scroll patch before upgrading');
      const { code } = await transform(input, { minify: false });
      const before = 'if (o.clip && h === t) continue;';
      if (code.split(before).length !== 2) throw new Error('SnapDOM document-scroll patch no longer matches');
      // Icon recognition is useful for pseudo-element rasterization, but it
      // must not exclude fonts still used by ordinary text nodes. Keep all
      // existing used-family, unicode-range and explicit exclusion checks.
      const start = code.indexOf('async function sn(');
      const end = code.indexOf('function oe(', start);
      if (start < 0 || end < start) throw new Error('SnapDOM font embedding boundary no longer matches');
      const fontCode = code.slice(start, end);
      const iconChecks = /dt\((?:[a-zA-Z]+(?:\.href)?)\)/g;
      if ((fontCode.match(iconChecks) || []).length !== 8) throw new Error('Review SnapDOM icon-font exclusion changes');
      const patched = code.slice(0, start) + fontCode.replace(iconChecks, 'false') + code.slice(end);
      applied = true;
      return { contents: patched.replace(before, `if ((o.clip && h === t) || o.__domshotDocumentRoots?.includes(h)) continue;`), loader: 'js' };
    });
  },
};
