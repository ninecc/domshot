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
  return currentHost?.element === element || Boolean(currentHost?.element.contains(element));
}

