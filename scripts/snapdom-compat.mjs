import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

// Version-guarded fixes for SnapDOM 2.24.10: document scrolling, font
// embedding and pseudo-element generation. Patch engine decisions, not generated DOM or page-specific names.
function replaceExactly(source, search, replacement, errorMessage) {
  if (source.split(search).length !== 2) throw new Error(errorMessage);
  return source.replace(search, replacement);
}

function patchDocumentScroll(code) {
  return replaceExactly(
    code,
    'if (o.clip && h === t) continue;',
    'if ((o.clip && h === t) || o.__domshotDocumentRoots?.includes(h)) continue;',
    'SnapDOM document-scroll patch no longer matches',
  );
}

function patchIconFontEmbedding(code) {
  // Icon recognition is useful for pseudo-element rasterization, but it must
  // not exclude fonts still used by ordinary text nodes. Used-family,
  // unicode-range and explicit exclusion checks remain in place.
  const start = code.indexOf('async function sn(');
  const end = code.indexOf('function oe(', start);
  if (start < 0 || end < start) throw new Error('SnapDOM font embedding boundary no longer matches');
  let fontCode = code.slice(start, end);
  const replacements = [
    ['if (!dt(i)) {', '{'],
    ['if (!c || dt(c)) continue;', 'if (!c) continue;'],
    ['if (!k || dt(k)) continue;', 'if (!k) continue;'],
    ['    if (dt(g.href)) continue;\n', ''],
    ['if (A?.ok && typeof A.data == "string" && (x = A.data), dt(g.href)) continue;', 'A?.ok && typeof A.data == "string" && (x = A.data);'],
    ['if (!F || dt(F)) continue;', 'if (!F) continue;'],
    ['if (dt(x) || !a.has(x.toLowerCase())', 'if (!a.has(x.toLowerCase())'],
    ['if (!x || dt(x) || !a.has(x.toLowerCase())', 'if (!x || !a.has(x.toLowerCase())'],
  ];
  for (const [search, replacement] of replacements) {
    fontCode = replaceExactly(fontCode, search, replacement, `Review SnapDOM icon-font embedding near: ${search}`);
  }
  return code.slice(0, start) + fontCode + code.slice(end);
}

function patchPseudoElementGeneration(code) {
  // Styled ::before/::after do not exist without generated content. An empty
  // quoted string is valid; ::first-letter follows different generation rules.
  const probe = '    let c = N(t, a);\n    if (!c ||';
  return replaceExactly(code, probe, `    let c = N(t, a);
    if (c && (c.display === "none" || (a !== "::first-letter" && (c.content === "none" || c.content === "normal")))) continue;
    if (!c ||`, 'Review SnapDOM pseudo-element generation changes');
}

export const snapdomCompatibility = {
  name: 'snapdom-compatibility',
  setup(build) {
    let applied = false;
    build.onEnd(result => {
      if (!applied && !result.errors.length) return { errors: [{ text: "SnapDOM compatibility entry was not loaded; review dependency resolution" }] };
    });
    build.onLoad({ filter: /@zumer[\/]snapdom[\/]dist[\/]snapdom\.mjs$/ }, async ({ path }) => {
      const input = await readFile(path, 'utf8');
      if (!input.includes('v2.24.10')) throw new Error('Review the SnapDOM compatibility patches before upgrading');
      const { code } = await transform(input, { minify: false });
      const patched = patchPseudoElementGeneration(patchIconFontEmbedding(patchDocumentScroll(code)));
      applied = true;
      return { contents: patched, loader: 'js' };
    });
  },
};
