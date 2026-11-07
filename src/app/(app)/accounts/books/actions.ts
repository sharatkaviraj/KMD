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

/** `hi` is the same message for a Hindi reader; the Books screen shows it through `tx`. */
export type ActionResult = { ok: true; message: string; hi?: string } | { ok: false; message: string; hi?: string };

/** A refusal the accountant reads, said in both languages. Anything else (a database error) stays as it came. */
class Said extends Error {
  constructor(
    message: string,
    readonly hi: string,
  ) {
    super(message);
  }
}

const ok = (message: string, hi?: string): ActionResult => ({ ok: true, message, hi });
const fail = (error: unknown): ActionResult =>
  error instanceof Said
    ? { ok: false, message: error.message, hi: error.hi }
    : error instanceof Error
      ? { ok: false, message: error.message }
      : { ok: false, message: "Could not save. Please try again.", hi: "सहेजा नहीं जा सका। फिर कोशिश करें।" };

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
    if (!isUuid(input.receiptId)) throw new Said("Pick a cheque receipt.", "चेक की रसीद चुनें।");
    await assertReceiptVisible(staff, { id: input.receiptId });
    if (!/^\d{3,12}$/.test(chequeNo)) throw new Said("Cheque number is 3 to 12 digits.", "चेक नंबर 3 से 12 अंकों का होता है।");
    if (bank.length < 2) throw new Said("Write the bank and branch.", "बैंक और शाखा लिखें।");
    if (input.chequeDate && !isDate(input.chequeDate)) throw new Said("Cheque date is not a date.", "चेक की तारीख सही नहीं है।");
    const receipt = await readReceiptBrief(input.receiptId);
    if (!receipt || receipt.mode !== "cheque") throw new Said("That receipt was not paid by cheque.", "यह रसीद चेक से नहीं भरी गई थी।");
    const db = createAdminClient();
    const { error } = await db.from("acc_cheques").upsert(
      { receipt_id: input.receiptId, cheque_no: chequeNo, bank_name: bank, cheque_date: input.chequeDate || null, created_by: staff.id },
      { onConflict: "receipt_id" },
    );
    if (error) throw new Error(error.message);
    refresh();
    return ok(`Cheque ${chequeNo} saved for ${receipt.receiptNumber}`, `${receipt.receiptNumber} के लिए चेक ${chequeNo} सहेजा`);
  } catch (error) {
    return fail(error);
  }
}

export async function createDepositSlipAction(input: { receiptIds: string[]; bankLabel: string; depositedOn: string; note?: string }): Promise<ActionResult & { slipNo?: string }> {
  try {
    const staff = await assertPermission("fees:accounts");
    await assertNotPreviewing();
    const ids = [...new Set(input.receiptIds)].filter(isUuid);
    if (ids.length === 0) throw new Said("Pick at least one cheque.", "कम से कम एक चेक चुनें।");
    if (ids.length > 60) throw new Said("A slip holds at most 60 cheques.", "एक पर्ची में ज़्यादा से ज़्यादा 60 चेक आते हैं।");
    await assertReceiptsVisible(staff, ids);
    if (!isDate(input.depositedOn)) throw new Said("Pick the deposit date.", "जमा की तारीख चुनें।");
    const bankLabel = input.bankLabel.trim() || "School account";
    const receipts = await readReceiptBriefs(ids);
    if (receipts.length !== ids.length || receipts.some((r) => r.mode !== "cheque")) throw new Said("Only cheque receipts go on a deposit slip.", "जमा पर्ची पर सिर्फ़ चेक की रसीदें आती हैं।");
    const statusOf = await latestChequeStatus(ids);
    const blocked = ids.filter((id) => !canMoveCheque(statusOf(id), "deposited"));
    if (blocked.length) throw new Said(`${blocked.length} of these cheques is already at the bank.`, `इनमें से ${blocked.length} चेक पहले से बैंक में है।`);
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
    return { ok: true, message: `${slipNo} · ${ids.length} cheques marked deposited`, hi: `${slipNo} · ${ids.length} चेक जमा दर्ज`, slipNo };
  } catch (error) {
    return fail(error);
  }
}

export async function markClearedAction(receiptIds: string[]): Promise<ActionResult> {
  try {
    const staff = await assertPermission("fees:accounts");
    await assertNotPreviewing();
    const ids = [...new Set(receiptIds)].filter(isUuid);
    if (ids.length === 0) throw new Said("Pick a cheque.", "चेक चुनें।");
    await assertReceiptsVisible(staff, ids);
    const statusOf = await latestChequeStatus(ids);
    const movable = ids.filter((id) => canMoveCheque(statusOf(id), "cleared"));
    if (movable.length === 0) throw new Said("Only a deposited cheque can clear.", "सिर्फ़ जमा हुआ चेक क्लियर हो सकता है।");
    const db = createAdminClient();
    const { error } = await db.from("acc_cheque_events").insert(movable.map((id) => ({ receipt_id: id, status: "cleared", created_by: staff.id })));
    if (error) throw new Error(error.message);
    refresh();
    return ok(movable.length === 1 ? "Cheque cleared" : `${movable.length} cheques cleared`, movable.length === 1 ? "चेक क्लियर" : `${movable.length} चेक क्लियर`);
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
    if (!isUuid(input.receiptId)) throw new Said("Pick a cheque.", "चेक चुनें।");
    await assertReceiptVisible(staff, { id: input.receiptId });
    if (!(BOUNCE_REASONS as readonly string[]).includes(input.reason)) throw new Said("Say what the bank said.", "बताएँ कि बैंक ने क्या कहा।");
    const statusOf = await latestChequeStatus([input.receiptId]);
    if (!canMoveCheque(statusOf(input.receiptId), "bounced")) throw new Said("Only a deposited cheque can bounce.", "सिर्फ़ जमा हुआ चेक बाउंस हो सकता है।");
    const receipt = await readReceiptBrief(input.receiptId);
    if (!receipt || receipt.mode !== "cheque") throw new Said("That receipt was not paid by cheque.", "यह रसीद चेक से नहीं भरी गई थी।");
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
    return ok(`Cheque marked bounced · admin asked to reverse ${receipt.receiptNumber}`, `चेक बाउंस दर्ज · एडमिन से ${receipt.receiptNumber} वापस करने को कहा`);
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
    if (input.text.length > 200_000) throw new Said("The statement is too long. Upload a week at a time.", "स्टेटमेंट बहुत लंबा है। एक बार में एक हफ़्ते का डालें।");
    const parsed = parseUpiStatement(input.text);
    if (parsed.rows.length === 0) {
      const first = parsed.errors[0];
      throw first ? new Said(`Line ${first.line}: ${first.reason}`, `लाइन ${first.line}: ${LINE_REASON_HI[first.reason] ?? first.reason}`) : new Said("No payments found in the file.", "फ़ाइल में कोई भुगतान नहीं मिला।");
    }
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
    const already = parsed.rows.length - added;
    refresh();
    return {
      ok: true,
      message: `${added} payments added${already ? ` · ${already} were already here` : ""}${parsed.errors.length ? ` · ${parsed.errors.length} lines skipped` : ""}`,
      hi: `${added} भुगतान जोड़े${already ? ` · ${already} पहले से थे` : ""}${parsed.errors.length ? ` · ${parsed.errors.length} लाइनें छोड़ीं` : ""}`,
      added,
      skipped: parsed.rows.length - added,
      errors: parsed.errors.slice(0, 5).map((e) => `Line ${e.line}: ${e.reason}`),
    };
  } catch (error) {
    return fail(error);
  }
}

/** `parseUpiStatement`'s reasons, for a Hindi reader. */
const LINE_REASON_HI: Record<string, string> = {
  "Needs date, amount, payer and UPI ref": "तारीख, राशि, भरने वाला और UPI रेफ़ चाहिए",
  "Date not understood": "तारीख समझ नहीं आई",
  "Amount must be whole rupees above 0": "राशि 0 से ऊपर पूरे रुपये में हो",
  "UPI ref looks wrong": "UPI रेफ़ गलत लगता है",
};

async function upiEvent(lineId: string, action: "match" | "unmatch" | "not_fee", receiptId: string | null): Promise<ActionResult> {
  const staff = await assertPermission("fees:accounts");
  await assertNotPreviewing();
  if (!isUuid(lineId)) throw new Said("Pick a bank line.", "बैंक की लाइन चुनें।");
  const db = createAdminClient();
  const { data: line } = await db.from("acc_upi_lines").select("id, amount").eq("id", lineId).maybeSingle();
  if (!line) throw new Said("That bank line is gone.", "वह बैंक लाइन अब नहीं है।");
  if (action === "match") {
    if (!receiptId || !isUuid(receiptId)) throw new Said("Pick a receipt.", "रसीद चुनें।");
    const receipt = await readReceiptBrief(receiptId);
    if (!receipt) throw new Said("That receipt is gone.", "वह रसीद अब नहीं है।");
    if (receipt.amount !== line.amount) throw new Said("The amounts are different — one UPI payment is one receipt.", "राशि अलग है — एक UPI भुगतान की एक ही रसीद होती है।");
    // A receipt matches one bank line at most.
    const { data: others } = await db.from("acc_upi_events").select("line_id, action, receipt_id, created_at").eq("receipt_id", receiptId).order("created_at", { ascending: false });
    for (const o of others ?? []) {
      if (o.line_id === lineId) continue;
      const { data: latest } = await db.from("acc_upi_events").select("action, receipt_id").eq("line_id", o.line_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (latest?.action === "match" && latest.receipt_id === receiptId) throw new Said(`${receipt.receiptNumber} is already matched to another payment.`, `${receipt.receiptNumber} पहले से किसी और भुगतान से मिली है।`);
    }
  }
  const { error } = await db.from("acc_upi_events").insert({ line_id: lineId, action, receipt_id: action === "match" ? receiptId : null, created_by: staff.id });
  if (error) throw new Error(error.message);
  refresh();
  return action === "match" ? ok("Matched", "मिलाया") : action === "not_fee" ? ok("Marked not a fee payment", "फीस का भुगतान नहीं, अलग रखा") : ok("Match undone", "मिलान हटाया");
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
    if (!isUuid(input.studentId)) throw new Said("Pick the family.", "परिवार चुनें।");
    await assertStudentVisible(staff, input.studentId);
    const amount = Math.trunc(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new Said("Write the amount to give back.", "लौटाने की राशि लिखें।");
    if (!(REFUND_REASONS as readonly string[]).includes(input.reason)) throw new Said("Say why.", "कारण बताएँ।");
    if (!(REFUND_METHODS as readonly string[]).includes(input.method)) throw new Said("Say how it is paid back.", "बताएँ कि पैसा कैसे लौटाना है।");
    const credit = await readStudentCredit(input.studentId);
    if (amount > credit.credit) {
      const held = `₹${credit.credit.toLocaleString("en-IN")}`;
      throw new Said(`Only ${held} is held for this family.`, `इस परिवार के सिर्फ़ ${held} जमा हैं।`);
    }
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
    return ok("Refund request sent to the admin", "रिफ़ंड का अनुरोध एडमिन को भेजा");
  } catch (error) {
    return fail(error);
  }
}

async function ownWaitingRequest(id: string, staffId: string) {
  if (!isUuid(id)) throw new Said("Pick a request.", "अनुरोध चुनें।");
  const db = createAdminClient();
  const { data } = await db.from("acc_requests").select("id, requested_by, requested_at, reminded_at, decision, withdrawn_at").eq("id", id).maybeSingle();
  if (!data) throw new Said("That request is gone.", "वह अनुरोध अब नहीं है।");
  if (data.requested_by !== staffId) throw new Said("Only the person who asked can do that.", "यह सिर्फ़ माँगने वाला ही कर सकता है।");
  if (data.decision || data.withdrawn_at) throw new Said("That request is already settled.", "यह अनुरोध पहले ही तय हो चुका है।");
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
    return ok("Request withdrawn", "अनुरोध वापस लिया");
  } catch (error) {
    return fail(error);
  }
}

export async function remindAdminAction(id: string): Promise<ActionResult> {
  try {
    const staff = await assertPermission("fees:view");
    await assertNotPreviewing();
    const row = await ownWaitingRequest(id, staff.id);
    if (!canRemind({ remindedAt: row.reminded_at, requestedAt: row.requested_at })) throw new Said("Reminded within the hour already.", "इसी घंटे में पहले ही याद दिलाया जा चुका है।");
    const db = createAdminClient();
    const { error } = await db.from("acc_requests").update({ reminded_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(error.message);
    refresh();
    return ok("The admin is reminded", "एडमिन को याद दिलाया");
  } catch (error) {
    return fail(error);
  }
}

/** The admin approves or declines. The fee write that follows is done in the fee module. */
export async function decideRequestAction(id: string, decision: "approved" | "declined", note: string): Promise<ActionResult> {
  try {
    const staff = await assertPermission("fees:manage");
    await assertNotPreviewing();
    if (!isUuid(id)) throw new Said("Pick a request.", "अनुरोध चुनें।");
    if (decision !== "approved" && decision !== "declined") throw new Said("Approve or decline.", "मंज़ूर करें या मना करें।");
    if (decision === "declined" && note.trim().length < 3) throw new Said("Say why it is declined.", "बताएँ कि क्यों मना किया।");
    const db = createAdminClient();
    const { data, error } = await db
      .from("acc_requests")
      .update({ decision, decision_note: note.trim() || null, decided_by: staff.id, decided_at: new Date().toISOString() })
      .eq("id", id)
      .is("decision", null)
      .is("withdrawn_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Said("That request is already settled.", "यह अनुरोध पहले ही तय हो चुका है।");
    refresh();
    return decision === "approved" ? ok("Approved", "मंज़ूर किया") : ok("Declined", "मना किया");
  } catch (error) {
    return fail(error);
  }
}
