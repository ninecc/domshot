import type { ExtensionMessage } from './types';

chrome.tabs.onZoomChange.addListener(({ tabId, newZoomFactor }) => {
  const message = { type: 'DOMSHOT_ZOOM_CHANGED', pageZoom: newZoomFactor } satisfies ExtensionMessage;
  void chrome.tabs.sendMessage(tabId, message).catch(() => {
    // Most tabs do not have DOMShot injected; they do not need zoom updates.
  });
});
