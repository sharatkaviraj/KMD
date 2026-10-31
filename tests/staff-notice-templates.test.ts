import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { KINDS, OUTBOX_KINDS, STAFF_MESSAGE_KINDS, seededKindsMap } from "@/modules/staff-notices/domain/kinds";
import {
  assertNoPhoneNumber,
  NOTICE_TEMPLATES,
  renderDigest,
  renderNotice,
  renderPayloadNotice,
  renderReminder,
  REMINDER_TEMPLATE,
  rupees,
  studentLabel,
  type PayloadKind,
} from "@/modules/staff-notices/domain/notices";
import { fillTemplate, placeholderCount, STAFF_TEMPLATES, TEACHER_TASK_TEMPLATES } from "@/modules/staff-notices/domain/templates";

/**
 * Every staff WhatsApp template (go-live Phase F): what the app sends equals
 * the body the owner submits, slot for slot; the migration registers exactly
 * these bodies; no message carries a phone number; a child is named only when
 * the school allows it. Synthetic names and numbers only (rule 6).
 */

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20261031101234_staff_whatsapp_consent_and_gates.sql"),
  "utf8",
).replace(/\r\n/g, "\n");
const DOC = readFileSync(join(process.cwd(), "docs/cutover/STAFF-WHATSAPP.md"), "utf8").replace(/\r\n/g, "\n");
const sqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;

const ctx = { staffName: "Test Teacher", origin: "https://one.example.test", studentNames: false } as const;

const PAYLOADS: Record<PayloadKind, Record<string, unknown>> = {
  marks_reminder: { papers: "5-A Maths, 6-B Science" },
  weekly_summary: { summary: "Attendance 92%.", from: "Test Coordinator" },
  staff_broadcast: { hi: "कल छुट्टी है।", en: "Tomorrow is a holiday." },
  online_review: { capture_id: "c1", amount_rupees: 4500, student_name: "Test Child", class_label: "5 A" },
  online_payment: { receipt_id: "r1", receipt_number: "SVP-1042", amount_rupees: 5000, student_name: "Test Child", class_label: "5 A" },
  day_collection: { date: "2026-11-02", total_rupees: 125000, receipts: 42, by_mode: { cash: 80000, upi: 45000 } },
  day_not_closed: { date: "2026-11-02", receipts: 12, total_rupees: 30000 },
  money_request: { request_id: "q1", request_kind: "write_off", amount: 1200, student_name: "Test Child", class_label: "5 A", requested_by_name: "Test Accountant" },
  money_decision: { request_id: "q1", request_kind: "reversal", decision: "declined", amount: 1200, student_name: "Test Child", class_label: "5 A" },
  leave_requested: { leave_id: "l1", teacher_name: "Test Teacher Two", from_day: "2026-11-03", to_day: "2026-11-04" },
  leave_decided: { leave_id: "l1", from_day: "2026-11-03", to_day: "2026-11-03", decision: "approved" },
};

const PAYLOAD_KINDS = Object.keys(PAYLOADS) as PayloadKind[];

describe("every kind has its template, written down once", () => {
  it("names a template with a body for every outbox kind, and the digest", () => {
    for (const kind of OUTBOX_KINDS) expect(STAFF_TEMPLATES[KINDS[kind].template], kind).toBeDefined();
    expect(STAFF_TEMPLATES.vx_staff_digest_v1).toBeDefined();
    expect(NOTICE_TEMPLATES.cover_assigned).toBe(KINDS.cover_assigned.template);
    expect(REMINDER_TEMPLATE).toBe(KINDS.attendance_reminder.template);
  });

  it("settles the reminder's name on the four-slot one the outbox sends", () => {
    expect(REMINDER_TEMPLATE).toBe("vppsone_staff_attendance_reminder");
    expect(MIGRATION).toContain("update vppsone.message_templates set is_active = false, updated_at = now()\nwhere code = 'vppsone_attendance_reminder' and is_active;");
  });

  it("uses every placeholder in order with none skipped, in both languages", () => {
    for (const [code, body] of Object.entries(STAFF_TEMPLATES)) {
      for (const text of [body.hi, body.en]) {
        const used = new Set([...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
        const count = placeholderCount(text);
        expect(count, code).toBe(body.variables.length);
        for (let i = 1; i <= count; i += 1) expect(used.has(i), `${code} {{${i}}}`).toBe(true);
      }
    }
  });

  it("registers every new body in message_templates exactly as written here", () => {
    const keep = new Set(["vppsone_marks_reminder", "vppsone_weekly_summary", "vx_staff_notice"]);
    for (const [code, body] of Object.entries(STAFF_TEMPLATES)) {
      if (keep.has(code)) continue;
      expect(MIGRATION, code).toContain(`(${sqlString(code)}, ${sqlString(body.label.hi)}, ${sqlString(body.label.en)}, ${sqlString(body.hi)}, ${sqlString(body.en)},`);
    }
  });

  it("lists every body, Hindi and English, in docs/cutover/STAFF-WHATSAPP.md for the owner to submit", () => {
    for (const [code, body] of Object.entries(STAFF_TEMPLATES)) {
      expect(DOC, code).toContain(code);
      expect(DOC, `${code} hi`).toContain(body.hi);
      expect(DOC, `${code} en`).toContain(body.en);
    }
  });

  it("lists the six teacher-task templates too, each body as the delivery migration registered it (review of PR #148)", () => {
    const delivery = readFileSync(join(process.cwd(), "supabase/migrations/20261016090000_teacher_task_delivery.sql"), "utf8").replace(/\r\n/g, "\n");
    const codes = Object.keys(TEACHER_TASK_TEMPLATES).sort();
    expect(codes).toHaveLength(6);
    // The delivery's claim accepts exactly these six names.
    for (const code of codes) expect(delivery).toContain(`'${code}'`);
    expect(KINDS.teacher_task.template).toBe("vppsone_teacher_task_*_v1");
    for (const [code, template] of Object.entries(TEACHER_TASK_TEMPLATES)) {
      expect(code).toMatch(/^vppsone_teacher_task_(reminder_)?(en|hi|both)_v1$/);
      expect(code.endsWith(`_${template.language}_v1`), code).toBe(true);
      expect(delivery, code).toContain(`('${code}','`);
      expect(delivery, code).toContain(`,${sqlString(template.body)},`);
      expect(placeholderCount(template.body), code).toBe(template.variables.length);
      expect(template.buttonUrl).toBe("https://one.vpps.co.in/t/tasks/{{1}}");
      expect(DOC, code).toContain(`#### \`${code}\``);
      expect(DOC, `${code} body`).toContain(template.body);
    }
    expect(DOC).toContain("https://one.vpps.co.in/t/tasks/{{1}}");
  });

  it("seeds the kinds switch exactly as the domain does", () => {
    const seeded = seededKindsMap();
    const match = MIGRATION.match(/\('staff_notice_kinds_enabled', true,\n\s+'(\{[^']+\})'::jsonb/);
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1])).toEqual(seeded);
    expect(Object.keys(seeded).sort()).toEqual([...STAFF_MESSAGE_KINDS].sort());
  });
});

describe("what the app sends is the submitted body, filled", () => {
  it.each(PAYLOAD_KINDS)("%s: text equals the template filled with its values, in both languages", (kind) => {
    const en = renderPayloadNotice(kind, PAYLOADS[kind], { ...ctx, language: "en" });
    const hi = renderPayloadNotice(kind, PAYLOADS[kind], { ...ctx, language: "hi" });
    const body = STAFF_TEMPLATES[en.templateCode];
    expect(en.templateCode).toBe(KINDS[kind].template);
    expect(en.params).toHaveLength(body.variables.length);
    if (kind !== "staff_broadcast") {
      expect(en.text.en).toBe(fillTemplate(body.en, en.params));
      expect(hi.text.hi).toBe(fillTemplate(body.hi, hi.params));
    }
    for (const value of [...en.params, ...hi.params]) expect(value.trim().length, kind).toBeGreaterThan(0);
  });

  it("the cover notices and the register reminder fill their bodies too", () => {
    for (const kind of ["cover_assigned", "cover_changed", "cover_cancelled", "cover_escalation"] as const) {
      const hi = renderNotice({ kind, staffName: "Test Teacher", language: "hi", day: "2026-11-02", period: 2, periodTime: "10:00–10:40", classLabels: ["5 A"], subjectCode: "MAT", link: "https://x.test/duty/1" });
      expect(hi.text.hi).toBe(fillTemplate(STAFF_TEMPLATES[hi.templateCode].hi, hi.params));
      expect(hi.params).toHaveLength(6);
    }
    const reminder = renderReminder({ staffName: "Test Teacher", language: "hi", day: "2026-11-02", classLabel: "5 A", link: "https://x.test/r" });
    expect(reminder.text.hi).toBe(fillTemplate(STAFF_TEMPLATES[REMINDER_TEMPLATE].hi, reminder.params));
  });

  it("sends the reader's language: Hindi for `both`, as every bilingual screen leads", () => {
    const both = renderPayloadNotice("leave_decided", PAYLOADS.leave_decided, { ...ctx, language: "both" });
    const hi = renderPayloadNotice("leave_decided", PAYLOADS.leave_decided, { ...ctx, language: "hi" });
    expect(both.params).toEqual(hi.params);
  });

  it("a digest names the count and the kind, and links to where they all are", () => {
    const digest = renderDigest("online_payment", 5, { ...ctx, language: "en" });
    expect(digest.templateCode).toBe("vx_staff_digest_v1");
    expect(digest.params).toEqual(["Test Teacher", "5", "Online payment received", "https://one.example.test/fees/payments/online"]);
  });
});

describe("a child is named only when the school allows it (default off)", () => {
  it("says the class, never the name, with the switch off", () => {
    for (const kind of ["online_review", "online_payment", "money_request", "money_decision"] as const) {
      const off = renderPayloadNotice(kind, PAYLOADS[kind], { ...ctx, language: "en", studentNames: false });
      expect(JSON.stringify(off), kind).not.toContain("Test Child");
      expect(off.text.en, kind).toContain("a student of 5 A");
      const on = renderPayloadNotice(kind, PAYLOADS[kind], { ...ctx, language: "en", studentNames: true });
      expect(on.text.en, kind).toContain("Test Child");
    }
  });

  it("falls back to 'a student' with no class either", () => {
    expect(studentLabel({}, false)).toEqual({ hi: "एक विद्यार्थी", en: "a student" });
    expect(studentLabel({ student_name: "Test Child" }, false).en).toBe("a student");
  });
});

describe("no phone number in any staff message", () => {
  it.each([
    "9876543210",
    "+91 98765 43210",
    "919876543210",
    "98765-43210",
  ])("refuses %s", (phone) => {
    expect(() => assertNoPhoneNumber({ params: [`call ${phone}`], text: { hi: "", en: "" } })).toThrow();
    expect(() =>
      renderPayloadNotice("staff_broadcast", { hi: `फ़ोन ${phone}`, en: `phone ${phone}` }, { ...ctx, language: "en" }),
    ).toThrow();
  });

  it("lets amounts, dates and receipt numbers through", () => {
    expect(() => assertNoPhoneNumber({ params: ["₹12,50,000", "SVP-2026-27-5001", "2026-11-02", "1234567890"], text: { hi: "", en: "" } })).not.toThrow();
  });

  it("no rendered payload kind carries one", () => {
    for (const kind of PAYLOAD_KINDS) {
      const rendered = renderPayloadNotice(kind, PAYLOADS[kind], { ...ctx, language: "en", studentNames: true });
      expect(() => assertNoPhoneNumber(rendered)).not.toThrow();
    }
  });
});

describe("rupees", () => {
  it("groups the Indian way, whole rupees", () => {
    expect(rupees(125000)).toBe("₹1,25,000");
    expect(rupees(999)).toBe("₹999");
    expect(rupees("4500.4")).toBe("₹4,500");
    expect(rupees(null)).toBe("₹0");
  });
});
