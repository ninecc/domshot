import type { SnapdomPlugin } from '@zumer/snapdom';

// Once computed styles and pseudo-elements have been captured, source rules
// must not match the new tree again (for example :first-child after inserting
// a synthetic ::before). Engine-generated styles/fonts live outside this clone.
export function snapshotStylesPlugin(): SnapdomPlugin {
  return {
    name: 'domshot-snapshot-styles',
    beforeRender({ nodeMap }) {
      for (const [copy, source] of nodeMap ?? []) {
        if (!(source instanceof Element) || source.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
        if (source.localName === 'style' || (source.localName === 'link' && source.getAttribute('rel')?.split(/\s+/).includes('stylesheet'))) {
          copy.parentNode?.removeChild(copy);
        }
      }
    },
  };
}
