// Local synthetic browser, stub actions, every non-loopback request blocked.
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const server = await createServer({ configFile: new URL("./vite.config.ts", import.meta.url).pathname.replace(/^\/(.:)/,"$1") });
await server.listen();
const browser = await chromium.launch({ headless: true });
const output = new URL("../../docs/evidence/sampark-workflows/photo-screenshots/",import.meta.url);
await mkdir(output,{recursive:true});
const image = await sharp({create:{width:1200,height:1600,channels:3,background:"#81cfd1"}}).jpeg().toBuffer();
try {
  for (const [width,language,entry] of [[1440,"en","login"],[390,"hi","public"]]) {
    const context = await browser.newContext({ viewport: {width,height:width===390?844:1000} });
    const page = await context.newPage();
    const errors=[]; page.on("pageerror", e=>errors.push(e.message));
    await page.route("**/*",route=>new URL(route.request().url()).hostname==="127.0.0.1"?route.continue():route.abort());
    const url=`http://127.0.0.1:3228/fixture.html?lang=${language}&entry=${entry}`;
    await page.goto(url); const en=language==="en";
    const open=en?"Change photograph":"फोटो बदलें",save=en?"Save photograph":"फोटो सहेजें",cancel=en?"Cancel":"रद्द करें",retry=en?"Retry this photograph":"इसी फोटो को फिर जाँचें",restore=en?"Restore photograph draft":"सहेजा मसौदा खोलें";
    await page.getByRole("button",{name:open,exact:true}).click();
    await expect(page.locator('input[type=file]:not([capture])')).toBeEnabled();
    await page.locator('input[type=file]:not([capture])').setInputFiles({name:"synthetic.jpg",mimeType:"image/jpeg",buffer:image});
    await page.locator("[data-photo-preview] img").waitFor();
    await page.getByRole("button",{name:save,exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.photoCalls.length),0);
    await page.screenshot({path:new URL(`preview-${width}-${language}.png`,output).pathname.replace(/^\/(.:)/,"$1"),fullPage:true});
    await page.getByRole("button",{name:cancel,exact:true}).click();
    assert.equal(await page.evaluate(()=>window.photoCalls.length),0);
    await page.getByRole("button",{name:open,exact:true}).click();
    await expect(page.locator('input[capture]')).toBeEnabled();
    await page.locator('input[capture]').setInputFiles({name:"camera.jpg",mimeType:"image/jpeg",buffer:image});
    await page.locator("[data-photo-preview] img").waitFor();
    await page.evaluate(()=>window.photoOutcome="unknown");
    await page.getByRole("button",{name:save,exact:true}).click();
    await expect(page.getByRole("button",{name:retry,exact:true})).toBeEnabled();
    await page.waitForFunction(()=>window.photoCalls.length===1);
    const command=await page.evaluate(()=>window.photoCalls[0]); assert.ok(command.bytes<=204800);
    assert.equal(await page.getByRole("button",{name:cancel,exact:true}).isDisabled(),true);
    await page.reload(); await page.getByRole("button",{name:open,exact:true}).click();
    await page.getByRole("button",{name:restore,exact:true}).click();
    await page.getByRole("button",{name:retry,exact:true}).click();
    await page.getByRole("button",{name:open,exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.photoCalls[0]),command);
    assert.equal(await page.locator("[data-official]").textContent(),"Official portrait: unchanged");
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
    await page.screenshot({path:new URL(`saved-${width}-${language}.png`,output).pathname.replace(/^\/(.:)/,"$1"),fullPage:true});
    await context.close(); console.log(`PASS: ${width}px ${language} ${entry}: file/camera preview, inert cancel, capped output, durable exact retry, no overflow/external requests`);
  }
} finally { await browser.close(); await server.close(); }
