import { snapdom } from '@zumer/snapdom';
import type { CaptureFormat, CaptureSettings, ExtensionMessage } from './types';
import { CONTENT_SCRIPT_PROTOCOL } from './types';

declare global {
  interface Window {
    __domShotLoaded?: boolean;
    __domShotProtocol?: number;
    __domShotCleanup?: () => void;
  }
}

if (window.__domShotProtocol !== CONTENT_SCRIPT_PROTOCOL) {
  try {
    window.__domShotCleanup?.();
  } catch { /* A listener from a reloaded extension context may already be invalid. */ }
  window.__domShotLoaded = true;
  window.__domShotProtocol = CONTENT_SCRIPT_PROTOCOL;
  window.__domShotCleanup = installMessageListener();
}

const ROOT_ID = 'domshot-extension-root';
const UI_FONT = 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif';
const hostCleanups = new WeakMap<Element, () => void>();
let currentSession: ViewfinderSession | null = null;
let currentPageZoom = 1;
let currentPreviewUpdate: (() => void) | null = null;

function installMessageListener() {
  const listener = (message: ExtensionMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
    if (message.type === 'DOMSHOT_PING') {
      sendResponse({ ready: true, protocol: CONTENT_SCRIPT_PROTOCOL });
      return;
    }

    if (message.type === 'DOMSHOT_ZOOM_CHANGED') {
      setPageZoom(message.pageZoom);
      sendResponse({ updated: true });
      return;
    }

    if (message.type === 'DOMSHOT_SELECT') {
      setPageZoom(message.pageZoom);
      currentSession?.destroy();
      currentSession = new ViewfinderSession(message.settings);
      currentSession.start();
      sendResponse({ started: true });
      return;
    }

    if (message.type === 'DOMSHOT_FULL_PAGE') {
      setPageZoom(message.pageZoom);
      currentSession?.destroy();
      currentSession = null;
      void captureElement(document.documentElement, message.settings, '完整页面');
      sendResponse({ started: true });
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

class ViewfinderSession {
  private host = document.createElement('div');
  private shadow: ShadowRoot;
  private outline: HTMLElement;
  private label: HTMLElement;
  private toolbar: HTMLElement;
  private hovered: Element | null = null;
  private active = false;

  constructor(private settings: CaptureSettings) {
    this.host.id = ROOT_ID;
    this.host.dataset.domshotUi = 'selector';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = selectorMarkup();
    this.outline = this.shadow.querySelector<HTMLElement>('.outline')!;
    this.label = this.shadow.querySelector<HTMLElement>('.element-label')!;
    this.toolbar = this.shadow.querySelector<HTMLElement>('.toolbar')!;
  }

  start() {
    removeExtensionUi();
    document.documentElement.appendChild(this.host);
    this.active = true;
    document.addEventListener('mousemove', this.onMove, true);
    document.addEventListener('click', this.onClick, true);
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('scroll', this.onViewportChange, true);
    window.addEventListener('resize', this.onViewportChange);
  }

  destroy() {
    if (!this.active) return;
    this.active = false;
    document.removeEventListener('mousemove', this.onMove, true);
    document.removeEventListener('click', this.onClick, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange);
    this.host.remove();
    if (currentSession === this) currentSession = null;
  }

  private onMove = (event: MouseEvent) => {
    const candidate = document.elementFromPoint(event.clientX, event.clientY);
    if (!candidate || candidate === this.host || candidate.closest(`#${ROOT_ID}`)) return;
    if (candidate === this.hovered) return;
    this.hovered = candidate;
    this.updateOutline();
  };

  private onViewportChange = () => this.updateOutline();

  private updateOutline() {
    if (!this.hovered || !this.hovered.isConnected) return;
    const rect = this.hovered.getBoundingClientRect();
    Object.assign(this.outline.style, {
      transform: `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`,
      width: `${Math.max(0, Math.round(rect.width))}px`,
      height: `${Math.max(0, Math.round(rect.height))}px`,
      display: rect.width && rect.height ? 'block' : 'none',
    });

    const name = this.hovered.tagName.toLowerCase();
    const id = this.hovered.id ? `#${this.hovered.id}` : '';
    const className = Array.from(this.hovered.classList).slice(0, 2).map((value) => `.${value}`).join('');
    this.label.textContent = `${name}${id}${className}  ${Math.round(rect.width)} × ${Math.round(rect.height)}`;

    const labelTop = rect.top > 38 ? rect.top - 30 : Math.min(window.innerHeight - 30, rect.bottom + 6);
    Object.assign(this.label.style, {
      transform: `translate(${Math.max(8, Math.min(rect.left, window.innerWidth - 300))}px, ${Math.max(6, labelTop)}px)`,
      display: 'block',
    });
  }

  private onClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = this.hovered;
    if (!target) return;
    const label = describeElement(target);
    this.toolbar.innerHTML = '<span class="spinner"></span><strong>正在生成图片</strong><small>正在嵌入样式与资源…</small>';
    this.outline.classList.add('capturing');
    window.setTimeout(async () => {
      this.destroy();
      await captureElement(target, this.settings, label);
    }, 120);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.destroy();
    showToast('已取消截图');
  };
}

async function captureElement(target: Element, settings: CaptureSettings, label: string) {
  const progress = showProgress(label);
  try {
    const result = await snapdom(target, {
      scale: settings.scale,
      dpr: 1,
      embedFonts: settings.embedFonts,
      exclude: [`#${ROOT_ID}`, '[data-domshot-ui]'],
      backgroundColor: settings.format === 'png' ? undefined : '#ffffff',
    });

    const image = await exportImage(result, settings.format);
    const blob = await imageToBlob(image, settings.format);
    progress.remove();
    showPreview({ image, blob, format: settings.format, label, scale: settings.scale });
  } catch (error) {
    progress.remove();
    showError(error instanceof Error ? error.message : '页面资源无法转换为图片');
  }
}

type SnapResult = Awaited<ReturnType<typeof snapdom>>;

async function exportImage(result: SnapResult, format: CaptureFormat): Promise<HTMLImageElement> {
  if (format === 'jpg') return result.toJpg();
  if (format === 'webp') return result.toWebp();
  return result.toPng();
}

async function imageToBlob(image: HTMLImageElement, format: CaptureFormat): Promise<Blob> {
  const response = await fetch(image.src);
  const original = await response.blob();
  const mime = format === 'jpg' ? 'image/jpeg' : `image/${format}`;
  if (original.type === mime) return original;

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片编码失败')), mime, .94));
}

function showPreview({ image, blob, format, label, scale }: {
  image: HTMLImageElement;
  blob: Blob;
  format: CaptureFormat;
  label: string;
  scale: number;
}) {
  removeExtensionUi();
  const host = createHost('preview');
  syncPreviewViewport(host);
  const shadow = host.shadowRoot!;
  const url = URL.createObjectURL(blob);
  const size = formatBytes(blob.size);
  const extension = format === 'jpg' ? 'jpg' : format;
  shadow.innerHTML = `
    ${sharedStyles()}
    <style>${previewStyles()}</style>
    <aside class="preview-card" role="dialog" aria-label="截图完成">
      <div class="preview-head">
        <div><span class="success-dot">✓</span><strong>截图完成</strong></div>
        <button class="icon-button close" type="button" aria-label="关闭">×</button>
      </div>
      <div class="image-stage"><img src="${url}" alt="${escapeHtml(label)} 的截图预览" /></div>
      <div class="meta">
        <span>${escapeHtml(label)}</span>
        <span>${image.naturalWidth} × ${image.naturalHeight} · ${scale}× · ${size}</span>
      </div>
      <div class="preview-actions">
        <button class="copy" type="button">复制图片</button>
        <button class="download" type="button">下载 ${extension.toUpperCase()}</button>
      </div>
      <p class="feedback" role="status"></p>
    </aside>`;

  const cleanup = () => {
    URL.revokeObjectURL(url);
    removeHost(host);
  };
  shadow.querySelector('.close')!.addEventListener('click', cleanup);
  shadow.querySelector('.download')!.addEventListener('click', () => {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `domshot-${safeFilename(label)}-${timestamp()}.${extension}`;
    anchor.click();
    feedback(shadow, '已开始下载');
  });
  shadow.querySelector('.copy')!.addEventListener('click', async () => {
    try {
      const png = format === 'png' ? blob : await toPngBlob(image);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      feedback(shadow, format === 'png' ? '图片已复制' : '已转为 PNG 并复制');
    } catch {
      feedback(shadow, '浏览器未允许访问剪贴板', true);
    }
  });
  document.documentElement.appendChild(host);
}

async function toPngBlob(image: HTMLImageElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG 转换失败')), 'image/png'));
}

function showProgress(label: string): HTMLElement {
  removeExtensionUi();
  const host = createHost('progress');
  host.shadowRoot!.innerHTML = `
    ${sharedStyles()}
    <style>${toastStyles()}</style>
    <div class="toast progress"><span class="spinner"></span><span><strong>正在生成图片</strong><small>${escapeHtml(label)} · 请勿切换页面</small></span></div>`;
  document.documentElement.appendChild(host);
  return host;
}

function showError(message: string) {
  const host = createHost('error');
  host.shadowRoot!.innerHTML = `
    ${sharedStyles()}
    <style>${toastStyles()}</style>
    <div class="toast error"><span class="error-mark">!</span><span><strong>截图失败</strong><small>${escapeHtml(message)}。请检查跨域图片或字体。</small></span><button type="button">关闭</button></div>`;
  host.shadowRoot!.querySelector('button')!.addEventListener('click', () => host.remove());
  document.documentElement.appendChild(host);
}

function showToast(message: string) {
  removeExtensionUi();
  const host = createHost('toast');
  host.shadowRoot!.innerHTML = `${sharedStyles()}<style>${toastStyles()}</style><div class="toast compact"><strong>${escapeHtml(message)}</strong></div>`;
  document.documentElement.appendChild(host);
  window.setTimeout(() => host.remove(), 1800);
}

function createHost(kind: string): HTMLDivElement {
  const host = document.createElement('div');
  host.id = ROOT_ID;
  host.dataset.domshotUi = kind;
  host.attachShadow({ mode: 'open' });
  return host;
}

function syncPreviewViewport(host: HTMLElement) {
  const viewport = window.visualViewport;
  const update = () => {
    const safePageZoom = currentPageZoom;
    const visualScale = viewport && Number.isFinite(viewport.scale) && viewport.scale > 0 ? viewport.scale : 1;
    host.style.setProperty('--domshot-ui-scale', String(1 / (safePageZoom * visualScale)));
    host.dataset.domshotPageZoom = String(safePageZoom);
    host.dataset.domshotVisualScale = String(visualScale);
    host.style.setProperty('--domshot-viewport-left', `${viewport?.pageLeft ?? window.scrollX}px`);
    host.style.setProperty('--domshot-viewport-top', `${viewport?.pageTop ?? window.scrollY}px`);
    host.style.setProperty('--domshot-viewport-width', `${viewport?.width ?? window.innerWidth}px`);
    host.style.setProperty('--domshot-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
  };

  update();
  currentPreviewUpdate = update;
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  hostCleanups.set(host, () => {
    viewport?.removeEventListener('resize', update);
    viewport?.removeEventListener('scroll', update);
    if (currentPreviewUpdate === update) currentPreviewUpdate = null;
  });
}

function setPageZoom(pageZoom: number) {
  currentPageZoom = Number.isFinite(pageZoom) && pageZoom > 0 ? pageZoom : 1;
  currentPreviewUpdate?.();
}

function removeHost(host: Element) {
  hostCleanups.get(host)?.();
  hostCleanups.delete(host);
  host.remove();
}

function removeExtensionUi() {
  document.querySelectorAll(`#${ROOT_ID}`).forEach(removeHost);
}

function describeElement(element: Element): string {
  const aria = element.getAttribute('aria-label');
  if (aria) return aria.slice(0, 48);
  const heading = element.querySelector('h1, h2, h3')?.textContent?.trim();
  if (heading) return heading.replace(/\s+/g, ' ').slice(0, 48);
  if (element.id) return `#${element.id}`;
  return element.tagName.toLowerCase();
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-').replace(/^-|-$/g, '').slice(0, 36) || 'capture';
}

function timestamp() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, '0')).join('');
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
}

function feedback(shadow: ShadowRoot, message: string, error = false) {
  const element = shadow.querySelector<HTMLElement>('.feedback')!;
  element.textContent = message;
  element.classList.toggle('is-error', error);
}

function sharedStyles() {
  return `<style>:host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:${UI_FONT};color:#0f172a}*{box-sizing:border-box}button{font:inherit}button:focus-visible{outline:3px solid rgba(37,99,235,.35);outline-offset:2px}</style>`;
}

function selectorMarkup() {
  return `
    ${sharedStyles()}
    <style>
      :host{cursor:crosshair}.outline{position:fixed;left:0;top:0;display:none;border:2px solid #2563eb;background:rgba(37,99,235,.1);box-shadow:0 0 0 1px rgba(255,255,255,.9),inset 0 0 0 1px rgba(139,92,246,.25);transition:width .06s,height .06s,transform .06s}.outline.capturing{animation:pulse .7s infinite alternate}.element-label{position:fixed;left:0;top:0;display:none;max-width:300px;padding:5px 8px;border-radius:6px;color:#fff;background:linear-gradient(135deg,#2563eb,#7c3aed);font:600 10px/1.3 ui-monospace,SFMono-Regular,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.toolbar{position:fixed;left:50%;top:18px;padding:11px 16px;border:1px solid rgba(255,255,255,.72);border-radius:13px;color:#0f172a;background:rgba(255,255,255,.96);box-shadow:0 12px 34px rgba(15,23,42,.18);transform:translateX(-50%);pointer-events:auto}.toolbar strong,.toolbar small{display:block}.toolbar strong{font-size:12px}.toolbar small{color:#64748b;font-size:9px;margin-top:2px}@keyframes pulse{to{background:rgba(139,92,246,.22)}}.spinner{float:left;width:17px;height:17px;margin:2px 10px 0 0;border:2px solid #dbe5f7;border-top-color:#2563eb;border-radius:50%;animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.outline{transition:none}.spinner{animation-duration:1.5s}}
    </style>
    <div class="outline"></div><div class="element-label"></div>
    <div class="toolbar"><strong>选择一个页面元素</strong><small>移动鼠标定位 · 单击完成捕获</small></div>`;
}

function previewStyles() {
  return `
    :host{position:absolute;inset:auto;left:var(--domshot-viewport-left,0);top:var(--domshot-viewport-top,0);display:flex;box-sizing:border-box;width:var(--domshot-viewport-width,100vw);height:var(--domshot-viewport-height,100vh);align-items:flex-end;justify-content:flex-end;padding:calc(18px * var(--domshot-ui-scale,1))}.preview-card{width:336px;flex:none;padding:12px;border:1px solid #dfe5ee;border-radius:18px;background:#f8fafc;box-shadow:0 18px 52px rgba(15,23,42,.24);transform:scale(var(--domshot-ui-scale,1));transform-origin:right bottom;pointer-events:auto}.preview-head{display:flex;align-items:center;justify-content:space-between;padding:2px 3px 10px;font-size:13px}.success-dot{display:inline-grid;place-items:center;width:21px;height:21px;margin-right:7px;border-radius:50%;color:#fff;background:#10b981;font-weight:900}.icon-button{width:26px;height:26px;border:0;border-radius:8px;color:#64748b;background:transparent;font-size:20px;cursor:pointer}.icon-button:hover{background:#eef2f7}.image-stage{display:flex;align-items:center;justify-content:center;height:196px;padding:10px;border:1px solid #dfe5ee;border-radius:12px;background:repeating-conic-gradient(#e8edf4 0 25%,#fff 0 50%) 50%/14px 14px;overflow:hidden}.image-stage img{display:block;max-width:100%;max-height:100%;border-radius:3px;box-shadow:0 5px 18px rgba(15,23,42,.16)}.meta{display:flex;justify-content:space-between;gap:8px;padding:10px 2px;color:#64748b;font:9px ui-monospace,SFMono-Regular,monospace}.meta span{max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.preview-actions{display:grid;grid-template-columns:1fr 1.2fr;gap:8px}.preview-actions button{min-height:38px;border:1px solid #d6deea;border-radius:10px;color:#0f172a;background:#fff;font-size:11px;font-weight:800;cursor:pointer}.preview-actions .download{border:0;color:#fff;background:linear-gradient(135deg,#2563eb,#8b5cf6)}.preview-actions button:hover{transform:translateY(-1px)}.feedback{height:0;margin:0;color:#10b981;font-size:9px;text-align:center;opacity:0;transition:.15s}.feedback:not(:empty){height:21px;padding-top:8px;opacity:1}.feedback.is-error{color:#ef4444}@media(prefers-reduced-motion:reduce){.preview-actions button,.feedback{transition:none}}`;
}

function toastStyles() {
  return `
    :host{display:flex;align-items:flex-start;justify-content:center;padding-top:18px}.toast{display:flex;align-items:center;gap:11px;min-width:270px;padding:12px 15px;border:1px solid #dfe5ee;border-radius:13px;color:#0f172a;background:rgba(255,255,255,.97);box-shadow:0 12px 34px rgba(15,23,42,.2);pointer-events:auto}.toast strong,.toast small{display:block}.toast strong{font-size:12px}.toast small{max-width:340px;margin-top:3px;color:#64748b;font-size:9px}.spinner{width:18px;height:18px;border:2px solid #dbe5f7;border-top-color:#2563eb;border-radius:50%;animation:spin .7s linear infinite}.error-mark{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;color:#fff;background:#ef4444;font-weight:900}.toast button{margin-left:auto;border:0;color:#2563eb;background:none;font-size:10px;cursor:pointer}.compact{min-width:auto}.error{border-color:#fecaca;background:#fff7f7}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinner{animation-duration:1.5s}}`;
}
