import type { ExtensionMessageOf, ExtensionMessageType, ExtensionResponse } from './types';

export async function sendExtensionMessage<T extends ExtensionMessageType>(message: ExtensionMessageOf<T>): Promise<ExtensionResponse<T>> {
  const response = await chrome.runtime.sendMessage(message) as ExtensionResponse<T> | { ok: false; error?: string } | undefined;
  if (!response) throw new Error('DOMShot background is unavailable');
  if ('error' in response && response.ok === false) throw new Error(response.error || 'DOMShot background request failed');
  return response as ExtensionResponse<T>;
}
