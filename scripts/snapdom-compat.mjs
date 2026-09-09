import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

// Version-guarded fixes for SnapDOM 2.24.17: document scrolling, font
// embedding and pseudo-element generation. Patch engine decisions, not generated DOM or page-specific names.
function replaceExactly(source, search, replacement, errorMessage) {
  if (source.split(search).length !== 2) throw new Error(errorMessage);
  return source.replace(search, replacement);
}

function patchDocumentScroll(code) {
  // Upstream: not filed. Repro is ready in "a body that participates in document scrolling is not frozen as a nested scroller".
  // Delete when SnapDOM distinguishes document-scrolling roots from nested scrollers and that test passes unpatched.
  return replaceExactly(
    code,
    'if (o.clip && p === t) continue;',
    'if ((o.clip && p === t) || o.options.__domshotDocumentRoots?.includes(p)) continue;',
    'SnapDOM document-scroll patch no longer matches',
  );
}

function patchIconFontEmbedding(code) {
  // Upstream: https://github.com/zumerlab/snapdom/issues/146. The narrower
  // https://github.com/zumerlab/snapdom/issues/493 fix only keeps mixed-family stylesheets;
  // 2.24.17 still excludes each icon family and its font URL here.
  // Regression: "loaded icon fonts retain direct glyphs alongside pseudo-element icons".
  // Delete when SnapDOM embeds a used icon family's faces/resources and that test passes unpatched.
  let patched = code;
  const replacements = [
    ['if (!pt(i)) {', '{'],
    ['if (!c || pt(c)) continue;', 'if (!c) continue;'],
    ['if (!F || pt(F)) continue;', 'if (!F) continue;'],
    ['if (pt(x) || !a.has(x.toLowerCase())', 'if (!a.has(x.toLowerCase())'],
    ['if (!x || pt(x) || !a.has(x.toLowerCase())', 'if (!x || !a.has(x.toLowerCase())'],
  ];
  for (const [search, replacement] of replacements) {
    patched = replaceExactly(patched, search, replacement, `Review SnapDOM icon-font embedding near: ${search}`);
  }
  return patched;
}

function patchPseudoIconFace(code) {
  // Upstream: not filed. A submit-ready two-face PUA repro lives in
  // "icon fonts select the matching face when one PUA codepoint has multiple glyphs".
  // Delete when iconToImage applies computed font-style to measurement and canvas text, and that test passes unpatched.
  let patched = replaceExactly(
    code,
    'async function $o(t, e, n, o = 32, r = "#000") {',
    'async function $o(t, e, n, o = 32, r = "#000", q = "normal") {',
    'SnapDOM pseudo-icon rasterizer signature no longer matches',
  );
  patched = replaceExactly(
    patched,
    'i.style.fontWeight = n || "normal", i.style.fontSize = `${o}px`',
    'i.style.fontWeight = n || "normal", i.style.fontStyle = q || "normal", i.style.fontSize = `${o}px`',
    'SnapDOM pseudo-icon measurement font no longer matches',
  );
  patched = replaceExactly(
    patched,
    'd.font = n ? `${n} ${o}px "${e}"` : `${o}px "${e}"`',
    'd.font = `${q || "normal"} ${n || "normal"} ${o}px "${e}"`',
    'SnapDOM pseudo-icon canvas font no longer matches',
  );
  return replaceExactly(
    patched,
    'await $o(u, b, w, y, S)',
    'await $o(u, b, w, y, S, c.fontStyle)',
    'SnapDOM pseudo-icon call site no longer matches',
  );
}

function patchPseudoElementGeneration(code) {
  // Upstream: not filed. Repro is ready in "only generated pseudo-elements contribute decoration to captures".
  // Delete when display:none and content:none/normal pseudos are skipped before paint/layout reconstruction, and that test passes unpatched.
  const probe = '    let c = T(t, a);\n    if (!c ||';
  return replaceExactly(code, probe, `    let c = T(t, a);
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
      if (!input.includes('v2.24.17')) throw new Error('Review the SnapDOM compatibility patches before upgrading');
      const { code } = await transform(input, { minify: false });
      const patched = patchPseudoElementGeneration(patchPseudoIconFace(patchIconFontEmbedding(patchDocumentScroll(code))));
      applied = true;
      return { contents: patched, loader: 'js' };
    });
  },
};
