"use server";

import { z } from "zod";
import { assertStaff } from "@/platform/auth/current-staff";
import { assertSessionWritable } from "@/platform/auth/test-session-access";
import { SessionAccessDenied } from "@/platform/auth/test-session-policy";
import { getBridgeOfficeCommand, postBridgeRefundDecision, postBridgeRefundProcess, postBridgeReversal } from "@/platform/fees-bridge/client";
import {
  refundDecisionInputSchema, refundProcessInputSchema, reversalInputSchema,
  type RefundDecisionInput, type RefundProcessInput, type ReversalInput,
} from "@/platform/fees-bridge/office-command-contracts";
import { FeesBridgeError } from "@/platform/fees-bridge/transport";

/**
 * Reversal and refund decisions through Fees (review F01). Each action checks
 * the session it names, then asks Fees, which runs its own engine under its
 * own permission and the person's grant. `uncertain`: the answer was lost and
 * the change may have committed — check the same command id, never a new one.
 */
export type OfficeResult<T> = { ok: true; data: T } | { ok: false; code: string; uncertain: boolean };

async function run<T>(operation: () => Promise<T>): Promise<OfficeResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    if (error instanceof FeesBridgeError) return { ok: false, code: error.code, uncertain: error.uncertain };
    if (error instanceof z.ZodError) return { ok: false, code: "invalid_request", uncertain: false };
    if (error instanceof SessionAccessDenied) return { ok: false, code: "forbidden", uncertain: false };
    return { ok: false, code: "unavailable", uncertain: false };
  }
}

export async function reverseFeesReceiptAction(input: ReversalInput) {
  const staff = await assertStaff();
  return run(async () => {
    const body = reversalInputSchema.parse(input);
    await assertSessionWritable(staff, body.sessionLabel);
    return postBridgeReversal(body);
  });
}

export async function decideFeesRefundAction(refundRequestId: string, input: RefundDecisionInput) {
  const staff = await assertStaff();
  return run(async () => {
    const body = refundDecisionInputSchema.parse(input);
    await assertSessionWritable(staff, body.sessionLabel);
    return postBridgeRefundDecision(z.uuid().parse(refundRequestId), body);
  });
}

export async function processFeesRefundAction(refundRequestId: string, input: RefundProcessInput) {
  const staff = await assertStaff();
  return run(async () => {
    const body = refundProcessInputSchema.parse(input);
    await assertSessionWritable(staff, body.sessionLabel);
    return postBridgeRefundProcess(z.uuid().parse(refundRequestId), body);
  });
}

export async function checkFeesOfficeCommandAction(commandId: string) {
  await assertStaff();
  return run(() => getBridgeOfficeCommand(z.uuid().parse(commandId)));
}
