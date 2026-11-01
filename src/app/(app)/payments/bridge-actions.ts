"use server";

import { z } from "zod";
import { getBridgeCommand, listBridgeStudents, postBridgePayment, quoteBridgePayment } from "@/platform/fees-bridge/client";
import { quoteInputSchema, type BridgePostInput, type BridgeQuoteInput } from "@/platform/fees-bridge/contracts";
import { FeesBridgeError } from "@/platform/fees-bridge/transport";
import { assertStaff } from "@/platform/auth/current-staff";

type Result<T> = {ok:true;data:T} | {ok:false;code:string;message:string;uncertain:boolean};
async function result<T>(operation:()=>Promise<T>):Promise<Result<T>> {
  try { return {ok:true,data:await operation()}; } catch(error) {
    if(error instanceof FeesBridgeError) return {ok:false,code:error.code,message:error.message,uncertain:error.uncertain};
    return {ok:false,code:"invalid_request",message:error instanceof z.ZodError ? "Check the payment details." : "This operation is not available. Sign in again or use Fees.",uncertain:false};
  }
}

export async function searchBridgeStudentsAction(session:string,query:string,cursor:string|null) {
  await assertStaff();
  return result(()=>listBridgeStudents(z.string().regex(/^\d{4}-\d{2}$/).parse(session),z.string().max(100).parse(query),z.string().max(256).nullable().parse(cursor)));
}

export async function reviewBridgePaymentAction(input:BridgeQuoteInput,waiveLateFee:boolean) {
  await assertStaff();
  return result(async()=>{
    const body=quoteInputSchema.parse(input);
    const initial=await quoteBridgePayment({...body,lateFeeWaiverAmount:0});
    return z.boolean().parse(waiveLateFee) && initial.lateFeePending>0
      ? quoteBridgePayment({...body,lateFeeWaiverAmount:initial.lateFeePending}) : initial;
  });
}

export async function saveBridgePaymentAction(input:BridgePostInput) {
  await assertStaff();
  return result(()=>postBridgePayment(input));
}

export async function checkBridgePaymentAction(commandId:string) {
  await assertStaff();
  return result(()=>getBridgeCommand(commandId));
}
