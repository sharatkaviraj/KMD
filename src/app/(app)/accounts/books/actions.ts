"use server";

import { revalidatePath } from "next/cache";

import {
  readReceiptBrief,
  readReceiptBriefs,
  readStudentCredit,
} from "@/modules/finance-controls/vx/books-data";
import { canMoveCheque, canRemind, nextSlipNumber, parseUpiStatement } from "@/modules/finance-controls/vx/domain/books";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertNotTestAccount, assertReceiptVisible, assertStudentVisible } from "@/platform/auth/test-session-access";
import { createAdminClient } from "@/platform/supabase/admin";
import { assertNotPreviewing } from "@/vx/view-as";

/*
 * The accountant's books. Every write here is to VPPS One's own `vppsone.acc_*`
 * tables — never a receipt, payment or refund row. A bounced cheque or a
 * refund becomes a request to the admin; the money correction itself is a
 * reversal or refund written by the fee module once approved.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

const ok = (message: string): ActionResult => ({ ok: true, message });
const fail = (error: unknown): ActionResult => ({ ok: false, message: error instanceof Error ? error.message : "Could not save. Please try again." });

function refresh() {
  revalidatePath("/accounts");
  revalidatePath("/accounts/books");
}

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

async function latestChequeStatus(receiptIds: string[]) {
  const db = createAdminClient();
  const { data, error } = await db.from("acc_cheque_events").select("receipt_id, status, created_at").in("receipt_id", receiptIds).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const map = new Map<string, "to_deposit" | "in_bag" | "deposited" | "cleared" | "bounced">();
  for (const r of data ?? []) if (!map.has(r.receipt_id)) map.set(r.receipt_id, r.status);
  return (id: string) => map.get(id) ?? "to_deposit";
}

export async function saveChequeDetailsAction(input: { receiptId: string; chequeNo: string; bank: string; chequeDate: string }): Promise<ActionResult> {
  try {
    const staff = await assertPermission("fees:accounts");
    await assertNotPreviewing();
    const chequeNo = input.chequeNo.replace(/\s+/g, "");
    const bank = input.bank.trim();
    if (!isUuid(input.receiptId)) throw new Error("Pick a cheque receipt.");
    await assertReceiptVisible(staff, { id: input.receiptId });
    if (!/^\d{3,12}$/.test(chequeNo)) throw new Error("Cheque number is 3 to 12 digits.");
    if (bank.length < 2) throw new Error("Write the bank and branch.");
    if (input.chequeDate && !isDate(input.chequeDate)) throw new Error("Cheque date is not a date.");
    const receipt = await readReceiptBrief(input.receiptId);
    if (!receipt || receipt.mode !== "cheque") throw new Error("That receipt was not paid by cheque.");
    const db = createAdminClient();
    const { error } = await db.from("acc_cheques").upsert(
      { receipt_id: input.receiptId, cheque_no: chequeNo, bank_name: bank, cheque_date: input.chequeDate || null, created_by: staff.id },
      { onConflict: "receipt_id" },
    );
    if (error) throw new Error(error.message);
    refresh();
    return ok(`Cheque ${chequeNo} saved for ${receipt.receiptNumber}`);
  } catch (error) {
    return fail(error);
  }
}

export async function createDepositSlipAction(input: { receiptIds: string[]; bankLabel: string; depositedOn: string; note?: string }): Promise<ActionResult & { slipNo?: string }> {
  try {
    const staff = await assertPermission("fees:accounts");
    await assertNotPreviewing();
    const ids = [...new Set(input.receiptIds)].filter(isUuid);
    if (ids.length === 0) throw new Error("Pick at least one cheque.");
    if (ids.length > 60) throw new Error("A slip holds at most 60 cheques.");
    await assertReceiptsVisible(staff, ids);
    if (!isDate(input.depositedOn)) throw new Error("Pick the deposit date.");
    const bankLabel = input.bankLabel.trim() || "School account";
    const receipts = await readReceiptBriefs(ids);
    if (receipts.length !== ids.length || receipts.some((r) => r.mode !== "cheque")) throw new Error("Only cheque receipts go on a deposit slip.");
    const statusOf = await latestChequeStatus(ids);
    const blocked = ids.filter((id) => !canMoveCheque(statusOf(id), "deposited"));
    if (blocked.length) throw new Error(`${blocked.length} of these cheques is already at the bank.`);
    const db = createAdminClient();
    const { data: used } = await db.from("acc_deposit_slips").select("slip_no");
    const slipNo = nextSlipNumber((used ?? []).map((r) => String(r.slip_no)));
    const total = receipts.reduce((s, r) => s + r.amount, 0);
    const { data: slip, error } = await db
      .from("acc_deposit_slips")
      .insert({ slip_no: slipNo, bank_label: bankLabel, deposited_on: input.depositedOn, total_amount: total, cheque_count: ids.length, note: input.note?.trim() || null, created_by: staff.id })
      .select("id")
      .single();
    if (error || !slip) throw new Error(error?.message ?? "Could not write the slip.");
    const { error: evError } = await db
      .from("acc_cheque_events")
      .insert(ids.map((id) => ({ receipt_id: id, status: "deposited", deposit_slip_id: slip.id, created_by: staff.id })));
    if (evError) throw new Error(evError.message);
    refresh();
    return { ok: true, message: `${slipNo} · ${ids.length} cheques marked deposited`, slipNo };
  } catch (error) {
    return fail(error);
  }
}

export async function markClearedAction(receiptIds: string[]): Promise<ActionResult> {
  try {
    const staff = await assertPermission("fees:accounts");
    await assertNotPreviewing();
    const ids = [...new Set(receiptIds)].filter(isUuid);
    if (ids.length === 0) throw new Error("Pick a cheque.");
    await assertReceiptsVisible(staff, ids);
    const statusOf = await latestChequeStatus(ids);
    const movable = ids.filter((id) => canMoveCheque(statusOf(id), "cleared"));
    if (movable.length === 0) throw new Error("Only a deposited cheque can clear.");
    const db = createAdminClient();
    const { error } = await db.from("acc_cheque_events").insert(movable.map((id) => ({ receipt_id: id, status: "cleared", created_by: staff.id })));
    if (error) throw new Error(error.message);
    refresh();
    return ok(movable.length === 1 ? "Cheque cleared" : `${movable.length} cheques cleared`);
  } catch (error) {
    return fail(error);
  }
}

const BOUNCE_REASONS = ["Not enough money", "Signature does not match", "Date or amount wrong", "Account closed", "Other"] as const;

/**
 * The bank returned a cheque. The cheque is marked bounced and the admin is
 * asked to reverse the receipt — the accountant cannot reverse, and the
 * receipt row is never edited. Nothing is sent to the parent from here.
 */
export async function bounceChequeAction(input: { receiptId: string; reason: string; note?: string }): Promise<ActionResult> {
  try {
    const staff = await assertPermission("fees:accounts");
    await assertNotPreviewing();
    if (!isUuid(input.receiptId)) throw new Error("Pick a cheque.");
    await assertReceiptVisible(staff, { id: input.receiptId });
    if (!(BOUNCE_REASONS as readonly string[]).includes(input.reason)) throw new Error("Say what the bank said.");
    const statusOf = await latestChequeStatus([input.receiptId]);
    if (!canMoveCheque(statusOf(input.receiptId), "bounced")) throw new Error("Only a deposited cheque can bounce.");
    const receipt = await readReceiptBrief(input.receiptId);
    if (!receipt || receipt.mode !== "cheque") throw new Error("That receipt was not paid by cheque.");
    const db = createAdminClient();
    const { error } = await db.from("acc_cheque_events").insert({ receipt_id: input.receiptId, status: "bounced", reason: input.reason, note: input.note?.trim() || null, created_by: staff.id });
    if (error) throw new Error(error.message);
    const { error: reqError } = await db.from("acc_requests").insert({
      kind: "reversal",
      student_id: receipt.studentId,
      receipt_id: receipt.id,
      amount: receipt.amount,
      title: `Reverse ${receipt.receiptNumber} · cheque bounced`,
      reason: `Bank returned the cheque: ${input.reason}${input.note?.trim() ? ` — ${input.note.trim()}` : ""}`,
      payload: { source: "cheque_bounce" },
      requested_by: staff.id,
    });
    if (reqError) throw new Error(reqError.message);
    refresh();
    return ok(`Cheque marked bounced · admin asked to reverse ${receipt.receiptNumber}`);
  } catch (error) {
    return fail(error);
  }
}

export async function uploadStatementAction(input: { text: string; bankLabel?: string }): Promise<ActionResult & { added?: number; skipped?: number; errors?: string[] }> {
  try {
    const staff = await assertPermission("fees:accounts");
    await assertNotPreviewing();
    // A bank statement is the whole school's money: never a test account's.
    await assertNotTestAccount(staff);
    if (input.text.length > 200_000) throw new Error("The statement is too long. Upload a week at a time.");
    const parsed = parseUpiStatement(input.text);
    if (parsed.rows.length === 0) throw new Error(parsed.errors[0] ? `Line ${parsed.errors[0].line}: ${parsed.errors[0].reason}` : "No payments found in the file.");
    const db = createAdminClient();
    const batchId = crypto.randomUUID();
    const { data, error } = await db
      .from("acc_upi_lines")
      .upsert(
        parsed.rows.map((r) => ({ batch_id: batchId, txn_at: r.txnAt, amount: r.amount, payer: r.payer, utr: r.utr, bank_label: input.bankLabel?.trim() || "School account", uploaded_by: staff.id })),
        { onConflict: "utr,amount", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw new Error(error.message);
    const added = data?.length ?? 0;
    refresh();
    return {
      ok: true,
      message: `${added} payments added${parsed.rows.length - added ? ` · ${parsed.rows.length - added} were already here` : ""}${parsed.errors.length ? ` · ${parsed.errors.length} lines skipped` : ""}`,
      added,
      skipped: parsed.rows.length - added,
      errors: parsed.errors.slice(0, 5).map((e) => `Line ${e.line}: ${e.reason}`),
    };
  } catch (error) {
    return fail(error);
  }
}

async function upiEvent(lineId: string, action: "match" | "unmatch" | "not_fee", receiptId: string | null): Promise<ActionResult> {
  const staff = await assertPermission("fees:accounts");
  await assertNotPreviewing();
  if (!isUuid(lineId)) throw new Error("Pick a bank line.");
  const db = createAdminClient();
  const { data: line } = await db.from("acc_upi_lines").select("id, amount").eq("id", lineId).maybeSingle();
  if (!line) throw new Error("That bank line is gone.");
  if (action === "match") {
    if (!receiptId || !isUuid(receiptId)) throw new Error("Pick a receipt.");
    const receipt = await readReceiptBrief(receiptId);
    if (!receipt) throw new Error("That receipt is gone.");
    if (receipt.amount !== line.amount) throw new Error("The amounts are different — one UPI payment is one receipt.");
    // A receipt matches one bank line at most.
    const { data: others } = await db.from("acc_upi_events").select("line_id, action, receipt_id, created_at").eq("receipt_id", receiptId).order("created_at", { ascending: false });
    for (const o of others ?? []) {
      if (o.line_id === lineId) continue;
      const { data: latest } = await db.from("acc_upi_events").select("action, receipt_id").eq("line_id", o.line_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (latest?.action === "match" && latest.receipt_id === receiptId) throw new Error(`${receipt.receiptNumber} is already matched to another payment.`);
    }
  }
  const { error } = await db.from("acc_upi_events").insert({ line_id: lineId, action, receipt_id: action === "match" ? receiptId : null, created_by: staff.id });
  if (error) throw new Error(error.message);
  refresh();
  return ok(action === "match" ? "Matched" : action === "not_fee" ? "Marked not a fee payment" : "Match undone");
}

export async function matchUpiAction(lineId: string, receiptId: string): Promise<ActionResult> {
  try {
    await assertPermission("fees:accounts");
    await assertReceiptVisible(null, { id: receiptId });
    return await upiEvent(lineId, "match", receiptId);
  } catch (error) {
    return fail(error);
  }
}

export async function unmatchUpiAction(lineId: string): Promise<ActionResult> {
  try {
    await assertPermission("fees:accounts");
    return await upiEvent(lineId, "unmatch", null);
  } catch (error) {
    return fail(error);
  }
}

export async function notFeeUpiAction(lineId: string): Promise<ActionResult> {
  try {
    await assertPermission("fees:accounts");
    return await upiEvent(lineId, "not_fee", null);
  } catch (error) {
    return fail(error);
  }
}

const REFUND_REASONS = ["Paid twice", "Left the school", "Paid more than the fee", "Fee changed", "Other"] as const;
const REFUND_METHODS = ["cash", "upi", "bank_transfer", "cheque"] as const;

/** Phase 3 fence: every receipt named, through its student's session. */
async function assertReceiptsVisible(staff: Parameters<typeof assertReceiptVisible>[0], receiptIds: readonly string[]) {
  for (const id of receiptIds) await assertReceiptVisible(staff, { id });
}

/** Ask the admin to approve a refund from a family's advance. No money moves here. */
export async function requestRefundAction(input: { studentId: string; amount: number; reason: string; method: string; note?: string }): Promise<ActionResult> {
  try {
    const staff = await assertPermission("fees:accounts");
    await assertNotPreviewing();
    if (!isUuid(input.studentId)) throw new Error("Pick the family.");
    await assertStudentVisible(staff, input.studentId);
    const amount = Math.trunc(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Write the amount to give back.");
    if (!(REFUND_REASONS as readonly string[]).includes(input.reason)) throw new Error("Say why.");
    if (!(REFUND_METHODS as readonly string[]).includes(input.method)) throw new Error("Say how it is paid back.");
    const credit = await readStudentCredit(input.studentId);
    if (amount > credit.credit) throw new Error(`Only ₹${credit.credit.toLocaleString("en-IN")} is held for this family.`);
    const db = createAdminClient();
    const { error } = await db.from("acc_requests").insert({
      kind: "refund",
      student_id: input.studentId,
      amount,
      title: `Refund ₹${amount.toLocaleString("en-IN")} from advance`,
      reason: `${input.reason}${input.note?.trim() ? ` — ${input.note.trim()}` : ""}`,
      payload: { method: input.method },
      requested_by: staff.id,
    });
    if (error) throw new Error(error.message);
    refresh();
    return ok("Refund request sent to the admin");
  } catch (error) {
    return fail(error);
  }
}

async function ownWaitingRequest(id: string, staffId: string) {
  if (!isUuid(id)) throw new Error("Pick a request.");
  const db = createAdminClient();
  const { data } = await db.from("acc_requests").select("id, requested_by, requested_at, reminded_at, decision, withdrawn_at").eq("id", id).maybeSingle();
  if (!data) throw new Error("That request is gone.");
  if (data.requested_by !== staffId) throw new Error("Only the person who asked can do that.");
  if (data.decision || data.withdrawn_at) throw new Error("That request is already settled.");
  return data;
}

export async function withdrawRequestAction(id: string): Promise<ActionResult> {
  try {
    const staff = await assertPermission("fees:view");
    await assertNotPreviewing();
    await ownWaitingRequest(id, staff.id);
    const db = createAdminClient();
    const { error } = await db.from("acc_requests").update({ withdrawn_at: new Date().toISOString() }).eq("id", id).is("decision", null);
    if (error) throw new Error(error.message);
    refresh();
    return ok("Request withdrawn");
  } catch (error) {
    return fail(error);
  }
}

export async function remindAdminAction(id: string): Promise<ActionResult> {
  try {
    const staff = await assertPermission("fees:view");
    await assertNotPreviewing();
    const row = await ownWaitingRequest(id, staff.id);
    if (!canRemind({ remindedAt: row.reminded_at, requestedAt: row.requested_at })) throw new Error("Reminded within the hour already.");
    const db = createAdminClient();
    const { error } = await db.from("acc_requests").update({ reminded_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(error.message);
    refresh();
    return ok("The admin is reminded");
  } catch (error) {
    return fail(error);
  }
}

/** The admin approves or declines. The fee write that follows is done in the fee module. */
export async function decideRequestAction(id: string, decision: "approved" | "declined", note: string): Promise<ActionResult> {
  try {
    const staff = await assertPermission("fees:manage");
    await assertNotPreviewing();
    if (!isUuid(id)) throw new Error("Pick a request.");
    if (decision !== "approved" && decision !== "declined") throw new Error("Approve or decline.");
    if (decision === "declined" && note.trim().length < 3) throw new Error("Say why it is declined.");
    const db = createAdminClient();
    const { data, error } = await db
      .from("acc_requests")
      .update({ decision, decision_note: note.trim() || null, decided_by: staff.id, decided_at: new Date().toISOString() })
      .eq("id", id)
      .is("decision", null)
      .is("withdrawn_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("That request is already settled.");
    refresh();
    return ok(decision === "approved" ? "Approved" : "Declined");
  } catch (error) {
    return fail(error);
  }
}
