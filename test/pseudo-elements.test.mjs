import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { withChromePage } from './support/chrome-page.mjs';

const bundle = await readFile(new URL('../dist/content.js', import.meta.url), 'utf8');

test('source selectors do not reapply to the reconstructed pseudo-element tree', async () => {
  const css = 'body{margin:0;background:white}:root{--content-space:20px}section{position:relative;width:200px;height:100px}@media(min-width:400px){.content{padding:var(--content-space);width:100px}}section>.content:not(:first-child){padding:0!important}.marker{width:10px;height:10px;background:blue}';
  for (const linked of [false, true]) {
    const sheet = linked ? `<link rel="stylesheet" href="data:text/css,${encodeURIComponent(css)}">` : `<style>${css}</style>`;
    const html = `<!doctype html>${sheet}<style>section::before{content:"";position:absolute;width:5px;height:5px;background:black}</style><section><div class="content"><div class="marker"></div></div></section>`;
    await withChromePage({ url: `data:text/html,${encodeURIComponent(html)}`, viewport: { width: 480, height: 400 } }, async page => {
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.content')).paddingLeft`), '20px');
      await page.evaluate(`chrome.runtime={onMessage:{addListener(listener){globalThis.listener=listener},removeListener(){}},async sendMessage(){return {resources:[]}}}`);
      await page.evaluate(bundle);
      await page.evaluate(`listener({type:'DOMSHOT_FULL_PAGE',settings:{format:'png',scale:1,embedFonts:false,reconcile:false,compress:false},locale:'en',theme:'light',pageZoom:1},{},()=>{})`);
      await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi==='preview'`, 'Capture did not finish');
      const position = await page.evaluate(`(async()=>{
        const image=document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.image-stage img');await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        const context=canvas.getContext('2d');context.drawImage(image,0,0);const data=context.getImageData(0,0,canvas.width,canvas.height).data;
        let minX=canvas.width,minY=canvas.height;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4;if(data[i]===0&&data[i+1]===0&&data[i+2]===255){minX=Math.min(minX,x);minY=Math.min(minY,y)}}return {minX,minY};
      })()`);
      assert.deepEqual(position, { minX: 20, minY: 20 }, linked ? 'linked stylesheet' : 'inline stylesheet');
    });
  }
});

test('only generated pseudo-elements contribute decoration to captures', async () => {
  const html = `<!doctype html><style>
    body{margin:0;background:white}
    main{position:relative;width:200px;height:100px}
    main::after{content:none;position:absolute;inset:0;width:200%;height:200%;border:4px solid red;border-radius:30px}
    main::before{content:"";position:absolute;left:0;top:0;width:10px;height:10px;background:blue}
    section::before{content:normal;display:block;height:40px;background:red}
    section::after{content:"";display:none;position:absolute;inset:0;background:red}
    p::first-letter{color:magenta;font-size:32px}
  </style><main></main><section></section><p>Visible first letter</p>`;
  await withChromePage({ url: `data:text/html,${encodeURIComponent(html)}`, viewport: { width: 480, height: 400 } }, async page => {
    await page.evaluate(`chrome.runtime={onMessage:{addListener(listener){globalThis.listener=listener},removeListener(){}},async sendMessage(){return {resources:[]}}}`);
    await page.evaluate(bundle);
    await page.evaluate(`listener({type:'DOMSHOT_FULL_PAGE',settings:{format:'png',scale:1,embedFonts:false,reconcile:false,compress:false},locale:'en',theme:'light',pageZoom:1},{},()=>{})`);
    await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi==='preview'`, 'Capture did not finish');
    const pixels = await page.evaluate(`(async()=>{
      const image=document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.image-stage img');await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const context=canvas.getContext('2d');context.drawImage(image,0,0);const data=context.getImageData(0,0,canvas.width,canvas.height).data;
      const counts={red:0,blue:0,magenta:0};for(let i=0;i<data.length;i+=4){if(data[i]>240&&data[i+1]<20&&data[i+2]<20)counts.red++;if(data[i]<20&&data[i+1]<20&&data[i+2]>240)counts.blue++;if(data[i]>240&&data[i+1]<20&&data[i+2]>240)counts.magenta++;}return counts;
    })()`);
    assert.equal(pixels.red, 0, 'content:none/normal and display:none must not create visible decorations');
    assert.equal(pixels.blue, 100, 'An empty-string pseudo-element still generates its painted box');
    assert.ok(pixels.magenta > 5, 'Legitimate first-letter styling must remain visible');
  });
});

test('style isolation preserves styles from shadow roots and constructed stylesheets', async () => {
  await withChromePage({ url: 'about:blank', viewport: { width: 480, height: 400 } }, async page => {
    await page.evaluate(`(() => {
      document.body.style.margin = '0';
      document.body.style.background = 'white';
      const host = document.createElement('div');
      host.id = 'target';
      host.style.cssText = 'display:block;width:100px;height:100px';
      const shadow = host.attachShadow({ mode: 'open' });
      const inline = document.createElement('style');
      inline.textContent = '.inline{position:absolute;left:10px;top:10px;width:20px;height:20px;background:blue}';
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('.constructed{position:absolute;left:50px;top:50px;width:20px;height:20px;background:rgb(0,128,0)}');
      shadow.adoptedStyleSheets = [sheet];
      shadow.append(inline);
      const inlineBox = document.createElement('span');
      inlineBox.className = 'inline';
      const constructedBox = document.createElement('span');
      constructedBox.className = 'constructed';
      shadow.append(inlineBox, constructedBox);
      document.body.append(host);
      chrome.runtime={onMessage:{addListener(listener){globalThis.listener=listener},removeListener(){}},async sendMessage(){return {resources:[]}}};
    })()`);
    await page.evaluate(bundle);
    await page.evaluate(`listener({type:'DOMSHOT_SELECT',settings:{format:'png',scale:1,embedFonts:false,reconcile:false,compress:false},locale:'en',theme:'light',pageZoom:1},{},()=>{})`);
    await page.evaluate(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:80,clientY:80}));document.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:80,clientY:80}))`);
    await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi==='preview'`, 'Capture did not finish');
    const colors = await page.evaluate(`(async()=>{
      const image=document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.image-stage img');await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const context=canvas.getContext('2d');context.drawImage(image,0,0);
      return [[15,15],[55,55]].map(([x,y])=>[...context.getImageData(x,y,1,1).data]);
    })()`);
    assert.deepEqual(colors, [[0, 0, 255, 255], [0, 128, 0, 255]]);
  });
});
