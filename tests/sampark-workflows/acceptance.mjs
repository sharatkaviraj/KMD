import {createServer} from "vite";
import {chromium,expect} from "@playwright/test";
import {mkdir,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
import sharp from "sharp";
const server=await createServer({configFile:fileURLToPath(new URL("./vite.config.mjs",import.meta.url))});
await server.listen();
let browser;
const output=new URL("../../docs/evidence/sampark-workflows/screenshots/",import.meta.url);
await mkdir(output,{recursive:true});
const results=[];
try {
  browser=await chromium.launch({headless:true});
  for(const width of [390,1440]){
    const context=await browser.newContext({viewport:{width,height:width===390?844:1000}});
    const page=await context.newPage();const errors=[],external=[],warnings=[];
    page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());else if(m.type()==="warning")warnings.push(m.text());});
    await page.route("**/*",async route=>{
      const url=new URL(route.request().url());
      if(url.origin!=="http://127.0.0.1:3230"){external.push(url.origin);await route.abort();return;}
      if(url.pathname.startsWith("/t/tasks/")){
        const payload=route.request().postDataJSON();await page.evaluate(payload=>{window.acceptance.calls.push({kind:"publicAcademic",payload});sessionStorage.setItem("acceptance-last-call",JSON.stringify({kind:"publicAcademic",payload}));},payload);
        const outcome=await page.evaluate(()=>window.acceptance.outcome);await route.fulfill({json:outcome==="unknown"?{error:"Synthetic response lost"}:outcome==="ok"?{ok:true,revision:1,replayed:true}:{ok:false,reason:outcome}});return;
      }
      await route.continue();
    });
    const go=async(screen,query="")=>{await page.goto(`http://127.0.0.1:3230/fixture.html?screen=${screen}${query}`);await page.locator("#root > *").first().waitFor();};
    const shot=async name=>{await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>undefined))));await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:fileURLToPath(new URL(`${name}-${width}.png`,output)),fullPage:true,animations:"disabled"});};
    const button=name=>page.getByRole("button",{name,exact:true});
    await go("integrations");await expect(page.getByText("Setup pending",{exact:true})).toBeVisible();
    await expect(page.getByText("Active local templates: 6")).toBeVisible();await expect(page.getByText(/Automated task messages are off/)).toBeVisible();
    await shot("integrations-pending");
    await page.getByRole("link",{name:"Open tasks and share a link"}).click();await button("Review message").click();
    await expect(button("Send through AiSensy")).toBeDisabled();await expect(page.getByText("Students: 2",{exact:true})).toBeVisible();
    await button("Prepare WhatsApp link").click();await expect(page.getByRole("link",{name:"Open WhatsApp",exact:true})).toHaveAttribute("href",/^https:\/\/wa.me\//);
    await expect(page.getByText("WhatsApp link prepared — sending unconfirmed").first()).toBeVisible();await shot("manual-sharing");
    assert.equal(await page.evaluate(()=>window.acceptance.calls.filter(c=>c.kind==="deliveryConfirm").length),1);
    await go("delivery","&ready=1");await button("Review message").click();await page.evaluate(()=>window.acceptance.outcome="unknown");
    await button("Send through AiSensy").dblclick();await expect(page.getByText("Provider result unknown",{exact:false}).first()).toBeVisible();
    assert.equal(await page.evaluate(()=>window.acceptance.calls.filter(c=>c.kind==="deliveryConfirm").length),1);
    await expect(button("Review message")).toHaveCount(0);await expect(button("Prepare WhatsApp link")).toHaveCount(0);
    await shot("provider-unknown");await page.locator("textarea").fill("Synthetic log checked: provider did not send.");
    await button("Confirm not sent in log").click();await expect(button("Review message")).toBeVisible();await button("Review message").click();
    await page.evaluate(()=>{window.acceptance.summary={...window.acceptance.summary,pending:false};window.acceptance.outcome="ok";});
    await button("Send through AiSensy").click();await expect(page.getByText(/No teacher work remains pending/).first()).toBeVisible();
    await go("students");await expect(page.getByText("QA-001").filter({visible:true}).first()).toBeVisible();await shot("students-no-photo");
    await page.getByRole("button",{name:"Assign work (2)",exact:true}).click();
    // Ask teachers is four questions since D-522: what, which children, who fills it in, by when.
    await expect(page.getByText("The 2 children you picked",{exact:true})).toBeVisible();await expect(page.getByRole("checkbox",{name:/^Student photograph/})).toBeChecked();
    await page.getByRole("radio",{name:/^One teacher for all/}).check();await page.getByRole("combobox",{name:"Pick the teacher"}).selectOption("60000000-0000-4000-8000-000000000010");
    // Changing the teacher re-checks the list in place; "Give work" waits for it.
    await button("See who gets it").click();await button("Change").click();await page.getByRole("combobox",{name:/^Choose/}).selectOption("60000000-0000-4000-8000-000000000011");
    await expect.poll(()=>page.evaluate(()=>window.acceptance.calls.filter(c=>c.kind==="preview").length)).toBe(2);await expect(button("Give work to 1 teacher")).toBeEnabled();await shot("common-task-preview");
    await page.evaluate(()=>window.acceptance.outcome="unknown");await button("Give work to 1 teacher").click();
    const firstCreate=await page.evaluate(()=>window.acceptance.calls.find(c=>c.kind==="create"));await page.evaluate(()=>window.acceptance.outcome="ok");
    await button("Give work to 1 teacher").dblclick();await expect(page.getByText("Work given to 1 teacher")).toBeVisible();await expect(button("Give work to 1 teacher")).toHaveCount(0);
    const creates=await page.evaluate(()=>window.acceptance.calls.filter(c=>c.kind==="create"));assert.equal(creates.length,2);assert.deepEqual(creates[1],firstCreate);
    await go("profile");await shot("student-profile-pending");await button("Change photograph").click();
    const image=await sharp({create:{width:900,height:1200,channels:3,background:"#81cfd1"}}).jpeg().toBuffer();
    await expect(page.locator('input[type=file]:not([capture])')).toBeEnabled();await page.locator('input[type=file]:not([capture])').setInputFiles({name:"synthetic.jpg",mimeType:"image/jpeg",buffer:image});await page.locator("[data-photo-preview] img").waitFor();
    await shot("student-profile-preview");await button("Cancel").click();assert.equal(await page.evaluate(()=>window.acceptance.calls.filter(c=>c.kind==="photo").length),0);
    await button("Change photograph").click();await expect(page.locator("input[capture]")).toBeEnabled();await page.locator("input[capture]").setInputFiles({name:"synthetic-camera.jpg",mimeType:"image/jpeg",buffer:image});await page.locator("[data-photo-preview] img").waitFor();
    await page.evaluate(()=>window.acceptance.outcome="unknown");await button("Save photograph").click();await expect(button("Retry this photograph")).toBeEnabled();await page.waitForFunction(()=>window.acceptance.calls.some(c=>c.kind==="photo"));
    const photo=JSON.parse(await page.evaluate(()=>sessionStorage.getItem("acceptance-last-call")));assert.ok(photo.payload.bytes<=204800);
    await page.reload();await button("Change photograph").click();await button("Restore photograph draft").click();await button("Retry this photograph").click();await page.waitForFunction(()=>window.acceptance.calls.some(c=>c.kind==="photo"));
    assert.deepEqual(await page.evaluate(()=>window.acceptance.calls.find(c=>c.kind==="photo")),photo);
    await go("profile","&portrait=approved");await shot("student-profile-approved");
    await go("staff");await shot("staff-profile-approved");
    await go("login");await expect(page.locator('img[src="/branding/veer-patta-school-logo.jpg"]').first()).toBeAttached();await shot("sign-in-branding");
    await page.getByRole("link",{name:"Continue to synthetic task"}).click();await expect(page.locator('input[type=number]')).toBeEnabled();
    for(const entry of ["login","link"]){
      await go("marks",`&entry=${entry}`);await page.evaluate(()=>window.acceptance.outcome="incomplete");await button("Submit completed work").click();await button("Review and save").click();await expect(page.locator('input[type=number]')).toBeEnabled();
      await page.locator('input[type=number]').fill("42");await page.evaluate(()=>window.acceptance.outcome="paper_locked");await button("Submit completed work").click();await button("Review and save").click();await expect(page.locator('input[type=number]')).toBeEnabled();
      await page.evaluate(()=>window.acceptance.outcome="unknown");await button("Submit completed work").click();await button("Review and save").dblclick();await expect(button("Retry the same save")).toBeVisible();
      await expect(page.getByText("Saved on this device · school save unconfirmed",{exact:true})).toBeVisible();await expect(page.getByText(/not yet saved by school/)).toHaveCount(0);
      const command=JSON.parse(await page.evaluate(()=>sessionStorage.getItem("acceptance-last-call")));await shot(`marks-uncertain-${entry}`);
      await page.reload();await button("Restore and review").click();await expect(page.locator('input[type=number]')).toBeDisabled();await button("Retry the same save").click();await page.waitForFunction(()=>window.acceptance.calls.some(c=>["academic","publicAcademic"].includes(c.kind)));
      assert.deepEqual(await page.evaluate(()=>window.acceptance.calls.find(c=>["academic","publicAcademic"].includes(c.kind))),command);
    }
    await go("attendance");await page.locator("select").selectOption("leave");await page.reload();await button("Restore and review").click();await expect(page.locator("select")).toHaveValue("leave");
    await button("Review and save").click();await button("Review and save").last().click();await shot("attendance-saved");
    await go("integrations","&lang=hi");await expect(page.getByText("सेटअप बाकी है",{exact:true})).toBeVisible();await shot("integrations-pending-hi");
    assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);
    results.push({width,passed:true,warnings,externalRequests:external.length,pageErrors:errors.length});console.log(`PASS: ${width}px production Settings/Students/Student360/Staff/Login/Task components; pending/manual, preview edit/create retry, photo cancel/exact durable retry, academics login/link refusal/reload/replay, provider unknown/reconcile/completed checks.`);
    await context.close();
  }
  await writeFile(new URL("../browser-results.json",output),JSON.stringify(results,null,2)+"\n");
} finally {await browser?.close();await server.close();}
