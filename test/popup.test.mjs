import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withChromePage } from './support/chrome-page.mjs';

const popupUrl = pathToFileURL(resolve(import.meta.dirname, '../dist/popup.html')).href;
const stableSelectors = ['.masthead', '.intro', '.actions', '.output-settings'];

test('popup preserves its layout and interaction styling when advanced settings open', async () => {
  await withChromePage({ url: popupUrl, viewport: { width: 360, height: 600 } }, async (page) => {
    const rootWidth = await page.evaluate('getComputedStyle(document.documentElement).width');
    assert.equal(rootWidth, '360px');

    const idleButton = await buttonColors(page);
    await page.hover('.settings-button');
    await page.waitUntil(
      `getComputedStyle(document.querySelector('.settings-button')).color === 'rgb(37, 99, 235)'`,
      'settings hover color transition did not reach the brand color',
    );
    const hoveredButton = await buttonColors(page);
    assert.notEqual(hoveredButton.color, idleButton.color, 'settings hover must change the icon color');
    assert.equal(hoveredButton.backgroundColor, 'rgba(0, 0, 0, 0)', 'settings hover must keep a transparent background');

    const stableBefore = await regionMetrics(page, stableSelectors);
    const metrics = await page.evaluate(`new Promise((resolve) => {
      document.querySelector('#settingsButton').click();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        advancedHidden: document.querySelector('#advancedSettings').hidden,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        advancedOptionCount: document.querySelectorAll('.advanced-options .toggle-row').length,
        embedFontsChecked: document.querySelector('#embedFonts').checked,
        reconcileChecked: document.querySelector('#reconcile').checked
      })));
    })`);
    const stableAfter = await regionMetrics(page, stableSelectors);
    const expandedButton = await buttonColors(page);

    assert.equal(metrics.advancedHidden, false);
    assert.equal(metrics.advancedOptionCount, 2);
    assert.equal(metrics.embedFontsChecked, true);
    assert.equal(metrics.reconcileChecked, false);
    assert.ok(metrics.scrollWidth <= 360, `expanded popup is ${metrics.scrollWidth}px wide`);
    assert.ok(metrics.scrollHeight <= 600, `expanded popup is ${metrics.scrollHeight}px tall and requires a scrollbar`);
    assert.deepEqual(stableAfter, stableBefore, 'opening advanced settings moved or resized existing content');
    assert.equal(expandedButton.backgroundColor, 'rgba(0, 0, 0, 0)', 'expanded settings button must keep a transparent background');
  });
});

function buttonColors(page) {
  return page.evaluate(`(() => {
    const style = getComputedStyle(document.querySelector('.settings-button'));
    return { color: style.color, backgroundColor: style.backgroundColor };
  })()`);
}

function regionMetrics(page, selectors) {
  return page.evaluate(`Object.fromEntries(${JSON.stringify(selectors)}.map((selector) => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return [selector, { top: rect.top, width: rect.width, height: rect.height }];
  }))`);
}
