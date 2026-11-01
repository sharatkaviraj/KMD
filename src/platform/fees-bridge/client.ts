import "server-only";

import { z } from "zod";
import { assertPermission, assertStaff, type CurrentStaff } from "@/platform/auth/current-staff";
import { createClient } from "@/platform/supabase/server";
import { assertNotPreviewing } from "@/vx/view-as";
import { assertBridgeSession, feesBridgeOrigin, feesBridgeWritesEnabled, usesCanonicalFees } from "./policy";
import { bridgeRequest, FeesBridgeError } from "./transport";
import {
  commandSchema, postedPaymentSchema, postInputSchema, quoteInputSchema, studentDetailSchema,
  quoteSchema, receiptSchema, sessionsSchema, studentListSchema,
  type BridgePostInput, type BridgeQuoteInput,
} from "./contracts";

async function credentials(staff: CurrentStaff, sessionLabel?: string) {
  if (!usesCanonicalFees(staff, sessionLabel)) {
    throw new FeesBridgeError("not_available", "The live Fees connection is not available for this account or session.");
  }
  if (sessionLabel !== undefined) assertBridgeSession(sessionLabel);
  const client = await createClient();
  // getSession supplies the token only after assertStaff/getClaims verified the user.
  // The source independently validates this exact token and its explicit actor grant.
  const {data,error} = await client.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token || data.session?.user.id !== staff.userId) {
    throw new FeesBridgeError("unauthorized", "Sign in again to use the live Fees connection.");
  }
  return {token,key:process.env.FEES_BRIDGE_KEY?.trim() ?? "",origin:feesBridgeOrigin()};
}

export async function listBridgeStudents(sessionLabel: string, query = "", cursor: string | null = null) {
  const staff = await assertPermission("fees:view");
  const queryParams = new URLSearchParams({session:sessionLabel,limit:"50",q:query.trim().slice(0,100)});
  if (cursor) queryParams.set("cursor",cursor);
  return bridgeRequest({...(await credentials(staff,sessionLabel)),path:`/students?${queryParams}`,schema:studentListSchema});
}

export async function getBridgeStudent(studentId: string, sessionLabel: string) {
  const staff = await assertPermission("fees:view");
  z.uuid().parse(studentId);
  return bridgeRequest({...(await credentials(staff,sessionLabel)),path:`/students/${studentId}?${new URLSearchParams({session:sessionLabel})}`,schema:studentDetailSchema});
}

export async function getBridgeSessions() {
  const staff = await assertStaff();
  const result=await bridgeRequest({...(await credentials(staff)),path:"/sessions",schema:sessionsSchema});
  return {sessions:result.sessions.filter(row=>/^\d{4}-\d{2}$/.test(row.sessionLabel))};
}

export async function quoteBridgePayment(input: BridgeQuoteInput) {
  const staff = await assertPermission("fees:collect");
  const body = quoteInputSchema.parse(input);
  const quote=await bridgeRequest({...(await credentials(staff,body.sessionLabel)),path:"/quote",body,schema:quoteSchema});
  if(quote.student.id!==body.studentId || quote.student.sessionLabel!==body.sessionLabel || quote.amount!==body.amount || quote.paymentDate!==body.paymentDate || quote.quickDiscountAmount!==body.quickDiscountAmount || quote.lateFeeWaiverAmount!==body.lateFeeWaiverAmount)throw new FeesBridgeError("invalid_response","The Fees quote did not match this request.");
  return quote;
}

export async function postBridgePayment(input: BridgePostInput) {
  const staff = await assertPermission("fees:collect");
  await assertNotPreviewing();
  if (!feesBridgeWritesEnabled()) throw new FeesBridgeError("read_only", "Collect in the Fees app while One's payment desk is read-only.");
  const body = postInputSchema.parse(input);
  const receipt = await bridgeRequest({...(await credentials(staff,body.sessionLabel)),path:"/payments",body,schema:postedPaymentSchema});
  if (receipt.commandId !== body.commandId || receipt.studentId !== body.studentId || receipt.sessionLabel !== body.sessionLabel || receipt.amountReceived !== body.amount) {
    throw new FeesBridgeError("invalid_response", "The Fees response did not match this payment. Check its status.", true);
  }
  return receipt;
}

export async function getBridgeCommand(commandId: string) {
  const staff = await assertPermission("fees:collect");
  z.uuid().parse(commandId);
  const result = await bridgeRequest({...(await credentials(staff)),path:`/commands/${commandId}`,schema:commandSchema});
  if(result.commandId !== commandId) throw new FeesBridgeError("invalid_response","The Fees response did not match this payment. Check its status.",true);
  return result;
}

export async function getBridgeReceipt(receiptId: string, sessionLabel: string) {
  const staff = await assertPermission("fees:view");
  z.uuid().parse(receiptId);
  const receipt=await bridgeRequest({...(await credentials(staff,sessionLabel)),path:`/receipts/${receiptId}?${new URLSearchParams({session:sessionLabel})}`,schema:receiptSchema});
  if(receipt.receiptId!==receiptId || receipt.student.sessionLabel!==sessionLabel)throw new FeesBridgeError("invalid_response","The Fees receipt did not match this request.");
  return receipt;
}
