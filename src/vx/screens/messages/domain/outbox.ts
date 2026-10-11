/*
 * Messages → To send, as pure functions. Unit-tested in `tests/vx-outbox.test.ts`.
 *
 * Nothing in VPPS One sends a WhatsApp message (D-10, CLAUDE.md rule 8). The
 * To send list is where a person does: each row opens their own WhatsApp with
 * the text filled in (`wa.me` sends nothing until they press send there), and
 * the row is marked sent by them. A few minutes are allowed to undo a tap that
 * did not end in a send.
 */

import { renderMessage, type ReminderLanguage, type TemplateId } from "@/modules/whatsapp/vx/domain/reminders";

import { tenDigits } from "./messages";

/** How long after marking a row sent it can still be put back. */
export const UNDO_MINUTES = 10;

export type OutboxSource = "send" | "queue";

/** The one text a parent receives: Hindi, then English, whichever are there. */
export function outboxText(hi: string | null | undefined, en: string | null | undefined): string {
  return [hi, en].map((t) => (t ?? "").trim()).filter(Boolean).join("\n\n");
}

/** A wa.me link for an Indian mobile number, or null when the number is not one. */
export function waLink(phone: string | null | undefined, text: string): string | null {
  const ten = tenDigits(phone);
  return ten ? `https://wa.me/91${ten}?text=${encodeURIComponent(text)}` : null;
}

export function canUndo(sentAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!sentAt) return false;
  const at = Date.parse(sentAt);
  return Number.isFinite(at) && now.getTime() - at <= UNDO_MINUTES * 60_000;
}

/** A calendar notice's audience as the campaigns it becomes. */
export function noticeCampaigns(audience: string): ("school" | "staff")[] {
  if (audience === "staff") return ["staff"];
  if (audience === "both") return ["school", "staff"];
  return ["school"];
}

/* --------------------------------------------------- fee reminder messages */

/** One installment row of the fee app's workbook view, as the reminder needs it. */
export type DueRow = {
  studentId: string;
  studentName: string;
  fatherName: string | null;
  phone: string | null;
  dueDate: string;
  pending: number;
};

export type ReminderMessage = {
  phone: string;
  parent: string;
  studentIds: string[];
  amount: number;
  dueDate: string;
  hi: string;
  en: string;
};

/**
 * One message per family for a fee reminder batch, worked out from what is
 * owed now rather than when the batch was queued — a family that has paid
 * since gets nothing. Late fee is never in the amount (RULES B): `pending`
 * is the fee alone.
 *
 * `gentle` and `final` quote what is overdue today, from the oldest due date;
 * `upcoming` quotes the next installment not yet due.
 */
export function reminderMessages(
  rows: readonly DueRow[],
  template: TemplateId,
  language: ReminderLanguage,
  today: string,
  formatAmount: (n: number) => string,
  formatDate: (iso: string) => string,
): { messages: ReminderMessage[]; noPhone: number; nothingOwed: number } {
  type Fam = { phone: string | null; parent: string; kids: Map<string, string>; rows: DueRow[] };
  const families = new Map<string, Fam>();
  for (const r of rows) {
    const phone = tenDigits(r.phone);
    const key = phone ? `p:${phone}` : `s:${r.studentId}`;
    const f: Fam = families.get(key) ?? { phone, parent: r.fatherName?.trim() || r.studentName, kids: new Map(), rows: [] };
    f.kids.set(r.studentId, r.studentName);
    f.rows.push(r);
    families.set(key, f);
  }

  const messages: ReminderMessage[] = [];
  let noPhone = 0;
  let nothingOwed = 0;
  for (const f of families.values()) {
    const owing = f.rows.filter((r) => r.pending > 0);
    let pick: DueRow[];
    let dueDate: string;
    if (template === "upcoming") {
      const next = owing.filter((r) => r.dueDate > today).map((r) => r.dueDate).sort()[0];
      pick = next ? owing.filter((r) => r.dueDate === next) : [];
      dueDate = next ?? "";
    } else {
      pick = owing.filter((r) => r.dueDate <= today);
      dueDate = pick.map((r) => r.dueDate).sort()[0] ?? "";
    }
    const amount = Math.round(pick.reduce((s, r) => s + r.pending, 0));
    if (amount <= 0) {
      nothingOwed += 1;
      continue;
    }
    if (!f.phone) {
      noPhone += 1;
      continue;
    }
    const student = [...new Set(pick.map((r) => f.kids.get(r.studentId) ?? r.studentName))].map((n) => n.split(/\s+/)[0]).join(", ");
    const values = { parent: f.parent, student, amount: formatAmount(amount), "due date": formatDate(dueDate) };
    const text = renderMessage(template, language, { hi: values, en: values });
    messages.push({
      phone: f.phone,
      parent: f.parent,
      studentIds: [...new Set(pick.map((r) => r.studentId))],
      amount,
      dueDate,
      hi: text.hi ?? "",
      en: text.en ?? "",
    });
  }
  messages.sort((a, b) => a.parent.localeCompare(b.parent));
  return { messages, noPhone, nothingOwed };
}
