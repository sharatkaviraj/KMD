// @vitest-environment jsdom
import * as React from "react";
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const actions=vi.hoisted(()=>({bridgeLateFeeAction:vi.fn(),checkBridgePaymentAction:vi.fn(),reviewBridgePaymentAction:vi.fn(),saveBridgePaymentAction:vi.fn(),searchBridgeStudentsAction:vi.fn()}));
vi.mock("@/app/(app)/payments/bridge-actions",()=>actions);
import {LiveFeesDesk,savedReceiptHref} from "@/vx/screens/payments/live-fees-desk";
import type {BridgeQuote} from "@/platform/fees-bridge/contracts";

const student={id:"00000000-0000-4000-8000-000000000001",name:"Synthetic Student",srNo:"QA-001",className:"QA Class",classId:"00000000-0000-4000-8000-000000000002",sessionLabel:"2026-27",status:"active"};
const quote:BridgeQuote={student,quoteHash:"a".repeat(32),paymentDate:"2026-11-01",amount:500,quickDiscountAmount:0,lateFeeWaiverAmount:100,feesPending:1000,lateFeePending:100,totalPending:1100,payableAfterAdjustments:1000,remainingBalance:500,installments:[],acceptedPaymentModes:["cash"],asOf:"2026-11-01"};
const recoveryKey="vppsone:fees-command:synthetic-user:2026-27";
let host:HTMLDivElement,root:Root;
async function render(canPost=true){await act(async()=>root.render(<LiveFeesDesk language="en" sessionLabel="2026-27" today="2026-11-01" canPost={canPost} canWaive canDiscount userId="synthetic-user" initialStudents={[student]} initialCursor={null} initialStudentId={student.id} initialError={null}/>));}
async function click(label:string){const button=[...host.querySelectorAll("button")].find(element=>element.textContent?.includes(label));expect(button).toBeDefined();await act(async()=>button!.click());}
async function amount(){const element=host.querySelector<HTMLInputElement>('input[type="number"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(element,"500");element.dispatchEvent(new Event("input",{bubbles:true}));});}
beforeEach(()=>{
  vi.resetAllMocks();sessionStorage.clear();
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  actions.reviewBridgePaymentAction.mockResolvedValue({ok:true,data:quote});
  actions.bridgeLateFeeAction.mockResolvedValue({ok:true,data:100});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});

describe("live payment recovery",()=>{
  it("keeps the original payload after a lost action response and browser reload",async()=>{
    actions.saveBridgePaymentAction.mockRejectedValueOnce(new Error("response lost"));
    await render();await amount();await click("Review current dues");
    expect(actions.reviewBridgePaymentAction.mock.calls[0][1]).toBe(true);
    await click("Confirm payment");
    const original=actions.saveBridgePaymentAction.mock.calls[0][0];
    expect(JSON.parse(sessionStorage.getItem(recoveryKey)!)).toEqual(original);
    expect(host.textContent).toContain("The result is not confirmed");
    expect(host.querySelector("fieldset")?.disabled).toBe(true);
    await act(async()=>root.unmount());root=createRoot(host);await render();
    expect(host.textContent).toContain("Check this payment's status");
    actions.checkBridgePaymentAction.mockResolvedValue({ok:true,data:{status:"not_found",commandId:original.commandId}});
    await click("Check this payment's status");
    actions.saveBridgePaymentAction.mockResolvedValue({ok:true,data:{commandId:original.commandId,status:"completed",receiptId:"00000000-0000-4000-8000-000000000003",receiptNumber:"SYN-001",studentId:student.id,sessionLabel:"2026-27",amountReceived:500,remainingBalance:500,feesPending:500,lateFeePending:0,paymentDate:"2026-11-01",paymentMode:"cash",receivedBy:"Synthetic Staff",quickDiscountApplied:0,lateFeeWaivedApplied:100,printUrl:"https://fees.vpps.co.in/protected/receipts/synthetic"}});
    await click("Retry this same payment");
    expect(actions.saveBridgePaymentAction.mock.calls[1][0]).toEqual(original);
    expect(sessionStorage.getItem(recoveryKey)).toBeNull();
    expect(host.textContent).toContain("Payment recorded");expect(host.textContent).toContain("SYN-001");
    // The saved receipt opens in One by id and year; Fees' print address is never followed (F01).
    const print=[...host.querySelectorAll("a")].find(link=>link.textContent?.includes("print receipt"));
    expect(print?.getAttribute("href")).toBe("/receipts/SYN-001?receiptId=00000000-0000-4000-8000-000000000003&session=2026-27");
    expect([...host.querySelectorAll("a")].some(link=>link.getAttribute("href")?.includes("/protected/receipts/"))).toBe(false);
  });
  it("offers the late-fee waiver only for a chosen child with a late fee, ticked by default",async()=>{
    await render();
    expect(host.textContent).toContain("Waive late fee");
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    await act(async()=>root.unmount());root=createRoot(host);
    actions.bridgeLateFeeAction.mockResolvedValue({ok:true,data:0});
    await render();await amount();
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    await click("Review current dues");
    expect(actions.reviewBridgePaymentAction.mock.calls.at(-1)?.[1]).toBe(false);
  });
  it("keeps the waiver box when the late fee cannot be read, as before",async()=>{
    actions.bridgeLateFeeAction.mockResolvedValue({ok:false,code:"unavailable",message:"Synthetic",uncertain:false});
    await render();
    expect(host.querySelector('input[type="checkbox"]')).not.toBeNull();
  });
  it("allows live review but does not post while the One pilot is closed",async()=>{
    await render(false);await amount();await click("Review current dues");await click("Confirm payment");
    expect(actions.saveBridgePaymentAction).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Collection in One is currently closed");
  });
  it("never turns Fees' print address into a destination, however it is written",()=>{
    const id="00000000-0000-4000-8000-000000000003";
    for(const printUrl of ["https://evil.test/receipt","javascript:alert(1)","https://fees.vpps.co.in@evil.test/receipt","/protected/receipts/synthetic/pdf"]){
      expect(savedReceiptHref({receiptId:id,receiptNumber:"SYN 1/2",student,amountReceived:500,paymentDate:"2026-11-01",paymentMode:"cash",receivedBy:null,referenceNumber:null,notes:null,reversed:false,allocations:[],printUrl}))
        .toBe(`/receipts/SYN%201%2F2?receiptId=${id}&session=2026-27`);
    }
  });
});
