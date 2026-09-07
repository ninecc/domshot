import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

// Compatibility patch for SnapDOM 2.24.10. Public hooks run after its scroll
// wrappers have already been created. Patch that decision, not generated DOM.
export const snapdomCompatibility = {
  name: 'snapdom-document-scroll',
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
      applied = true;
      return { contents: code.replace(before, `if ((o.clip && h === t) || o.__domshotDocumentRoots?.includes(h)) continue;`), loader: 'js' };
    });
  },
};
