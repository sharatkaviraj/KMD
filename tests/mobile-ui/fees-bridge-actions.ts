import type {BridgePostInput,BridgeQuoteInput} from "@/platform/fees-bridge/contracts";
export const student={id:"00000000-0000-4000-8000-000000000001",name:"Synthetic Student",srNo:"SYN-001",className:"Class 7 A",classId:"00000000-0000-4000-8000-000000000002",sessionLabel:"2026-27",status:"active"};
export async function searchBridgeStudentsAction(){return {ok:true as const,data:{students:[student],nextCursor:null}};}
export async function reviewBridgePaymentAction(input:BridgeQuoteInput,waive:boolean){return {ok:true as const,data:{...input,student,quoteHash:"a".repeat(32),lateFeeWaiverAmount:waive?100:0,feesPending:1000,lateFeePending:100,totalPending:1100,payableAfterAdjustments:1000,remainingBalance:500,installments:[],acceptedPaymentModes:["cash" as const],asOf:"2026-11-01"}};}
export async function checkBridgePaymentAction(commandId:string){return {ok:true as const,data:{commandId,status:"not_found" as const}};}
export async function saveBridgePaymentAction(input:BridgePostInput){
  const key="synthetic-mobile-last-command";
  const previous=sessionStorage.getItem(key);
  if(!previous){sessionStorage.setItem(key,JSON.stringify(input));throw new Error("Synthetic lost response");}
  const ordered=(value:object)=>JSON.stringify(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)));
  if(ordered(JSON.parse(previous))!==ordered(input))throw new Error("Fixture detected a replacement payment");
  return {ok:true as const,data:{commandId:input.commandId,status:"completed" as const,receiptId:"00000000-0000-4000-8000-000000000003",receiptNumber:"SYN-RECEIPT-001",studentId:student.id,sessionLabel:"2026-27",amountReceived:500,remainingBalance:500,feesPending:500,lateFeePending:0,paymentDate:"2026-11-01",paymentMode:"cash",receivedBy:"Synthetic Staff",quickDiscountApplied:0,lateFeeWaivedApplied:100,printUrl:"https://fees.vpps.co.in/protected/receipts/00000000-0000-4000-8000-000000000003/pdf"}};
}
