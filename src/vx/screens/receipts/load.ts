import "server-only";

import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { getDeskReceipt, lastReceiptDate, loadDeskReceipts } from "@/modules/receipts/vx/data";
import { isDaySpan, isIsoDate, latestCloseState, spanRange, type DaySpan } from "@/modules/receipts/vx/domain/day-close";
import { allowedReceiptSheet, parseReceiptSheet } from "@/modules/receipts/vx/domain/reverse-sheet";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { feePermissionsFor } from "@/platform/auth/fee-roles";
import { schoolToday } from "@/vx/format";

import { listCloseEvents, pendingReversalRequest, pendingReversalsBySession, staffNamesForUsers } from "./data";
import type { DeskProps, DeskRow, HistoryEvent, SelectedReceipt } from "./types";

type Search = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Everything /receipts and /receipts/[receiptNumber] draw, from the URL. */
export async function loadReceiptsDesk(staff: CurrentStaff, search: Search, receiptNumber?: string): Promise<DeskProps> {
  const today = schoolToday();
  const dateParam = one(search.date);
  const anchor = isIsoDate(dateParam) && dateParam <= today ? dateParam : today;
  const spanParam = one(search.span);
  const span: DaySpan = isDaySpan(spanParam) ? spanParam : "today";
  const { from, to } = spanRange(span, anchor);
  const view = one(search.view) === "close" ? "close" : "list";

  const viewSession = await resolveViewSession({ searchParamSession: search.session ?? null, cookieSession: await getViewSessionCookie() });
  const sessionLabel = viewSession.sessionLabel;

  const [{ rows, truncated }, events, selectedRaw, waiting] = await Promise.all([
    loadDeskReceipts(sessionLabel, from, to),
    listCloseEvents(anchor, anchor, { strict: true, sessionLabel }),
    receiptNumber ? getDeskReceipt(receiptNumber) : Promise.resolve(null),
    // A marker, never a gate: an unreadable list only hides the marker.
    pendingReversalsBySession(sessionLabel).catch(() => new Map<string, { amount: number; reasonCode: string; by: string | null }>()),
  ]);
  const lastDate = rows.length === 0 ? await lastReceiptDate(anchor, sessionLabel) : null;

  const slim: DeskRow[] = rows.map((r) => ({
    id: r.id,
    receiptNumber: r.receiptNumber,
    paymentDate: r.paymentDate,
    createdAt: r.createdAt,
    paymentMode: r.paymentMode,
    totalAmount: r.totalAmount,
    isReversed: r.isReversed,
    receivedBy: r.receivedBy,
    studentFullName: r.studentFullName,
    admissionNo: r.admissionNo,
    classLabel: r.classLabel,
    reversalAsked: !r.isReversed && waiting.has(r.id),
  }));
  const waitingReversals = rows
    .filter((r) => r.paymentDate === anchor && !r.isReversed && waiting.has(r.id))
    .map((r) => ({ receiptNumber: r.receiptNumber, amount: waiting.get(r.id)?.amount ?? r.totalAmount, mode: r.paymentMode }));

  let selected: SelectedReceipt | null = null;
  if (selectedRaw) {
    const d = selectedRaw.detail;
    const reversedEvents = selectedRaw.history.filter((h) => h.kind === "reversed");
    const [pending, names, dayEvents] = await Promise.all([
      pendingReversalRequest(d.id),
      reversedEvents.length ? staffNamesForUsers(reversedEvents.map((h) => h.by)).catch(() => new Map<string, string>()) : Promise.resolve(new Map<string, string>()),
      // Is the receipt's own day closed? Reversing it changes a counted day.
      d.paymentDate === anchor ? Promise.resolve(events) : listCloseEvents(d.paymentDate, d.paymentDate, { sessionLabel }).catch(() => []),
    ]);
    const history: HistoryEvent[] = selectedRaw.history.map(({ by, ...h }) => (h.kind === "reversed" ? { ...h, byName: by ? (names.get(by) ?? null) : null } : h));
    // The request is part of the receipt's story: who asked, when and why (smoke 20 Oct).
    if (pending && !selectedRaw.isReversed) {
      history.push({ at: pending.createdAt, kind: "asked", byName: pending.requestedByName, reasonCode: pending.reasonCode, note: pending.note });
      history.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    }
    const lastReversal = [...history].reverse().find((h) => h.kind === "reversed");
    selected = {
      id: d.id,
      receiptNumber: d.receiptNumber,
      studentFullName: d.studentFullName,
      admissionNo: d.admissionNo,
      classLabel: d.classLabel,
      fatherName: d.fatherName,
      fatherPhone: d.fatherPhone,
      paymentDate: d.paymentDate,
      createdAt: d.createdAt,
      paymentMode: d.paymentMode,
      referenceNumber: d.referenceNumber,
      totalAmount: d.totalAmount,
      reversedAmount: d.reversedAmount ?? 0,
      isReversed: selectedRaw.isReversed,
      receivedBy: d.receivedBy ?? d.createdByName,
      sessionLabel: d.sessionLabel,
      // A reversed receipt still shows what it was written for, so its lines add
      // up to its total under the REVERSED stamp (was "Installment 2 ₹0" over
      // "Total received ₹1").
      heads: d.breakdown.map((b) => ({ label: b.installmentLabel, amount: selectedRaw.isReversed ? b.originalAmount : b.amount })),
      share: selectedRaw.share,
      history,
      pendingRequest: pending ? { at: pending.createdAt, by: pending.requestedByName, reasonCode: pending.reasonCode, note: pending.note } : null,
      dayClosed: latestCloseState(dayEvents).closed,
      discountGiven: Math.max(0, d.discountAmount ?? 0),
      lateFeeWaived: Math.max(0, d.lateFeeWaived ?? 0),
      reversal: selectedRaw.isReversed && lastReversal ? { at: lastReversal.at, byName: lastReversal.byName ?? null, note: lastReversal.note ?? null } : null,
    };
  }

  const fee = feePermissionsFor(staff.role);
  const close = latestCloseState(events);
  const perms = {
    collect: can(staff, "fees:collect"),
    // Closing the day and asking for a reversal are the back office (D-261).
    accounts: can(staff, "fees:accounts"),
    reverse: fee.includes("payments:reverse_any"),
    reopen: can(staff, "fees:manage"),
    print: fee.includes("receipts:print"),
    dayBook: fee.includes("finance:view"),
  };
  return {
    today,
    anchor,
    span,
    from,
    to,
    view,
    sessionLabel,
    rows: slim,
    truncated,
    lastDate,
    closeEvent: close.closed && close.event ? close.event : null,
    lastReopen: [...events].reverse().find((e) => e.action === "reopen") ?? null,
    waitingReversals,
    selected,
    // A reversed receipt (or a viewer who may not ask) never opens the reverse
    // sheet from the URL; the page replaces such a URL with one without it (B08).
    sheet: allowedReceiptSheet(
      parseReceiptSheet(one(search.sheet)),
      selected ? { isReversed: selected.isReversed, remaining: Math.max(0, selected.totalAmount - selected.reversedAmount), hasPendingRequest: Boolean(selected.pendingRequest) } : null,
      perms.accounts,
      perms.reverse,
    ),
    initial: { mode: one(search.mode), staff: one(search.staff), query: one(search.q) },
    perms,
  };
}
