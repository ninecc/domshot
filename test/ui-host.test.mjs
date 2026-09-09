import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { withChromePage } from './support/chrome-page.mjs';

const bundle = await readFile(new URL('../dist/content.js', import.meta.url), 'utf8');

test('picker re-entry is rejected until cancellation and disposal preserves same-name page elements', async () => {
  await withChromePage({ url: 'data:text/html,<div id="domshot-extension-root" data-domshot-ui="selector">Page content</div>' }, async (page) => {
    await page.evaluate(`
      globalThis.pageElement = document.body.firstElementChild;
      globalThis.ownedHosts = [];
      chrome.runtime = { onMessage: { addListener(listener) { globalThis.listener = listener; }, removeListener() {} } };
    `);
    await page.evaluate(bundle);
    await page.evaluate(`listener({ type: 'DOMSHOT_SELECT', settings: {}, locale: 'en', theme: 'light', pageZoom: 1 }, {}, () => {}); ownedHosts.push([...document.documentElement.children].find(el => el.shadowRoot?.querySelector('.outline')))`);
    const rejected = await page.evaluate(`(() => {
      let response;
      listener({ type: 'DOMSHOT_SELECT', settings: {}, locale: 'en', theme: 'light', pageZoom: 1 }, {}, value => { response = value; });
      const hosts = [...document.documentElement.children].filter(el => el.shadowRoot?.querySelector('.outline'));
      return { response, count: hosts.length, sameHost: hosts[0] === ownedHosts[0], busy: /already in progress/i.test(hosts[0].shadowRoot.textContent), pageConnected: pageElement.isConnected };
    })()`);
    assert.deepEqual(rejected, { response: { started: false }, count: 1, sameHost: true, busy: true, pageConnected: true });

    await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); listener({ type: 'DOMSHOT_SELECT', settings: {}, locale: 'en', theme: 'light', pageZoom: 1 }, {}, () => {})`);
    assert.deepEqual(await page.evaluate(`({ oldDetached: !ownedHosts[0].isConnected, replacementCount: [...document.documentElement.children].filter(el => el.shadowRoot?.querySelector('.outline')).length, pageConnected: pageElement.isConnected })`), { oldDetached: true, replacementCount: 1, pageConnected: true });
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
