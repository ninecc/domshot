import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { withChromePage } from "./support/chrome-page.mjs";
const bundle = await readFile(new URL("../dist/content.js", import.meta.url), "utf8");
async function capture(page, mode = "DOMSHOT_FULL_PAGE", scale = 1) {
  await page.evaluate(`globalThis.listener({type:${JSON.stringify(mode)},settings:{format:'png',scale:${scale},embedFonts:false,reconcile:false,compress:false},locale:'en',theme:'light',pageZoom:1},{},()=>{})`);
  await page.waitUntil(`document.querySelector('#domshot-extension-root')?.dataset.domshotUi==='preview'`, "Missing capture");
  return page.evaluate(`(async()=>{const im=document.querySelector('#domshot-extension-root').shadowRoot.querySelector('.image-stage img');await im.decode();const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;let red=0,green=0,minRed=c.width,transparent=0,minMagentaX=c.width,minMagentaY=c.height;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;if(d[i+3]<255)transparent++;if(d[i]===255&&d[i+1]===0&&d[i+2]===255&&d[i+3]===255){minMagentaX=Math.min(minMagentaX,x);minMagentaY=Math.min(minMagentaY,y)}if(d[i]===255&&d[i+1]===0&&d[i+2]===0&&d[i+3]===255){red++;minRed=Math.min(minRed,x)}if(d[i]===0&&d[i+1]===255&&d[i+2]===0)green++}return{width:c.width,height:c.height,red,green,minRed,transparent,minMagentaX,minMagentaY,samples:[10,300,490,950].filter(x=>x<c.width).map(x=>[...d.slice((50*c.width+x)*4,(50*c.width+x)*4+4)])}})()`);
}
async function fixture(html, run) {
  await withChromePage({ url: "data:text/html," + encodeURIComponent("<!doctype html>" + html), viewport: { width: 480, height: 400 } }, async (page) => {
    await page.evaluate(`chrome.runtime={onMessage:{addListener(l){globalThis.listener=l},removeListener(){}},async sendMessage(){return{ok:true}}}`);
    await page.evaluate(bundle);
    await run(page);
  });
}
const wide = '<main style="width:960px;height:800px;padding-top:100px;box-sizing:border-box"><div style="margin-left:900px;width:30px;height:30px;background:red"></div><div style="position:absolute;left:0;top:200px;width:100px;height:40px;overflow:auto"><div style="width:200px;height:40px"><div style="margin-left:150px;width:30px;height:30px;background:lime"></div></div></div></main>';
test("document capture preserves overflow content and nested clipping at every scroll position", async () => {
  await fixture("<style>body{margin:0;background:rgb(12,34,56);overflow:auto}</style>" + wide, async (page) => {
    for (const scale of [1, 2, 3]) for (const x of [0, 480]) {
      await page.evaluate(`scrollTo(${x},0)`);
      await page.nextFrames();
      const full = await capture(page, "DOMSHOT_FULL_PAGE", scale);
      assert.deepEqual([full.width, full.height, full.red, full.minRed, full.green, full.transparent], [960*scale, 800*scale, 900*scale*scale, 900*scale, 0, 0]);
      const visible = await capture(page, "DOMSHOT_VISIBLE_AREA", scale);
      assert.deepEqual([visible.width, visible.height, visible.red, visible.minRed, visible.green, visible.transparent], [480*scale, 400*scale, x ? 900*scale*scale : 0, (x ? 420 : 480)*scale, 0, 0]);
      assert.equal(await page.evaluate("scrollX"), x);
    }
  });
});
test("document backgrounds preserve alpha and gradient positioning beyond the viewport", async () => {
  for (const background of ["rgba(12,34,56,0.5)", "linear-gradient(to right, red, blue)"]) {
    await fixture("<style>body{margin:0;background:" + background + '}</style><main style="width:960px;height:800px"></main>', async (page) => {
      const image = await capture(page);
      assert.equal(image.width, 960);
      if (background.startsWith("rgba")) {
        for (const pixel of image.samples) assert.ok(Math.abs(pixel[3] - 128) <= 1, JSON.stringify(image.samples));
      } else {
        assert.equal(image.transparent, 0);
        assert.deepEqual(image.samples[0], image.samples[2], "Gradient must repeat using the original 480px positioning box");
        assert.ok(image.samples[0][0] > 240 && image.samples[1][2] > 150, "Gradient must not stretch to the output width");
      }
    });
  }
});
test("transparent documents stay transparent and explicit root clipping is retained", async () => {
  await fixture("<style>html{overflow:hidden}body{margin:0}</style>" + wide, async (page) => {
    const result = await capture(page);
    assert.equal(result.red, 0, "Hidden root overflow must not be expanded");
    assert.ok(result.transparent > 0);
  });
  await fixture('<style>body{margin:0}</style><main style="width:960px;height:800px"></main>', async (page) => {
    const result = await capture(page);
    assert.equal(result.transparent, result.width * result.height);
  });
});
test("a separately scrolling body remains a nested scroll container", async () => {
  await fixture("<style>html{overflow:auto}body{margin:0;width:240px;height:200px;overflow:auto;background:blue}</style>" + wide, async (page) => {
    const result = await capture(page);
    assert.equal(result.red, 0, "Body contents outside its own scrollport stay clipped");
  });
});

test('fixed and sticky elements retain their observed document position', async () => {
  for (const position of ['fixed', 'sticky']) {
    await fixture(`<style>body{margin:0;background:blue}</style><main style="width:960px;height:1000px"><div style="position:${position};left:10px;top:10px;width:20px;height:20px;background:magenta"></div></main>`, async page => {
      await page.evaluate('scrollTo(240, 200)');
      await page.nextFrames();
      const bounds = await page.evaluate(`(() => {const r=document.querySelector('main > div').getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY}})()`);
      const image = await capture(page);
      assert.ok(Math.abs(image.minMagentaX-bounds.x)<=1, 'Document x must match the observed fixed/sticky position');
      assert.ok(Math.abs(image.minMagentaY-bounds.y)<=1, 'Document y must match the observed fixed/sticky position');
    });
  }
});
