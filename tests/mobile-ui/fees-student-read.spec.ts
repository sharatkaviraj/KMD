import {test,expect} from "@playwright/test";
import {T} from "../../src/vx/screens/admin/text";
import {lead} from "../../src/vx/text";
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYf8AAAAASUVORK5CYII=","base64");
for(const language of ["en","hi","both"] as const)test(`native source student read and tab flow at 390px (${language})`,async({page})=>{
  await page.setViewportSize({width:390,height:844});const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/*",route=>route.request().url().startsWith("http://127.0.0.1:3201/")?route.request().url().endsWith("/synthetic-student-photo.png")?route.fulfill({body:png,contentType:"image/png"}):route.continue():route.abort());
  await page.goto(`/fees-student-read.html?locale=${language}`);await expect(page.getByRole("heading",{name:"Synthetic Student",exact:true})).toBeVisible();
  await expect(page.locator(".s360-ava img")).toHaveCount(1);
  for(const section of ["fees","ledger","emi","documents"])await expect(page.locator(`[data-student-source-section="${section}"]`)).toHaveCount(1);
  await expect(page.getByText("Synthetic correction",{exact:true})).toHaveCount(1);
  const receipt=page.locator('a[href^="/receipts/SYN20261101-0001"]');await expect(receipt).toHaveCount(3);for(const link of await receipt.all())await expect(link).toHaveAttribute("href",/receiptId=00000000-0000-4000-8000-000000000003&session=2026-27/);
  await expect(page.locator('a[href*="/documents/"]')).toHaveAttribute("href",/^\/api\/fees-bridge\/students\/00000000-0000-4000-8000-000000000001\/documents\/00000000-0000-4000-8000-000000000004\?session=2026-27$/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.locator(".s360-body").evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  if(language==="en"){
    await page.locator('[data-student-source-section="ledger"]').scrollIntoViewIfNeeded();
    await page.screenshot({path:"D:/Codex/scratch/vppsone-coexistence-plan-2026-11-01/native-student-fees-mobile.png",animations:"disabled"});
  }
  await page.locator(".s360-tabs").getByRole("link",{name:lead(T.tabInfo,language),exact:true}).click();
  await expect(page.locator('[data-student-source-section="profile"]')).toHaveCount(1);await expect(page.getByText("SYN-APAAR",{exact:true})).toHaveCount(1);await expect(page.getByText("Synthetic health and admission note",{exact:true})).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.locator(".s360-body").evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  if(language==="both")await page.screenshot({path:"D:/Codex/scratch/vppsone-coexistence-plan-2026-11-01/native-student-profile-mobile.png",animations:"disabled"});
  await page.locator(".s360-tabs").getByRole("link",{name:lead(T.tabFamily,language),exact:true}).click();
  for(const section of ["household","history"])await expect(page.locator(`[data-student-source-section="${section}"]`)).toHaveCount(1);
  await expect(page.getByText("Synthetic contact note",{exact:true})).toHaveCount(1);await expect(page.getByText("Synthetic delivery note",{exact:true})).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test("Office source read retains allowed fees without ledger or private document controls",async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.route("**/synthetic-student-photo.png",route=>route.fulfill({body:png,contentType:"image/png"}));
  await page.goto("/fees-student-read.html?role=office");await expect(page.locator('[data-student-source-section="fees"]')).toHaveCount(1);
  await expect(page.locator('[data-student-source-section="ledger"], [data-student-source-section="documents"]')).toHaveCount(0);await expect(page.locator('a[href*="/documents/"]')).toHaveCount(0);
  await expect(page.getByText("Synthetic waiver",{exact:true})).toHaveCount(1);
});
