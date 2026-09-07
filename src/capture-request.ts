export type CaptureRequest =
  | { kind: 'element'; element: Element }
  | { kind: 'page' | 'viewport'; document: Document };

export function captureTarget(request: CaptureRequest): Element {
  return request.kind === 'element' ? request.element : request.document.documentElement;
}

// All geometry is in document CSS pixels; the renderer applies output scale once.
export function captureGeometry(request: CaptureRequest) {
  if (request.kind === 'element') return null;
  const doc = request.document;
  const win = doc.defaultView!;
  const root = doc.documentElement;
  const viewport = win.visualViewport;
  const width = Math.max(root.clientWidth, root.scrollWidth, doc.body?.scrollWidth ?? 0);
  const height = Math.max(root.clientHeight, root.scrollHeight, doc.body?.scrollHeight ?? 0);
  return {
    width, height,
    clip: request.kind === 'viewport' ? {
      x: viewport?.pageLeft ?? win.scrollX,
      y: viewport?.pageTop ?? win.scrollY,
      width: viewport?.width ?? win.innerWidth,
      height: viewport?.height ?? win.innerHeight,
    } : { x: 0, y: 0, width, height },
  };
}
