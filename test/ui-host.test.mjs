import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { withChromePage } from './support/chrome-page.mjs';

const bundle = await readFile(new URL('../dist/content.js', import.meta.url), 'utf8');

test('replacing and disposing extension UI preserves same-name page elements and removes picker listeners', async () => {
  await withChromePage({ url: 'data:text/html,<div id="domshot-extension-root" data-domshot-ui="selector">Page content</div>' }, async (page) => {
    await page.evaluate(`
      globalThis.pageElement = document.body.firstElementChild;
      globalThis.ownedHosts = [];
      chrome.runtime = { onMessage: { addListener(listener) { globalThis.listener = listener; }, removeListener() {} } };
    `);
    await page.evaluate(bundle);
    for (let i = 0; i < 2; i++) {
      await page.evaluate(`listener({ type: 'DOMSHOT_SELECT', settings: {}, locale: 'en', theme: 'light', pageZoom: 1 }, {}, () => {})`);
      const state = await page.evaluate(`(() => {
        const hosts = [...document.documentElement.children].filter(el => el.shadowRoot?.querySelector('.outline'));
        const previousDetached = ownedHosts.every(el => !el.isConnected);
        ownedHosts.push(...hosts);
        return { count: hosts.length, previousDetached, pageConnected: pageElement.isConnected };
      })()`);
      assert.deepEqual(state, { count: 1, previousDetached: true, pageConnected: true });
    }
    await page.evaluate(`window.__domShotCleanup()`);
    // A stale picker key handler would recreate a cancellation toast after disposal.
    await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    assert.deepEqual(await page.evaluate(`({
      pageConnected: pageElement.isConnected,
      ownedDetached: ownedHosts.every(el => !el.isConnected),
      remainingUi: [...document.documentElement.children].some(el => el.shadowRoot)
    })`), { pageConnected: true, ownedDetached: true, remainingUi: false });
  });
});
