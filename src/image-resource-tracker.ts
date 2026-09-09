import type { SnapdomPlugin } from '@zumer/snapdom';
import { sendExtensionMessage } from './messaging';
import type { ResolvedImageResource } from './types';

export type ImageFailureReason = 'load' | 'decode' | 'timeout' | NonNullable<ResolvedImageResource['reason']>;

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
  const resolutions = new Map<string, ResolvedImageResource>();
  const resolvedDataUrls = new Map<string, string>();
  const backgroundUsages: Array<{ target: HTMLElement; value: string; urls: string[] }> = [];

  const plugin: SnapdomPlugin = {
    name: 'image-resource-tracker',
    async afterClone({ clone, nodeMap }) {
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

      for (const [copy, original] of nodeMap ?? []) {
        if (!(copy instanceof HTMLElement) || !(original instanceof Element)) continue;
        trackBackgroundUsage(copy, getComputedStyle(original).backgroundImage, original.ownerDocument.baseURI, backgroundUsages);
        for (const pseudo of ['::before', '::after']) {
          const pseudoCopy = Array.from(copy.children).find(child => child instanceof HTMLElement && child.dataset.snapdomPseudo === pseudo);
          if (pseudoCopy instanceof HTMLElement) {
            trackBackgroundUsage(pseudoCopy, getComputedStyle(original, pseudo).backgroundImage, original.ownerDocument.baseURI, backgroundUsages);
          }
        }
      }

      const urls = Array.from(new Set([...trackedUrls.values(), ...backgroundUsages.flatMap(usage => usage.urls)]));
      if (!urls.length) return;
      try {
        const response = await sendExtensionMessage({ type: 'DOMSHOT_RESOLVE_IMAGES', urls });
        response.resources.forEach(resource => resolutions.set(resource.url, resource));
        response.resources
          .filter((resource) => resource.dataUrl)
          .forEach((resource) => resolvedDataUrls.set(resource.url, resource.dataUrl!));
        images.forEach((image) => {
          const source = trackedUrls.get(image.getAttribute(marker) || '');
          const dataUrl = source && resolvedDataUrls.get(source);
          if (dataUrl) image.setAttribute('src', dataUrl);
        });
      } catch { /* SnapDOM can still resolve resources that already permit CORS. */ }
    },
    async beforeRender({ clone }) {
      if (!clone) return;
      // SnapDOM performs its own resource pass after afterClone. Reapply proxy
      // successes at the final clone boundary so a failed engine fetch cannot
      // overwrite them.
      backgroundUsages.forEach(usage => mergeResolvedBackgroundLayers(usage, resolvedDataUrls));
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
          if (!source.startsWith('data:')) {
            const originalUrl = trackedUrls.get(id);
            outcomes.set(id, originalUrl ? resolutions.get(originalUrl)?.reason ?? 'load' : 'load');
            return;
          }
          let pending = decodes.get(source);
          if (!pending) { pending = decodeImage(source); decodes.set(source, pending); }
          const reason = await pending;
          outcomes.set(id, reason);
          if (reason) image.src = imagePlaceholder(
            Number(image.dataset.snapdomWidth) || image.width || 100,
            Number(image.dataset.snapdomHeight) || image.height || 100,
          );
        }));
      }
      const failures: ImageResourceReport['failures'] = [];
      for (let index = 0; index < trackedImages; index++) {
        const id = String(index);
        const originalUrl = trackedUrls.get(id);
        const reason = outcomes.has(id)
          ? outcomes.get(id)!
          : originalUrl ? resolutions.get(originalUrl)?.reason ?? 'load' : 'load';
        if (reason) failures.push({ reason, ...(trackedUrls.has(id) ? { url: trackedUrls.get(id)! } : {}) });
      }
      for (const url of new Set(backgroundUsages.flatMap(usage => usage.urls))) {
        const stillUnresolved = backgroundUsages.some(usage => usage.urls.includes(url)
          && !backgroundUrlResolved(usage, url));
        if (stillUnresolved) failures.push({ reason: resolutions.get(url)?.reason ?? 'load', url });
      }
      report = {
        failures,
        failedCount: failures.length,
        // Only a confirmed permission failure can be repaired through host access.
        failedUrls: Array.from(new Set(failures
          .filter(failure => failure.reason === 'permission' && failure.url)
          .map(failure => resolutions.get(failure.url!)?.permissionUrl ?? failure.url!))),
      };
      remainingImages.forEach(image => image.removeAttribute(marker));
    },
  };

  return { plugin, report: () => report };
}

function trackBackgroundUsage(
  target: HTMLElement,
  value: string,
  baseUrl: string,
  usages: Array<{ target: HTMLElement; value: string; urls: string[] }>,
) {
  if (!value || value === 'none') return;
  const urls = cssHttpUrls(value, baseUrl);
  if (!urls.length) return;
  // Pseudo-element backgrounds may already have been inlined before afterClone.
  const usage = { target, value, urls };
  if (urls.every(url => backgroundUrlResolved(usage, url))) return;
  usages.push(usage);
}

function cssHttpUrls(value: string, baseUrl: string): string[] {
  const urls: string[] = [];
  for (const match of value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)) {
    const url = absoluteHttpUrl(match[1] ?? match[2] ?? match[3]?.trim() ?? null, baseUrl);
    if (url) urls.push(url);
  }
  return urls;
}

function replaceResolvedCssUrls(value: string, baseUrl: string, resolved: Map<string, string>): string {
  return value.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi, (token, doubleQuoted, singleQuoted, bare) => {
    const url = absoluteHttpUrl(doubleQuoted ?? singleQuoted ?? bare?.trim() ?? null, baseUrl);
    const dataUrl = url ? resolved.get(url) : undefined;
    return dataUrl ? `url("${dataUrl}")` : token;
  });
}

function mergeResolvedBackgroundLayers(
  usage: { target: HTMLElement; value: string; urls: string[] },
  resolved: Map<string, string>,
) {
  const sourceLayers = splitCssLayers(usage.value);
  const finalLayers = splitCssLayers(usage.target.style.backgroundImage);
  while (finalLayers.length < sourceLayers.length) finalLayers.push('none');
  let changed = false;
  sourceLayers.forEach((sourceLayer, index) => {
    const replacement = replaceResolvedCssUrls(sourceLayer, usage.target.ownerDocument.baseURI, resolved);
    if (replacement === sourceLayer) return;
    finalLayers[index] = replacement;
    changed = true;
  });
  if (changed) usage.target.style.backgroundImage = finalLayers.join(', ');
}

function backgroundUrlResolved(usage: { target: HTMLElement; value: string; urls: string[] }, url: string): boolean {
  const sourceLayers = splitCssLayers(usage.value);
  const finalLayers = splitCssLayers(usage.target.style.backgroundImage);
  return sourceLayers.every((layer, index) => {
    const layerUrls = cssHttpUrls(layer, usage.target.ownerDocument.baseURI);
    if (!layerUrls.includes(url)) return true;
    const finalLayer = finalLayers[index] || '';
    return finalLayer.includes('data:') && !cssHttpUrls(finalLayer, usage.target.ownerDocument.baseURI).includes(url);
  });
}

function splitCssLayers(value: string): string[] {
  const layers: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index - 1] !== '\\') quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(') {
      depth++;
    } else if (character === ')') {
      depth = Math.max(0, depth - 1);
    } else if (character === ',' && depth === 0) {
      layers.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  layers.push(value.slice(start).trim());
  return layers;
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
