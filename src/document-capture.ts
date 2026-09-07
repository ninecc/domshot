import type { SnapdomPlugin } from '@zumer/snapdom';
import type { captureGeometry } from './capture-request';

const backgrounds = ['background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'background-attachment', 'background-blend-mode'];

export function documentCapturePlugin(doc: Document, geometry: NonNullable<ReturnType<typeof captureGeometry>>): SnapdomPlugin {
  const root = doc.documentElement;
  const win = doc.defaultView!;
  const rootStyle = win.getComputedStyle(root);
  const propagateBody = rootStyle.backgroundImage === 'none' && rootStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && rootStyle.contain === 'none' && doc.body && win.getComputedStyle(doc.body).contain === 'none';
  const source = propagateBody ? doc.body : root;
  const viewportRoots = rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible' && rootStyle.contain === 'none' && doc.body
    ? [root, doc.body] : [root];
  const style = win.getComputedStyle(source);
  const background = doc.createElement('div');
  // Keep the original positioning box. Transparent borders extend only the
  // painting area, so percentage/gradient/image sizing retains viewport layout.
  const width = root.getBoundingClientRect().width;
  const height = root.getBoundingClientRect().height;
  background.style.cssText = `all:initial;position:absolute;left:0;top:0;z-index:-1;pointer-events:none;box-sizing:content-box;width:${width}px;height:${height}px;border-right:${Math.max(0, geometry.width-width)}px solid transparent;border-bottom:${Math.max(0,geometry.height-height)}px solid transparent;background-origin:content-box;background-clip:border-box;`;
  for (const property of backgrounds) background.style.setProperty(property, style.getPropertyValue(property));
  return {
    name: 'domshot-document',
    beforeClone({ options }) { if (options) options.__domshotDocumentRoots = viewportRoots; },
    beforeRender({ nodeMap }) {
      for (const [copy, original] of nodeMap ?? []) {
        if (!(copy instanceof HTMLElement)) continue;
        if (viewportRoots.includes(original as HTMLElement)) {
          const originalStyle = win.getComputedStyle(original as Element);
          // auto/scroll on the document is viewport scrolling, not a nested box.
          for (const axis of ['x', 'y']) {
            const value = originalStyle.getPropertyValue(`overflow-${axis}`);
            if (value === 'auto' || value === 'scroll') copy.style.setProperty(`overflow-${axis}`, 'visible', 'important');
          }
        }
        if (original === source) {
          // Resource embedding has finished; reuse embedded background URLs.
          if (copy.style.backgroundImage) background.style.backgroundImage = copy.style.backgroundImage;
          copy.style.setProperty('background', 'none', 'important');
        }
      }
    },
    afterRender(context) {
      if (!context.svgString) return;
      const svg = new DOMParser().parseFromString(context.svgString, 'image/svg+xml');
      const foreign = svg.documentElement.getElementsByTagName('foreignObject')[0];
      const container = Array.from(foreign.children).find(node => node.localName === 'div') as HTMLElement | undefined;
      if (!container) throw new Error('Missing document render container');
      container.style.position = 'relative';
      container.style.isolation = 'isolate';
      container.insertBefore(svg.importNode(background, true), container.firstChild);
      context.svgString = new XMLSerializer().serializeToString(svg.documentElement);
      context.dataURL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(context.svgString)}`;
    },
  };
}
