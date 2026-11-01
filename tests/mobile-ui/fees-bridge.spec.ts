import {test,expect} from "@playwright/test";
import {ms} from "../../src/messages/setup";
import {flat,type Language} from "../../src/platform/i18n/language";
for(const language of ["en","hi","both"] as Language[]){
  test(`live payment review and durable recovery at 390px (${language})`,async({page})=>{
    const label=(value:Parameters<typeof flat>[0])=>flat(value,language);
    await page.setViewportSize({width:390,height:844});
    await page.route("**/*",route=>route.request().url().startsWith("http://127.0.0.1:3201/")?route.continue():route.abort());
    await page.goto(`/fees-bridge.html?locale=${language}`);
    await expect(page.getByRole("heading",{name:label(ms.bridgeTitle)})).toBeVisible();
    await page.getByLabel(label(ms.bridgeAmount),{exact:true}).fill("500");
    await expect(page.getByLabel(label(ms.bridgeWaive),{exact:true})).toBeChecked();
    await page.getByRole("button",{name:label(ms.bridgeReview),exact:true}).click();
    await page.getByRole("button",{name:new RegExp(label(ms.bridgeConfirm))}).click();
    await expect(page.getByLabel(label(ms.bridgeAmount),{exact:true})).toBeDisabled();
    await expect(page.getByRole("link",{name:label(ms.bridgeCheckFees),exact:true})).toHaveAttribute("href",/^https:\/\/fees\.vpps\.co\.in\/protected\/payments\/one-status\?commandId=/);
    const original=await page.evaluate(()=>sessionStorage.getItem("synthetic-mobile-last-command"));
    await page.reload();
    await expect(page.getByLabel(label(ms.bridgeAmount),{exact:true})).toBeDisabled();
    await expect(page.getByLabel(label(ms.bridgeAmount),{exact:true})).toHaveValue("500");
    await page.getByRole("button",{name:label(ms.bridgeCheck),exact:true}).click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    if(language==="both")await page.screenshot({path:"D:/Codex/scratch/vppsone-coexistence-plan-2026-11-01/one-live-desk-mobile-recovery.png",fullPage:true});
    await page.getByRole("button",{name:label(ms.bridgeRetry),exact:true}).click();
    await expect(page.getByRole("heading",{name:label(ms.bridgeSaved),exact:true})).toBeVisible();
    await expect(page.getByText("SYN-RECEIPT-001",{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>sessionStorage.getItem("synthetic-mobile-last-command"))).toBe(original);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    if(language==="en")await page.screenshot({path:"D:/Codex/scratch/vppsone-coexistence-plan-2026-11-01/one-live-desk-mobile.png",fullPage:true});
  });
}
test("desktop pilot-closed screen reviews but cannot collect",async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto("/fees-bridge.html?readonly=true");
  await expect(page.getByText(ms.bridgeReadOnly.en,{exact:true})).toBeVisible();
  await page.getByLabel(ms.bridgeAmount.en,{exact:true}).fill("500");
  await page.getByRole("button",{name:ms.bridgeReview.en,exact:true}).click();
  await expect(page.getByRole("button",{name:/Confirm payment/})).toBeDisabled();
  expect(await page.evaluate(()=>sessionStorage.getItem("synthetic-mobile-last-command"))).toBeNull();
});
