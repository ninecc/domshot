import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withChromePage } from './support/chrome-page.mjs';

const popupUrl = pathToFileURL(resolve(import.meta.dirname, '../dist/popup.html')).href;
test('popup opens a dedicated settings panel and returns to the capture panel', async () => {
  await withChromePage({
    url: popupUrl,
    viewport: { width: 360, height: 600 },
    initScript: `
      globalThis.__syncStore = {};
      globalThis.__themeMedia = {
        matches: false,
        listeners: [],
        addEventListener(_type, listener) { this.listeners.push(listener); },
        removeEventListener() {}
      };
      Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => globalThis.__themeMedia });
      Object.defineProperty(chrome, 'i18n', { configurable: true, value: { getUILanguage: () => 'fr-FR' } });
      globalThis.__historyStore = [{
        id: 'capture-1', createdAt: 1788192000000, label: 'Pricing card', filename: 'domshot-pricing.png', format: 'png',
        width: 1200, height: 800, scale: 2, size: 245760, sourceHost: 'example.com',
        thumbnailDataUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/%3E',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo='
      }];
      Object.defineProperty(chrome, 'runtime', { configurable: true, value: {
        async sendMessage(message) {
          if (message.type === 'DOMSHOT_BACKGROUND_PING') return { protocol: 1 };
          if (message.type === 'DOMSHOT_HISTORY_LIST') return { captures: globalThis.__historyStore.map(({ dataUrl, ...capture }) => capture) };
          if (message.type === 'DOMSHOT_HISTORY_GET') return { capture: globalThis.__historyStore.find((capture) => capture.id === message.id) ?? null };
          if (message.type === 'DOMSHOT_HISTORY_DELETE') { globalThis.__historyStore = globalThis.__historyStore.filter((capture) => capture.id !== message.id); return { ok: true }; }
          if (message.type === 'DOMSHOT_HISTORY_CLEAR') { globalThis.__historyStore = []; return { ok: true }; }
        }
      } });
      HTMLAnchorElement.prototype.click = function () { globalThis.__historyDownload = this.download; };
      Object.defineProperty(chrome, 'storage', { configurable: true, value: { sync: {
        async get(key) { return typeof key === 'string' ? { [key]: globalThis.__syncStore[key] } : { ...globalThis.__syncStore }; },
        async set(values) { Object.assign(globalThis.__syncStore, values); }
      } } });
    `,
  }, async (page) => {
    const rootWidth = await page.evaluate('getComputedStyle(document.documentElement).width');
    assert.equal(rootWidth, '360px');

    const initial = await page.evaluate(`({
      lang: document.documentElement.lang,
      theme: document.documentElement.dataset.theme,
      homeHidden: document.querySelector('#homePanel').hidden,
      settingsHidden: document.querySelector('#settingsPanel').hidden,
      outputSettingsInHome: Boolean(document.querySelector('#homePanel .output-settings')),
      footerInsidePanel: Boolean(document.querySelector('.panel .popup-footer')),
      introTitle: document.querySelector('#intro-title').textContent,
      introEyebrow: Boolean(document.querySelector('.intro p')),
      actionLabels: [...document.querySelectorAll('.capture-action strong')].map((label) => label.textContent),
      actionIcons: [...document.querySelectorAll('.action-symbol')].map((icon) => {
        const rect = icon.getBoundingClientRect();
        return { width: rect.width, height: rect.height, color: getComputedStyle(icon).color };
      }),
      clarityLabel: document.querySelector('.scale-segment').parentElement.firstElementChild.textContent,
      pixelHint: document.querySelector('#pixelHint').textContent,
      qualityHidden: document.querySelector('#qualityRow').hidden,
      qualityDisplay: getComputedStyle(document.querySelector('#qualityRow')).display,
      filenameHint: document.querySelector('#filenameHint').textContent,
      settingsTitle: document.querySelector('#settings-title').textContent,
      generalTitle: document.querySelector('#general-title').textContent
    })`);
    assert.equal(initial.lang, 'en');
    assert.equal(initial.theme, 'light');

    const followedSystemTheme = await page.evaluate(`(() => {
      globalThis.__themeMedia.matches = true;
      globalThis.__themeMedia.listeners.forEach((listener) => listener({ matches: true }));
      const dark = document.documentElement.dataset.theme;
      globalThis.__themeMedia.matches = false;
      globalThis.__themeMedia.listeners.forEach((listener) => listener({ matches: false }));
      return { dark, light: document.documentElement.dataset.theme };
    })()`);
    assert.deepEqual(followedSystemTheme, { dark: 'dark', light: 'light' });
    assert.equal(initial.homeHidden, false);
    assert.equal(initial.settingsHidden, true);
    assert.equal(initial.outputSettingsInHome, true, 'frequently used output settings must remain on the capture panel');
    assert.equal(initial.footerInsidePanel, false, 'footer must be shared by both panels');
    assert.ok(initial.introTitle.length > 0);
    assert.equal(initial.introEyebrow, false, 'homepage should not include a decorative technical eyebrow');
    assert.equal(initial.actionLabels.length, 3);
    assert.ok(initial.actionLabels.every(Boolean));
    assert.equal(initial.actionIcons.length, 3);
    assert.ok(initial.actionIcons.every(({ width, height }) => Math.abs(width - 38) < 0.5 && Math.abs(height - 38) < 0.5));
    assert.equal(new Set(initial.actionIcons.map(({ color }) => color)).size, 3, 'capture actions should have distinct semantic icon colors');
    assert.ok(initial.clarityLabel.length > 0);
    assert.match(initial.pixelHint, /2×/);
    assert.equal(initial.qualityHidden, true);
    assert.equal(initial.qualityDisplay, 'none');
    assert.ok(initial.filenameHint.length > 0);

    const lossyQuality = await page.evaluate(`(() => {
      document.querySelector('input[name="format"][value="jpg"]').click();
      document.querySelector('input[name="quality"][value="0.8"]').click();
      const result = {
        visible: getComputedStyle(document.querySelector('#qualityRow')).display !== 'none',
        quality: globalThis.__syncStore.captureSettings?.quality,
        labels: [...document.querySelectorAll('.quality-segment strong')].map((item) => item.textContent),
        percentages: [...document.querySelectorAll('.quality-segment small')].map((item) => item.textContent),
        stacked: [...document.querySelectorAll('.quality-segment span')].every((item) => item.querySelector(':scope > strong') && item.querySelector(':scope > small')),
        accessibleLabels: [...document.querySelectorAll('input[name="quality"]')].map((item) => item.getAttribute('aria-label'))
      };
      document.querySelector('input[name="format"][value="png"]').click();
      return result;
    })()`);
    assert.equal(lossyQuality.visible, true);
    assert.equal(lossyQuality.quality, 0.8);
    assert.ok(lossyQuality.labels.every((label) => !label.includes('%')), 'visible quality choices should use semantic labels');
    assert.deepEqual(lossyQuality.percentages, ['80%', '92%', '100%']);
    assert.equal(lossyQuality.stacked, true);
    assert.deepEqual(lossyQuality.accessibleLabels.map((label) => label.match(/\d+%/)?.[0]), ['80%', '92%', '100%']);
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('#qualityRow')).display`), 'none');

    await page.waitUntil(
      `getComputedStyle(document.querySelector('#homePanel')).transform === 'none'`,
      'home panel entrance animation did not finish',
    );
    const primaryIdle = await page.evaluate(`(() => {
      const button = document.querySelector('.primary-action');
      const style = getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      return { backgroundImage: style.backgroundImage, backgroundColor: style.backgroundColor, rect: { left: rect.left, top: rect.top } };
    })()`);
    assert.equal(primaryIdle.backgroundImage, 'none', 'primary action must not use a decorative gradient');
    await page.hover('.primary-action');
    await page.waitUntil(
      `getComputedStyle(document.querySelector('.primary-action')).backgroundColor !== ${JSON.stringify(primaryIdle.backgroundColor)}`,
      'primary action hover did not change its surface color',
    );
    const primaryHovered = await page.evaluate(`(() => {
      const button = document.querySelector('.primary-action');
      const rect = button.getBoundingClientRect();
      return { transform: getComputedStyle(button).transform, rect: { left: rect.left, top: rect.top } };
    })()`);
    assert.equal(primaryHovered.transform, 'none', 'capture actions must not move on hover');
    assert.deepEqual(primaryHovered.rect, primaryIdle.rect, 'capture action position must remain stable on hover');

    const idleButton = await buttonMetrics(page, '.settings-button');
    await page.hover('.settings-button');
    await page.waitUntil(
      `getComputedStyle(document.querySelector('.settings-button')).color !== ${JSON.stringify(idleButton.color)}`,
      'settings hover did not change the icon color',
    );
    const hoveredButton = await buttonMetrics(page, '.settings-button');
    assert.notEqual(hoveredButton.color, idleButton.color, 'settings hover must change the icon color');
    assert.equal(hoveredButton.backgroundColor, 'rgba(0, 0, 0, 0)', 'settings hover must keep a transparent background');

    const metrics = await page.evaluate(`new Promise((resolve) => {
      document.querySelector('#settingsButton').click();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        homeHidden: document.querySelector('#homePanel').hidden,
        settingsHidden: document.querySelector('#settingsPanel').hidden,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        implicitLineHeights: ['#general-title', '#advanced-title', '.autosave-status', '.language-segment span', '.toggle-row strong', '.status', '.attribution']
          .map((selector) => ({ selector, lineHeight: getComputedStyle(document.querySelector(selector)).lineHeight })),
        localeLayout: (() => {
          const stable = (value) => Math.round(value * 100) / 100;
          const height = (selector) => stable(document.querySelector(selector).getBoundingClientRect().height);
          return {
            shellHeight: height('.shell'),
            panelHeight: height('#settingsPanel'),
            generalHeight: height('.general-settings'),
            advancedHeight: height('.advanced-settings'),
            footerHeight: height('.popup-footer'),
            statusHeight: height('.status'),
            attributionHeight: height('.attribution'),
            languageWidth: stable(document.querySelector('.language-segment').getBoundingClientRect().width),
            descriptionHeights: [...document.querySelectorAll('.advanced-options small')].map((item) => stable(item.getBoundingClientRect().height)),
            footerTop: stable(document.querySelector('.popup-footer').getBoundingClientRect().top)
          };
        })(),
        settingsSubtitle: Boolean(document.querySelector('.settings-header p')),
        settingsTitleVisible: document.querySelector('#settings-title').getClientRects().length > 0,
        backButtonVisible: document.querySelector('#backButton').getClientRects().length > 0,
        autosaveVisible: document.querySelector('.autosave-status').getClientRects().length > 0,
        settingsContentScrollable: document.querySelector('.settings-content').scrollHeight > document.querySelector('.settings-content').clientHeight,
        languageOptionCount: document.querySelectorAll('input[name="language"]').length,
        themeOptionCount: document.querySelectorAll('input[name="theme"]').length,
        themeDefault: document.querySelector('input[name="theme"]:checked').value,
        afterCaptureOptionCount: document.querySelectorAll('input[name="afterCapture"]').length,
        afterCaptureDefault: document.querySelector('input[name="afterCapture"]:checked').value,
        filenameOptionCount: document.querySelectorAll('input[name="filenameMode"]').length,
        filenameDefault: document.querySelector('input[name="filenameMode"]:checked').value,
        filenameChoicesFit: [...document.querySelectorAll('.filename-segment span')].every((item) => item.scrollWidth <= item.clientWidth),
        delayOptionCount: document.querySelectorAll('input[name="captureDelay"]').length,
        delayDefault: document.querySelector('input[name="captureDelay"]:checked').value,
        footerVisible: getComputedStyle(document.querySelector('.popup-footer')).display !== 'none',
        outputSurface: (() => {
          const style = getComputedStyle(document.querySelector('.output-settings'));
          return { backgroundImage: style.backgroundImage, backgroundColor: style.backgroundColor };
        })(),
        advancedSurface: (() => {
          const style = getComputedStyle(document.querySelector('.advanced-settings'));
          return { backgroundImage: style.backgroundImage, backgroundColor: style.backgroundColor };
        })(),
        activeToggleGradient: getComputedStyle(document.querySelector('#embedFonts + i'), '::before').backgroundImage,
        outputSettingsInPanel: Boolean(document.querySelector('#settingsPanel .output-settings')),
        advancedOptionCount: document.querySelectorAll('.advanced-options .toggle-row').length,
        advancedOptionRects: [...document.querySelectorAll('.advanced-options .toggle-row')].map((row) => {
          const rect = row.getBoundingClientRect();
          return { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width };
        }),
        embedFontsChecked: document.querySelector('#embedFonts').checked,
        reconcileChecked: document.querySelector('#reconcile').checked,
        outerShadowsChecked: document.querySelector('#outerShadows').checked,
        compressImagesChecked: document.querySelector('#compressImages').checked,
        saveRecentCapturesChecked: document.querySelector('#saveRecentCaptures').checked,
        focusedElement: document.activeElement.id
      })));
    })`);

    assert.equal(metrics.homeHidden, true);
    assert.equal(metrics.settingsHidden, false);
    assert.equal(metrics.settingsSubtitle, false);
    assert.equal(metrics.settingsTitleVisible, true);
    assert.equal(metrics.backButtonVisible, true);
    assert.equal(metrics.autosaveVisible, true);
    assert.equal(metrics.settingsContentScrollable, true);
    assert.ok(Math.max(...metrics.localeLayout.descriptionHeights) - Math.min(...metrics.localeLayout.descriptionHeights) < 0.5, 'setting descriptions must reserve comparable text region heights');
    assert.equal(metrics.languageOptionCount, 3);
    assert.equal(metrics.themeOptionCount, 3);
    assert.equal(metrics.themeDefault, 'auto');
    assert.equal(metrics.afterCaptureOptionCount, 3);
    assert.equal(metrics.afterCaptureDefault, 'preview');
    assert.equal(metrics.filenameOptionCount, 3);
    assert.equal(metrics.filenameDefault, 'smart');
    assert.equal(metrics.filenameChoicesFit, true);
    assert.equal(metrics.delayOptionCount, 4);
    assert.equal(metrics.delayDefault, '0');
    assert.deepEqual(metrics.implicitLineHeights.filter(({ lineHeight }) => lineHeight === 'normal'), [], 'localized text must not rely on font-dependent normal line height');
    assert.equal(metrics.footerVisible, true, 'shared footer must remain visible on the settings panel');
    assert.equal(metrics.advancedSurface.backgroundImage, 'none', 'settings containers must not use decorative gradients');
    assert.equal(metrics.advancedSurface.backgroundColor, metrics.outputSurface.backgroundColor, 'settings containers should share one surface color');
    assert.notEqual(metrics.activeToggleGradient, 'none', 'active controls should retain the brand gradient');
    assert.equal(metrics.outputSettingsInPanel, false, 'the settings panel should only contain low-frequency options');
    assert.equal(metrics.advancedOptionCount, 4);
    assert.ok(Math.abs(metrics.advancedOptionRects[0].left - metrics.advancedOptionRects[1].left) < 0.5);
    assert.ok(Math.abs(metrics.advancedOptionRects[0].width - metrics.advancedOptionRects[1].width) < 0.5);
    metrics.advancedOptionRects.slice(1).forEach((rect, index) => {
      assert.ok(rect.top >= metrics.advancedOptionRects[index].bottom, 'advanced options must each occupy their own row');
    });
    assert.equal(metrics.embedFontsChecked, true);
    assert.equal(metrics.reconcileChecked, false);
    assert.equal(metrics.outerShadowsChecked, false);
    assert.equal(metrics.compressImagesChecked, true);
    assert.equal(metrics.saveRecentCapturesChecked, false);
    assert.equal(metrics.focusedElement, 'backButton');
    assert.ok(metrics.scrollWidth <= 360, `expanded popup is ${metrics.scrollWidth}px wide`);
    assert.ok(metrics.scrollHeight <= 600, `expanded popup is ${metrics.scrollHeight}px tall and requires a scrollbar`);
    assert.ok(metrics.localeLayout.shellHeight <= 600, `settings content is ${metrics.localeLayout.shellHeight}px tall`);

    await page.waitUntil(
      `getComputedStyle(document.querySelector('#settingsPanel')).transform === 'none'`,
      'settings panel entrance animation did not finish',
    );
    const backIdle = await buttonMetrics(page, '#backButton');
    assert.deepEqual(
      { width: backIdle.rect.width, height: backIdle.rect.height },
      { width: idleButton.rect.width, height: idleButton.rect.height },
      'settings and back buttons must share the same dimensions',
    );
    await page.hover('#backButton');
    await page.waitUntil(
      `getComputedStyle(document.querySelector('#backButton')).color !== ${JSON.stringify(backIdle.color)}`,
      'back hover did not change the icon color',
    );
    const backHovered = await buttonMetrics(page, '#backButton');
    assert.notEqual(backHovered.color, backIdle.color);
    assert.equal(backHovered.backgroundColor, 'rgba(0, 0, 0, 0)');
    assert.equal(backHovered.transform, 'none');
    assert.deepEqual(backHovered.rect, backIdle.rect, 'back button must not move on hover');

    const fixedChrome = await page.evaluate(`(() => {
      const content = document.querySelector('.settings-content');
      const header = document.querySelector('.settings-header');
      const footer = document.querySelector('.popup-footer');
      const before = { headerTop: header.getBoundingClientRect().top, footerTop: footer.getBoundingClientRect().top };
      content.scrollTop = content.scrollHeight;
      const after = { headerTop: header.getBoundingClientRect().top, footerTop: footer.getBoundingClientRect().top };
      return { before, after, scrollTop: content.scrollTop };
    })()`);
    assert.ok(fixedChrome.scrollTop > 0);
    assertLayoutsClose(fixedChrome.after, fixedChrome.before);

    const darkTheme = await page.evaluate(`(() => {
      const light = {
        canvas: getComputedStyle(document.body).backgroundColor,
        card: getComputedStyle(document.querySelector('.settings-group')).backgroundColor,
        control: getComputedStyle(document.querySelector('.theme-segment')).backgroundColor
      };
      document.querySelector('input[name="theme"][value="dark"]').click();
      const dark = {
        canvas: getComputedStyle(document.body).backgroundColor,
        card: getComputedStyle(document.querySelector('.settings-group')).backgroundColor,
        control: getComputedStyle(document.querySelector('.theme-segment')).backgroundColor
      };
      return {
        theme: document.documentElement.dataset.theme,
        storedTheme: globalThis.__syncStore.uiTheme,
        light,
        dark,
        layout: {
          shellHeight: document.querySelector('.shell').getBoundingClientRect().height,
          panelHeight: document.querySelector('#settingsPanel').getBoundingClientRect().height,
          footerTop: document.querySelector('.popup-footer').getBoundingClientRect().top
        }
      };
    })()`);
    assert.equal(darkTheme.theme, 'dark');
    assert.equal(darkTheme.storedTheme, 'dark');
    assert.notDeepEqual(darkTheme.dark, darkTheme.light);
    assertLayoutsClose(darkTheme.layout, {
      shellHeight: metrics.localeLayout.shellHeight,
      panelHeight: metrics.localeLayout.panelHeight,
      footerTop: metrics.localeLayout.footerTop,
    });

    const chinese = await page.evaluate(`(() => {
      document.querySelector('input[name="language"][value="zh-CN"]').click();
      return {
        lang: document.documentElement.lang,
        settingsTitle: document.querySelector('#settings-title').textContent,
        generalTitle: document.querySelector('#general-title').textContent,
        advancedTitle: document.querySelector('#advanced-title').textContent,
        footer: document.querySelector('.status-copy').textContent,
        autoLabel: document.querySelector('input[name="language"][value="auto"] + span').textContent,
        layout: (() => {
          const stable = (value) => Math.round(value * 100) / 100;
          const height = (selector) => stable(document.querySelector(selector).getBoundingClientRect().height);
          return {
            shellHeight: height('.shell'),
            panelHeight: height('#settingsPanel'),
            generalHeight: height('.general-settings'),
            advancedHeight: height('.advanced-settings'),
            footerHeight: height('.popup-footer'),
            statusHeight: height('.status'),
            attributionHeight: height('.attribution'),
            languageWidth: stable(document.querySelector('.language-segment').getBoundingClientRect().width),
            descriptionHeights: [...document.querySelectorAll('.advanced-options small')].map((item) => stable(item.getBoundingClientRect().height)),
            footerTop: stable(document.querySelector('.popup-footer').getBoundingClientRect().top)
          };
        })(),
        storedLanguage: globalThis.__syncStore.uiLanguage
      };
    })()`);
    assert.equal(chinese.lang, 'zh-CN');
    assert.equal(chinese.storedLanguage, 'zh-CN');
    assert.ok([chinese.settingsTitle, chinese.generalTitle, chinese.advancedTitle, chinese.footer, chinese.autoLabel].every(Boolean));
    assert.notEqual(chinese.settingsTitle, initial.settingsTitle);
    assert.notEqual(chinese.generalTitle, initial.generalTitle);
    assertLayoutsClose(chinese.layout, metrics.localeLayout);

    const savedPostAction = await page.evaluate(`(() => {
      document.querySelector('input[name="afterCapture"][value="copy"]').click();
      return globalThis.__syncStore.captureSettings?.afterCapture;
    })()`);
    assert.equal(savedPostAction, 'copy');
    const capturesBeforePreferenceChange = await page.evaluate(`globalThis.__historyStore.length`);
    await page.evaluate(`document.querySelector('#saveRecentCaptures').click()`);
    await page.waitUntil(`globalThis.__syncStore.captureSettings?.saveRecentCaptures === true`, 'recent capture preference was not enabled');
    await page.evaluate(`document.querySelector('#saveRecentCaptures').click()`);
    await page.waitUntil(`document.querySelector('#historyDisableDialog').open`, 'existing captures did not trigger the delete choice');
    const historyPreference = await page.evaluate(`({
      enabled: true,
      disabled: globalThis.__syncStore.captureSettings?.saveRecentCaptures,
      existingCaptures: globalThis.__historyStore.length,
      dialogTitle: document.querySelector('#history-disable-title').textContent,
      dialogBody: document.querySelector('#history-disable-body').textContent,
      actions: [...document.querySelectorAll('.history-disable-actions button')].map((button) => button.textContent)
    })`);
    assert.equal(historyPreference.enabled, true);
    assert.equal(historyPreference.disabled, false);
    assert.equal(historyPreference.existingCaptures, capturesBeforePreferenceChange, 'turning off recent captures must not delete existing items before the user chooses');
    assert.equal(historyPreference.dialogTitle, '停止自动加入新截图？');
    assert.match(historyPreference.dialogBody, /是否同时删除/);
    assert.deepEqual(historyPreference.actions, ['保留已有截图', '删除已有截图']);
    const deleteChoiceIdle = await buttonMetrics(page, '#deleteSavedCaptures');
    await page.hover('#deleteSavedCaptures');
    await page.waitUntil(`getComputedStyle(document.querySelector('#deleteSavedCaptures')).backgroundColor !== ${JSON.stringify(deleteChoiceIdle.backgroundColor)}`, 'delete history choice did not react on hover');
    const deleteChoiceHovered = await buttonMetrics(page, '#deleteSavedCaptures');
    assert.notEqual(deleteChoiceHovered.backgroundColor, deleteChoiceIdle.backgroundColor);
    assert.notEqual(deleteChoiceHovered.color, deleteChoiceIdle.color);
    assert.deepEqual(deleteChoiceHovered.rect, deleteChoiceIdle.rect, 'delete history choice must not move on hover');
    await page.evaluate(`document.querySelector('#keepExistingCaptures').click()`);
    await page.waitUntil(`!document.querySelector('#historyDisableDialog').open`, 'history choice did not close');
    assert.equal(await page.evaluate(`globalThis.__historyStore.length`), capturesBeforePreferenceChange);
    assert.match(await page.evaluate(`document.querySelector('#status').textContent`), /已有截图保持不变/);
    const savedAdvancedSettings = await page.evaluate(`(() => {
      document.querySelector('#outerShadows').click();
      document.querySelector('#compressImages').click();
      document.querySelector('input[name="filenameMode"][value="timestamp"]').click();
      document.querySelector('input[name="captureDelay"][value="500"]').click();
      return {
        outerShadows: globalThis.__syncStore.captureSettings?.outerShadows,
        compress: globalThis.__syncStore.captureSettings?.compress,
        filenameMode: globalThis.__syncStore.captureSettings?.filenameMode,
        captureDelay: globalThis.__syncStore.captureSettings?.captureDelay,
        filenameHint: document.querySelector('#filenameHint').textContent
      };
    })()`);
    const { filenameHint: savedFilenameHint, ...savedPreferences } = savedAdvancedSettings;
    assert.deepEqual(savedPreferences, { outerShadows: true, compress: false, filenameMode: 'timestamp', captureDelay: 500 });
    assert.ok(savedFilenameHint.length > 0);
    assert.notEqual(savedFilenameHint, initial.filenameHint);

    const toggleCloseStart = await page.evaluate(`(() => {
      const input = document.querySelector('#embedFonts');
      const track = input.nextElementSibling;
      input.click();
      const style = getComputedStyle(track);
      return { backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage };
    })()`);
    assert.notEqual(toggleCloseStart.backgroundColor, 'rgba(0, 0, 0, 0)', 'toggle track must keep a visible neutral surface while the active gradient fades out');

    const returned = await page.evaluate(`new Promise((resolve) => {
      document.querySelector('#backButton').click();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        homeHidden: document.querySelector('#homePanel').hidden,
        settingsHidden: document.querySelector('#settingsPanel').hidden,
        focusedElement: document.activeElement.id
      })));
    })`);
    assert.equal(returned.homeHidden, false);
    assert.equal(returned.settingsHidden, true);
    assert.equal(returned.focusedElement, 'settingsButton');

    const historyIconIdle = await page.evaluate(`getComputedStyle(document.querySelector('#historyButton svg')).transform`);
    await page.hover('#historyButton');
    await page.waitUntil(`getComputedStyle(document.querySelector('#historyButton svg')).transform !== ${JSON.stringify(historyIconIdle)}`, 'history icon did not rotate on hover');
    assert.notEqual(await page.evaluate(`getComputedStyle(document.querySelector('#historyButton svg')).transform`), historyIconIdle);

    await page.evaluate(`document.querySelector('#historyButton').click()`);
    await page.waitUntil(`document.querySelectorAll('.history-card').length === 1`, 'recent capture did not render');
    await page.nextFrames(2);
    const history = await page.evaluate(`({
      homeHidden: document.querySelector('#homePanel').hidden,
      historyHidden: document.querySelector('#historyPanel').hidden,
      count: document.querySelector('#historyCount').textContent,
      badge: document.querySelector('#historyBadge').textContent,
      title: document.querySelector('.history-card strong').textContent,
      source: document.querySelector('.history-card small').textContent,
      format: document.querySelector('.history-format').textContent,
      previewCue: document.querySelector('.history-preview-cue').textContent,
      deleteUsesIcon: Boolean(document.querySelector('.history-delete svg')) && document.querySelector('.history-delete').textContent.trim() === '',
      deleteSize: (() => { const rect = document.querySelector('.history-delete').getBoundingClientRect(); return { width: rect.width, height: rect.height }; })(),
      deleteTopOffset: (() => {
        const card = document.querySelector('.history-card').getBoundingClientRect();
        const button = document.querySelector('.history-delete').getBoundingClientRect();
        return button.top - card.top;
      })(),
      deleteTopInset: getComputedStyle(document.querySelector('.history-delete')).top,
      titleRightClearance: (() => {
        const title = document.querySelector('.history-card-copy strong');
        return parseFloat(getComputedStyle(title).paddingRight);
      })(),
      clearVisible: !document.querySelector('#clearHistoryButton').hidden,
      savingStatus: document.querySelector('#historyStorageStatus').textContent,
      focusedElement: document.activeElement.id,
      panelHeight: document.querySelector('#historyPanel').getBoundingClientRect().height,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight
    })`);
    assert.equal(history.homeHidden, true);
    assert.equal(history.historyHidden, false);
    assert.equal(history.count, '1 / 10');
    assert.equal(history.badge, '1');
    assert.equal(history.title, 'Pricing card');
    assert.equal(history.source, 'example.com');
    assert.equal(history.format, 'PNG');
    assert.equal(history.previewCue, '预览');
    assert.equal(history.deleteUsesIcon, true);
    assert.deepEqual(history.deleteSize, { width: 28, height: 28 });
    assert.equal(history.deleteTopInset, '8px');
    assert.ok(history.deleteTopOffset >= 8 && history.deleteTopOffset <= 10, 'history delete button must align to the card top inset');
    assert.ok(history.titleRightClearance >= 28, 'history titles must reserve space for the delete action');
    assert.equal(history.clearVisible, true);
    assert.equal(history.savingStatus, '新截图不会自动加入此处 · 已有截图仍会保留');
    assert.equal(history.focusedElement, 'historyBackButton');
    assert.equal(history.panelHeight, metrics.localeLayout.panelHeight);
    assert.ok(history.scrollWidth <= 360);
    assert.ok(history.scrollHeight <= 600);

    await page.evaluate(`globalThis.__historyDownload = ''; document.querySelector('.history-download').click()`);
    await page.waitUntil(`globalThis.__historyDownload === 'domshot-pricing.png'`, 'history card did not use the shared download action');

    await page.waitUntil(`getComputedStyle(document.querySelector('#historyPanel')).transform === 'none'`, 'history panel entrance animation did not finish');
    await page.moveMouse(1, 599);
    const clearIdle = await buttonMetrics(page, '#clearHistoryButton');
    await page.hover('#clearHistoryButton');
    await page.waitUntil(`getComputedStyle(document.querySelector('#clearHistoryButton')).color !== ${JSON.stringify(clearIdle.color)}`, 'clear history hover did not change its text color');
    const clearHovered = await buttonMetrics(page, '#clearHistoryButton');
    assert.equal(clearHovered.transform, 'none');
    assert.deepEqual(clearHovered.rect, clearIdle.rect, 'clear history button must not move on hover');
    assert.equal(clearHovered.backgroundColor, clearIdle.backgroundColor, 'clear history hover should remain visually lightweight');

    const cueIdleOpacity = await page.evaluate(`getComputedStyle(document.querySelector('.history-preview-cue')).opacity`);
    await page.hover('.history-thumb');
    await page.waitUntil(`getComputedStyle(document.querySelector('.history-preview-cue')).opacity === '1'`, 'thumbnail preview cue did not appear on hover');
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.history-preview-cue')).opacity`), '1');

    await page.evaluate(`document.querySelector('.history-thumb').click()`);
    await page.waitUntil(`!document.querySelector('#historyDetail').hidden`, 'history preview did not open');
    await page.nextFrames(2);
    const detail = await page.evaluate(`({
      title: document.querySelector('#detailTitle').textContent,
      meta: document.querySelector('#detailMeta').textContent,
      focusedElement: document.activeElement.id,
      actionCount: document.querySelectorAll('.detail-actions button').length,
      deleteInHeader: Boolean(document.querySelector('.detail-header > #detailDeleteButton')),
      deleteUsesIcon: Boolean(document.querySelector('#detailDeleteButton svg')) && document.querySelector('#detailDeleteButton').textContent.trim() === '',
      headerControls: (() => {
        const back = document.querySelector('#detailBackButton').getBoundingClientRect();
        const remove = document.querySelector('#detailDeleteButton').getBoundingClientRect();
        return { back: { top: back.top, width: back.width, height: back.height }, remove: { top: remove.top, width: remove.width, height: remove.height } };
      })()
    })`);
    assert.equal(detail.title, 'Pricing card');
    assert.match(detail.meta, /1200 × 800/);
    assert.equal(detail.focusedElement, 'detailBackButton');
    assert.equal(detail.actionCount, 2);
    assert.equal(detail.deleteInHeader, true);
    assert.equal(detail.deleteUsesIcon, true);
    assertLayoutsClose(detail.headerControls.remove, detail.headerControls.back);

    await page.waitUntil(`getComputedStyle(document.querySelector('#historyDetail')).transform === 'none'`, 'history detail entrance animation did not finish');
    await page.moveMouse(1, 599);
    const detailCopyIdle = await buttonMetrics(page, '#detailCopyButton');
    await page.hover('#detailCopyButton');
    await page.waitUntil(`getComputedStyle(document.querySelector('#detailCopyButton')).backgroundColor !== ${JSON.stringify(detailCopyIdle.backgroundColor)}`, 'detail action hover did not change its surface');
    const detailCopyHovered = await buttonMetrics(page, '#detailCopyButton');
    assertLayoutsClose(detailCopyHovered.rect, detailCopyIdle.rect);
    assert.notEqual(detailCopyHovered.backgroundColor, detailCopyIdle.backgroundColor);

    await page.evaluate(`document.querySelector('#detailCopyButton').classList.add('is-success')`);
    await page.evaluate(`new Promise((resolve) => setTimeout(resolve, 180))`);
    const copySuccessHovered = await page.evaluate(`(() => {
      const style = getComputedStyle(document.querySelector('#detailCopyButton'));
      return { color: style.color, borderColor: style.borderColor, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, boxShadow: style.boxShadow, filter: style.filter };
    })()`);
    await page.moveMouse(1, 599);
    await page.evaluate(`new Promise((resolve) => setTimeout(resolve, 180))`);
    const copySuccessIdle = await page.evaluate(`(() => {
      const style = getComputedStyle(document.querySelector('#detailCopyButton'));
      return { color: style.color, borderColor: style.borderColor, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, boxShadow: style.boxShadow, filter: style.filter };
    })()`);
    assert.deepEqual(copySuccessHovered, copySuccessIdle, 'copy success feedback must not change while hovered');

    await page.evaluate(`document.querySelector('#detailDownloadButton').classList.add('is-success')`);
    await page.evaluate(`new Promise((resolve) => setTimeout(resolve, 180))`);
    const downloadSuccessIdle = await page.evaluate(`(() => {
      const style = getComputedStyle(document.querySelector('#detailDownloadButton'));
      return { color: style.color, borderColor: style.borderColor, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, boxShadow: style.boxShadow, filter: style.filter };
    })()`);
    await page.hover('#detailDownloadButton');
    await page.evaluate(`new Promise((resolve) => setTimeout(resolve, 180))`);
    const downloadSuccessHovered = await page.evaluate(`(() => {
      const style = getComputedStyle(document.querySelector('#detailDownloadButton'));
      return { color: style.color, borderColor: style.borderColor, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, boxShadow: style.boxShadow, filter: style.filter };
    })()`);
    assert.deepEqual(downloadSuccessHovered, downloadSuccessIdle, 'download success feedback must not change while hovered');

    await page.evaluate(`document.querySelector('#detailDeleteButton').click()`);
    await page.waitUntil(`document.querySelectorAll('.history-card').length === 0`, 'deleted history item remained visible');
    assert.equal(await page.evaluate(`document.querySelector('#historyEmpty').hidden`), false);
    const emptyState = await page.evaluate(`(() => {
      const panel = document.querySelector('#historyPanel').getBoundingClientRect();
      const summary = document.querySelector('.history-summary').getBoundingClientRect();
      const empty = document.querySelector('#historyEmpty').getBoundingClientRect();
      return {
        horizontalOffset: (empty.left + empty.width / 2) - (panel.left + panel.width / 2),
        verticalOffset: (empty.top + empty.height / 2) - (summary.bottom + (panel.bottom - summary.bottom) / 2),
        hint: document.querySelector('#historyEmpty small').textContent,
        historyIconPathCount: document.querySelectorAll('#historyButton svg path').length
      };
    })()`);
    assert.ok(Math.abs(emptyState.horizontalOffset) < 0.5, 'empty history state must be horizontally centered');
    assert.ok(Math.abs(emptyState.verticalOffset) < 0.5, 'empty history state must be vertically centered in the content area');
    assert.equal(emptyState.hint, '新截图不会自动加入此处，你仍可在预览中单独加入。');
    assert.equal(emptyState.historyIconPathCount, 3, 'history entry should use the clock-and-arrow icon');
  });
});

function buttonMetrics(page, selector) {
  return page.evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    const style = getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    return { color: style.color, backgroundColor: style.backgroundColor, transform: style.transform, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
  })()`);
}

function assertLayoutsClose(actual, expected, tolerance = 0.5) {
  for (const key of Object.keys(expected)) {
    const actualValue = actual[key];
    const expectedValue = expected[key];
    if (Array.isArray(expectedValue)) {
      assert.equal(actualValue.length, expectedValue.length, `${key} item count changed across locales`);
      expectedValue.forEach((value, index) => assert.ok(Math.abs(actualValue[index] - value) < tolerance, `${key}[${index}] changed across locales`));
    } else {
      assert.ok(Math.abs(actualValue - expectedValue) < tolerance, `${key} changed from ${expectedValue} to ${actualValue}`);
    }
  }
}
