import type { SnapdomPlugin } from '@zumer/snapdom';
import { sendExtensionMessage } from './messaging';

export interface ImageResourceReport {
  failedCount: number;
  failedUrls: string[];
}

export function trackImageResources(): { plugin: SnapdomPlugin; report(): ImageResourceReport } {
  const marker = 'data-domshot-image-resource';
  let trackedImages = 0;
  let report: ImageResourceReport = { failedCount: 0, failedUrls: [] };
  const trackedUrls = new Map<string, string>();

  const plugin: SnapdomPlugin = {
    name: 'image-resource-tracker',
    async afterClone({ clone }) {
      if (!clone) return;
      const images = clone.matches('img[src]')
        ? [clone as HTMLImageElement]
        : Array.from(clone.querySelectorAll<HTMLImageElement>('img[src]'));
      trackedImages = images.length;
      images.forEach((image, index) => {
        const id = String(index);
        image.setAttribute(marker, id);
        const source = absoluteHttpUrl(image.getAttribute('src'), image.ownerDocument.baseURI);
        if (source) trackedUrls.set(id, source);
      });

      const urls = Array.from(new Set(trackedUrls.values()));
      if (!urls.length) return;
      try {
        const response = await sendExtensionMessage({ type: 'DOMSHOT_RESOLVE_IMAGES', urls });
        const resolved = new Map(response.resources
          .filter((resource) => resource.dataUrl)
          .map((resource) => [resource.url, resource.dataUrl!]));
        images.forEach((image) => {
          const source = trackedUrls.get(image.getAttribute(marker) || '');
          const dataUrl = source && resolved.get(source);
          if (dataUrl) image.setAttribute('src', dataUrl);
        });
      } catch { /* SnapDOM can still resolve resources that already permit CORS. */ }
    },
    beforeRender({ clone }) {
      if (!clone) return;
      const remainingImages = clone.matches(`img[${marker}]`)
        ? [clone as HTMLImageElement]
        : Array.from(clone.querySelectorAll<HTMLImageElement>(`img[${marker}]`));
      const embeddedIds = new Set(remainingImages
        .filter((image) => image.getAttribute('src')?.startsWith('data:'))
        .map((image) => image.getAttribute(marker)!));
      report = {
        failedCount: Math.max(0, trackedImages - embeddedIds.size),
        failedUrls: Array.from(new Set(Array.from(trackedUrls)
          .filter(([id]) => !embeddedIds.has(id))
          .map(([, url]) => url))),
      };
      remainingImages.forEach((image) => image.removeAttribute(marker));
    },
  };

  return { plugin, report: () => report };
}

function absoluteHttpUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
