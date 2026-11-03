/**
 * The tail: what the fees app writes after the cutover watermark, and how
 * One treats it (plan §7.8, §12.1; critique0 #4, #5, #6, #8, #11; critique1
 * A7, B12). Pure.
 */

/** Days a Path B (one-tap checkout) link stays usable — fees checkout-send.ts CHECKOUT_LINK_DAYS. */
export const CHECKOUT_LINK_DAYS = 21;

function addDays(isoDate, days) {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function istDate(timestamp) {
  return new Date(Date.parse(timestamp) + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/**
 * When the fees app's pay links stop taking money (critique0 #5):
 *  - Path B: a send whose pay_scope opens the one-tap checkout, usable until
 *    created_at + 21 days;
 *  - Path A: any send with a pay code, usable until pay_code_expires_on — and
 *    with NO end when that is null (counted as open-ended).
 * The tail ends at the later of the two. HDFC static-QR payments are a manual
 * tail with no end date and are not in this figure.
 *
 * sends: whatsapp_reminder_sends rows (pay_code, pay_code_expires_on,
 * pay_scope, created_at). asOf: 'YYYY-MM-DD' (IST) for the open counts.
 */
export function tailEnd(sends, { asOf } = {}) {
  let pathBEnd = null;
  let pathAEnd = null;
  let openEnded = 0;
  let openPathA = 0;
  let openPathB = 0;
  for (const send of sends) {
    if (!send?.pay_code) continue;
    if (send.pay_scope && send.created_at) {
      const end = addDays(istDate(send.created_at), CHECKOUT_LINK_DAYS);
      if (!pathBEnd || end > pathBEnd) pathBEnd = end;
      if (asOf && end >= asOf) openPathB += 1;
    }
    if (send.pay_code_expires_on) {
      const end = String(send.pay_code_expires_on).slice(0, 10);
      if (!pathAEnd || end > pathAEnd) pathAEnd = end;
      if (asOf && end >= asOf) openPathA += 1;
    } else {
      openEnded += 1;
    }
  }
  const candidates = [pathBEnd, pathAEnd].filter(Boolean).sort();
  return {
    pathBEnd,
    pathAEnd,
    tailEnd: openEnded ? null : candidates.at(-1) ?? null,
    openEndedPayCodes: openEnded,
    openPathA,
    openPathB,
  };
}

/**
 * Is this audit row after the watermark? `created_at` orders audit_logs (its
 * id is a uuid); rows at exactly the watermark instant are after it unless
 * they were in the snapshot's tie set.
 */
/**
 * @param {{ id: string, created_at: string }} auditRow
 * @param {{ auditMaxCreatedAt: string | null, auditIdsAtMax?: string[] }} watermark
 */
export function afterWatermark(auditRow, { auditMaxCreatedAt, auditIdsAtMax = [] }) {
  if (!auditMaxCreatedAt) return true;
  const at = Date.parse(auditRow.created_at);
  const mark = Date.parse(auditMaxCreatedAt);
  if (at > mark) return true;
  if (at < mark) return false;
  return !auditIdsAtMax.includes(auditRow.id);
}

/**
 * Fees tables the tail is expected to touch. Anything else written in the
 * fees app after the watermark is an ALERT: somebody is still working in the
 * fees app (student edits, discounts, family links, desk postings, reminder
 * runs — critique0 #6).
 */
export const TAIL_EXPECTED = new Set([
  "online_payment_orders", "online_payment_order_lines", "online_payment_intents",
  "online_payment_captures", "online_payment_events", "online_payment_audit",
  "notification_outbox", "audit_logs", "user_activity_events", "workbook_materialized_view_refresh_queue",
  "office_sync_events", "notion_sync_log", "backup_runs", "job_runs", "session_reconcile_log",
  // The fees app's own crons keep running against its database (critique1 B12):
  "collection_closures", "installments", "student_repayment_emi_late_fees", "defaulter_recovery_state",
]);

/**
 * One change -> { expected, why }. `row` is the live row (null when gone).
 * Conditional tables: receipts and payments only for online money; waivers
 * only the automatic online ones; sends only receipt/reversal notices.
 */
export function classifyTailChange(table, row, { op, receiptModes } = {}) {
  if (op === "DELETE") return { expected: false, why: "a delete in the fees app" };
  if (table === "receipts") {
    return row?.payment_mode === "online"
      ? { expected: true, why: "online receipt" }
      : { expected: false, why: `desk receipt (${row?.payment_mode ?? "unknown"})` };
  }
  if (table === "payments") {
    const mode = receiptModes?.get(String(row?.receipt_id));
    return mode === "online" ? { expected: true, why: "online allocation" } : { expected: false, why: "desk allocation" };
  }
  if (table === "student_late_fee_waivers") {
    return row?.source === "online_payment" ? { expected: true, why: "online waiver" } : { expected: false, why: `waiver (${row?.source ?? "unknown"})` };
  }
  if (table === "whatsapp_reminder_sends") {
    return ["receipt", "reversal"].includes(row?.notice_kind)
      ? { expected: true, why: "receipt notice" }
      : { expected: false, why: `${row?.notice_kind ?? "unknown"} send` };
  }
  if (TAIL_EXPECTED.has(table)) return { expected: true, why: "tail table" };
  return { expected: false, why: "write outside the tail allow-list" };
}

/**
 * What tail-sync does with one live row, given what One already holds:
 *   'review'   a fees receipt: recorded in vppsone.tail_receipts_review,
 *              never inserted (critique0 #8)
 *   'evidence' payments, captures, audit, and the order lines and intents
 *              that settled a fees receipt (their receipt_id names a receipt
 *              that is in the review queue, never in public.receipts):
 *              attached to that receipt's review row
 *   'upsert'   online_payment_events, on provider_event_id; the fees row
 *              replaces only One's 'ignored' twin (critique1 A7)
 *   'insert'   absent in One; inserted after the terminal rules, in
 *              TAIL_INSERT_ORDER, if every foreign-key parent is in One or
 *              in the same batch (planTailInserts) — else deferred
 *   'skip'     already in One (insert-only: updates are not applied), or a
 *              table tail-sync never writes (notification_outbox, …)
 *   'defer'    a send whose receipt is not in One
 */
/**
 * @param {string} table
 * @param {any} row
 * @param {{ existsInOne?: boolean, receiptInOne?: (id: string) => boolean }} [options]
 */
export function tailAction(table, row, { existsInOne = false, receiptInOne = () => true } = {}) {
  switch (table) {
    case "receipts":
      return "review";
    case "payments":
    case "online_payment_captures":
    case "online_payment_audit":
      return "evidence";
    case "online_payment_order_lines":
    case "online_payment_intents":
      // An accounted intent or a paid line points at the fees receipt that
      // went to the review queue: inserting it would violate its receipt FK.
      if (row?.receipt_id && !receiptInOne(row.receipt_id)) return "evidence";
      return existsInOne ? "skip" : "insert";
    case "online_payment_events":
      return "upsert";
    case "online_payment_orders":
    case "whatsapp_campaign_runs":
      return existsInOne ? "skip" : "insert";
    case "whatsapp_reminder_sends":
    case "school_notice_sends":
      if (existsInOne) return "skip";
      if (row?.receipt_id && !receiptInOne(row.receipt_id)) return "defer";
      return "insert";
    default:
      return "skip";
  }
}

/**
 * Insert order, parents first: a send's run, then sends, then the orders
 * and intents that hang off a send, then order lines (FKs read from wtgx,
 * 30 Oct: orders.send_id, intents.send_id -> whatsapp_reminder_sends;
 * sends.run_id -> whatsapp_campaign_runs; lines.order_id -> orders).
 */
export const TAIL_INSERT_ORDER = [
  "whatsapp_campaign_runs",
  "whatsapp_reminder_sends",
  "school_notice_sends",
  "online_payment_orders",
  "online_payment_intents",
  "online_payment_order_lines",
];

/**
 * Which candidate rows can be inserted, in TAIL_INSERT_ORDER, and which wait.
 * A row is inserted only when every non-null foreign key it carries points at
 * a row that is in One (`parentExists`) or is inserted earlier in this batch;
 * otherwise it is deferred with the reasons (a send for a student admitted in
 * the fees app after T0, an order on a deferred send, …). Deferred rows are
 * read again by the next tail-sync, which sees every change since the
 * watermark. `ON CONFLICT DO NOTHING` does not catch a foreign-key violation,
 * so without this one such row rolled back the whole apply. Pure.
 *
 *   candidates: { table: rows[] }
 *   fks: catalog FKs whose child is in `public`: [{ name, child, childCols,
 *        parentSchema, parent, parentCols }]
 *   parentExists(schema, table, column, value) -> boolean
 */
/**
 * @param {Record<string, any[]>} candidates
 * @param {{ fks: any[], parentExists: (schema: string, table: string, column: string, value: string) => boolean }} options
 * @returns {{ insert: Record<string, any[]>, defer: Record<string, Array<{ row: any, missing: string[] }>> }}
 */
export function planTailInserts(candidates, { fks, parentExists }) {
  /** @type {Record<string, any[]>} */
  const insert = {};
  /** @type {Record<string, Array<{ row: any, missing: string[] }>>} */
  const defer = {};
  const batch = new Map(); // "table.column" -> Set of values inserted in this batch
  const inBatch = (table, column, value) => batch.get(`${table}.${column}`)?.has(value) ?? false;
  for (const table of TAIL_INSERT_ORDER) {
    const tableFks = fks.filter((fk) => fk.child === table && (fk.childSchema ?? "public") === "public");
    for (const row of candidates[table] ?? []) {
      const missing = [];
      for (const fk of tableFks) {
        if (fk.childCols.length !== 1) {
          if (fk.childCols.some((c) => row?.[c] != null)) missing.push(`${fk.name} (multi-column, unchecked)`);
          continue;
        }
        const value = row?.[fk.childCols[0]];
        if (value === null || value === undefined) continue;
        const v = String(value);
        const schema = fk.parentSchema ?? "public";
        if (schema === "public" && inBatch(fk.parent, fk.parentCols[0], v)) continue;
        if (parentExists(schema, fk.parent, fk.parentCols[0], v)) continue;
        missing.push(`${fk.childCols[0]} -> ${schema}.${fk.parent}`);
      }
      if (missing.length) {
        (defer[table] ??= []).push({ row, missing });
        continue;
      }
      (insert[table] ??= []).push(row);
      for (const [column, value] of Object.entries(row ?? {})) {
        if (value === null || value === undefined || typeof value === "object") continue;
        const key = `${table}.${column}`;
        if (!batch.has(key)) batch.set(key, new Set());
        batch.get(key).add(String(value));
      }
    }
  }
  return { insert, defer };
}

/** A review row from a fees receipt and its evidence. Ids and amounts only. */
/**
 * @param {any} receipt
 * @param {{ payments?: any[], lines?: any[], captures?: any[], intents?: any[] }} evidence
 * @param {string} sourceProject
 */
export function reviewRow(receipt, { payments = [], lines = [], captures = [], intents = [] } = {}, sourceProject) {
  return {
    source_project: sourceProject,
    fees_receipt_id: receipt.id,
    receipt_number: receipt.receipt_number,
    student_id: receipt.student_id,
    payment_date: receipt.payment_date,
    payment_mode: String(receipt.payment_mode),
    total_amount: receipt.total_amount,
    client_request_id: receipt.client_request_id ?? null,
    reference_number: receipt.reference_number ?? null,
    fees_created_at: receipt.created_at ?? null,
    evidence: {
      payments: payments
        .filter((p) => p.receipt_id === receipt.id)
        .map((p) => ({ id: p.id, installment_id: p.installment_id, amount: p.amount, pending_before_posting: p.pending_before_posting, pending_after_posting: p.pending_after_posting })),
      orderLines: lines
        .filter((l) => l.receipt_id === receipt.id)
        .map((l) => ({ id: l.id, order_id: l.order_id, amount_rupees: l.amount_rupees })),
      captures: captures
        .filter((c) => c.receipt_id === receipt.id)
        .map((c) => ({ id: c.id, provider_payment_id: c.provider_payment_id, amount_paise: c.amount_paise, application_status: c.application_status })),
      intents: intents
        .filter((i) => i.receipt_id === receipt.id)
        .map((i) => ({ id: i.id, status: i.status, amount_rupees: i.amount_rupees, provider_link_id: i.provider_link_id ?? null })),
    },
  };
}
