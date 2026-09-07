import type { SnapdomPlugin } from '@zumer/snapdom';
import { sendExtensionMessage } from './messaging';

export type ImageFailureReason = 'load' | 'decode' | 'timeout';

export interface ImageResourceReport {
  failures: Array<{ reason: ImageFailureReason; url?: string }>;
  failedCount: number;
  failedUrls: string[];
}

export function trackImageResources(): { plugin: SnapdomPlugin; report(): ImageResourceReport } {
  const marker = 'data-domshot-image-resource';
  let trackedImages = 0;
  let report: ImageResourceReport = { failedCount: 0, failedUrls: [], failures: [] };
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
    async beforeRender({ clone }) {
      if (!clone) return;
      const remainingImages = clone.matches(`img[${marker}]`)
        ? [clone as HTMLImageElement]
        : Array.from(clone.querySelectorAll<HTMLImageElement>(`img[${marker}]`));
      const outcomes = new Map<string, ImageFailureReason | null>();
      const decodes = new Map<string, Promise<ImageFailureReason | null>>();
      // Bound concurrent decoders and deduplicate repeated data URLs for this capture.
      for (let start = 0; start < remainingImages.length; start += 6) {
        await Promise.all(remainingImages.slice(start, start + 6).map(async (image) => {
          const id = image.getAttribute(marker)!;
          const source = image.getAttribute('src') || '';
          if (!source.startsWith('data:')) { outcomes.set(id, 'load'); return; }
          let pending = decodes.get(source);
          if (!pending) { pending = decodeImage(source); decodes.set(source, pending); }
          const reason = await pending;
          outcomes.set(id, reason);
          if (reason) image.src = imagePlaceholder(image.width || 100, image.height || 100);
        }));
      }
      const failures: ImageResourceReport['failures'] = [];
      for (let index = 0; index < trackedImages; index++) {
        const id = String(index);
        const reason = outcomes.has(id) ? outcomes.get(id)! : 'load';
        if (reason) failures.push({ reason, ...(trackedUrls.has(id) ? { url: trackedUrls.get(id)! } : {}) });
      }
      report = {
        failures,
        failedCount: failures.length,
        // Source permissions cannot repair invalid bytes or a decoding timeout.
        failedUrls: Array.from(new Set(failures.filter(failure => failure.reason === 'load' && failure.url).map(failure => failure.url!))),
      };
      remainingImages.forEach(image => image.removeAttribute(marker));
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

function decodeImage(source: string): Promise<ImageFailureReason | null> {
  return new Promise(resolve => {
    const image = new Image();
    const finish = (reason: ImageFailureReason | null) => {
      window.clearTimeout(timer);
      resolve(reason);
    };
    const timer = window.setTimeout(() => { finish('timeout'); image.src = ''; }, 3000);
    image.src = source;
    image.decode().then(() => finish(image.naturalWidth > 0 && image.naturalHeight > 0 ? null : 'decode'), () => finish('decode'));
  });
}

function imagePlaceholder(width: number, height: number): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ccc"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="12" fill="#666">img</text></svg>`)}`;
}
