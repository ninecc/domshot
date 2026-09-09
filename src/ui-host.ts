import type { SnapdomPlugin } from '@zumer/snapdom';
import type { UiTheme } from './types';

// Only one in-page surface is active. IDs and data attributes are presentation
// hooks, never proof that a page element belongs to the extension.
let currentHost: { element: HTMLDivElement; cleanups: Array<() => void> } | null = null;

export function createHost(kind: string, theme: UiTheme): HTMLDivElement {
  removeExtensionUi();
  const element = document.createElement('div');
  element.id = 'domshot-extension-root';
  element.dataset.domshotUi = kind;
  element.dataset.domshotTheme = theme;
  element.attachShadow({ mode: 'open' });
  currentHost = { element, cleanups: [] };
  return element;
}

export function registerHostCleanup(host: Element, cleanup: () => void) {
  if (currentHost?.element === host) currentHost.cleanups.push(cleanup);
}

export function removeHost(host: Element) {
  if (currentHost?.element !== host) return;
  const owned = currentHost;
  currentHost = null;
  try {
    for (const cleanup of owned.cleanups) cleanup();
  } finally {
    owned.element.remove();
  }
}

export function removeExtensionUi() {
  if (currentHost) removeHost(currentHost.element);
}

export function isExtensionUi(element: Element): boolean {
  if (!currentHost) return false;
  if (currentHost.element === element || currentHost.element.contains(element)) return true;
  const root = element.getRootNode();
  return root instanceof ShadowRoot && root.host === currentHost.element;
}

export function showHostNotice(message: string) {
  const shadow = currentHost?.element.shadowRoot;
  if (!shadow) return;
  shadow.querySelector('[data-domshot-notice]')?.remove();
  const notice = document.createElement('div');
  notice.dataset.domshotNotice = '';
  notice.setAttribute('role', 'status');
  notice.textContent = message;
  notice.style.cssText = 'position:fixed;left:50%;bottom:18px;z-index:1;max-width:420px;padding:9px 12px;border-radius:9px;color:#fff;background:rgba(15,23,42,.92);box-shadow:0 8px 24px rgba(15,23,42,.24);font:600 11px/1.4 Inter,"PingFang SC","Microsoft YaHei",sans-serif;transform:translateX(-50%);pointer-events:none';
  shadow.appendChild(notice);
  window.setTimeout(() => notice.remove(), 2400);
}

export function extensionUiCapturePlugin(): SnapdomPlugin {
  // Keep the identity for this capture even if its live progress UI is replaced.
  const root = currentHost?.element;
  return {
    name: 'domshot-ui-exclusion',
    // Skip the original root and its entire subtree before cloning. Unlike the
    // global filterMode: 'remove', this does not trigger SnapDOM's shrink pass.
    resolveNode(node) { return node === root ? null : undefined; },
  };
}
