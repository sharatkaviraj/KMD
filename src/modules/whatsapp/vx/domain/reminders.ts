/**
 * Fee reminders on WhatsApp (design `Reminders`), as pure functions. Unit-tested
 * in `tests/vx-fee-desk-reminders.test.ts`.
 *
 * Two promises this file keeps for the screens: the count and the cost are
 * shown before anything is queued, and the message is Hindi first with the
 * English underneath. The late fee is never added to the amount quoted.
 */

/** What one approved template message costs on AiSensy, in rupees (design copy). */
export const COST_PER_MESSAGE = 0.88;

/** Rounded rupees for N messages; at least ₹1 once anything is sent. */
export function messageCost(count: number): number {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return 0;
  return Math.max(1, Math.round(n * COST_PER_MESSAGE));
}

export type TemplateId = "gentle" | "final" | "upcoming";

export const TEMPLATE_IDS: readonly TemplateId[] = ["gentle", "final", "upcoming"];

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === "string" && (TEMPLATE_IDS as readonly string[]).includes(value);
}

export type ReminderLanguage = "both" | "hi" | "en";

export function isReminderLanguage(value: unknown): value is ReminderLanguage {
  return value === "both" || value === "hi" || value === "en";
}

export type Template = { id: TemplateId; label: { en: string; hi: string }; sub: { en: string; hi: string }; hi: string; en: string };

export const TEMPLATES: Record<TemplateId, Template> = {
  gentle: {
    id: "gentle",
    label: { en: "Gentle reminder", hi: "विनम्र याद" },
    sub: { en: "Polite note with the amount and a pay button", hi: "राशि और भुगतान बटन के साथ विनम्र संदेश" },
    hi: "नमस्ते {parent} जी,\n{student} की फीस {amount} {due date} से बकाया है। कृपया जल्द जमा करें।\nधन्यवाद — श्री वीर पत्ता स्कूल, आमेट",
    en: "Dear {parent},\nThe fee of {amount} for {student} is pending since {due date}. Please pay soon.\nThank you — VPPS, Amet",
  },
  final: {
    id: "final",
    label: { en: "Firm reminder", hi: "सख़्त याद" },
    sub: { en: "Says the office will call in 3 days", hi: "3 दिन में ऑफिस फ़ोन करेगा" },
    hi: "नमस्ते {parent} जी,\n{student} की फीस {amount} {due date} से बकाया है। कृपया 3 दिन में जमा करें, नहीं तो स्कूल ऑफिस से फ़ोन आएगा।\n— श्री वीर पत्ता स्कूल, आमेट",
    en: "Dear {parent},\nThe fee of {amount} for {student} is pending since {due date}. Please pay within 3 days, or the school office will call you.\n— VPPS, Amet",
  },
  upcoming: {
    id: "upcoming",
    label: { en: "Coming up", hi: "आने वाली किस्त" },
    sub: { en: "For an installment that is not due yet", hi: "जो किस्त अभी देय नहीं है" },
    hi: "नमस्ते {parent} जी,\n{student} की अगली किस्त {amount} {due date} को देय है। समय पर जमा करने पर कोई विलंब शुल्क नहीं लगेगा।\n— श्री वीर पत्ता स्कूल, आमेट",
    en: "Dear {parent},\nThe next installment of {amount} for {student} is due on {due date}. Paying on time means no late fee.\n— VPPS, Amet",
  },
};

export const TEMPLATE_FIELDS = ["parent", "student", "amount", "due date"] as const;

export type TemplateField = (typeof TEMPLATE_FIELDS)[number];

export type TemplateValues = Record<TemplateField, string>;

export type Segment = { text: string; field: TemplateField | null };

/** A template body split into plain text and the fields filled in for each family. */
export function templateSegments(body: string, values: TemplateValues): Segment[] {
  return body
    .split(/(\{[a-z ]+\})/)
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^\{([a-z ]+)\}$/);
      const field = m && (TEMPLATE_FIELDS as readonly string[]).includes(m[1]) ? (m[1] as TemplateField) : null;
      return field ? { text: values[field], field } : { text: part, field: null };
    });
}

export function renderTemplate(body: string, values: TemplateValues): string {
  return templateSegments(body, values).map((s) => s.text).join("");
}

/** The message as the family reads it: Hindi first, then English, per the chosen language. */
export function renderMessage(id: TemplateId, language: ReminderLanguage, values: { hi: TemplateValues; en: TemplateValues }): { hi: string | null; en: string | null } {
  const t = TEMPLATES[id];
  return {
    hi: language === "en" ? null : renderTemplate(t.hi, values.hi),
    en: language === "hi" ? null : renderTemplate(t.en, values.en),
  };
}

export type AudienceFamily = {
  key: string;
  studentIds: string[];
  fatherName: string;
  kidsLine: string;
  classLabels: string[];
  pendingToday: number;
  notDueYet: number;
  usesBus: boolean;
  overdueInstallments: number[];
  /** Days since the oldest installment still owed fell due; 0 when nothing is overdue. */
  daysOverdue?: number;
  promised: boolean;
  paidLast3Days: boolean;
  left: boolean;
};

export type AudienceFilters = {
  /** Only families with an installment past its due date. Off reaches "not due yet" too. */
  pendingToday: boolean;
  inst2: boolean;
  /** Over ₹10,000. */
  big: boolean;
  bus: boolean;
  /** Class bands chosen; empty means every class. */
  bands: number[];
  excludePromised: boolean;
  excludePaidRecently: boolean;
  excludeLeft: boolean;
};

export const DEFAULT_AUDIENCE: AudienceFilters = {
  pendingToday: true,
  inst2: false,
  big: false,
  bus: false,
  bands: [],
  excludePromised: true,
  excludePaidRecently: true,
  excludeLeft: true,
};

export const BIG_REMINDER_AMOUNT = 10000;

/** Nursery–UKG, Class 1–5, Class 6–8, Class 9–10, Class 11–12. */
export const BANDS = ["Nursery–UKG", "Class 1–5", "Class 6–8", "Class 9–10", "Class 11–12"] as const;

export function bandIndexOf(classLabel: string): number {
  const label = classLabel.toLowerCase();
  if (/nursery|lkg|ukg|pre[\s-]?primary|play/.test(label)) return 0;
  const m = label.match(/(\d{1,2})/);
  const n = m ? Number(m[1]) : NaN;
  if (!Number.isFinite(n)) return 4;
  if (n <= 5) return 1;
  if (n <= 8) return 2;
  if (n <= 10) return 3;
  return 4;
}

/** What the family is reminded of: pending today, or everything still owed when that filter is off. */
export function quotedAmount(f: Pick<AudienceFamily, "pendingToday" | "notDueYet">, filters: Pick<AudienceFilters, "pendingToday">): number {
  return filters.pendingToday ? f.pendingToday : f.pendingToday + f.notDueYet;
}

/** `skip` lifts one leave-out rule, so the screen can say how many that rule removes. */
export function matchesAudience(f: AudienceFamily, filters: AudienceFilters, skip?: "promised" | "paid" | "left"): boolean {
  if (filters.excludeLeft && f.left && skip !== "left") return false;
  if (filters.excludePromised && f.promised && skip !== "promised") return false;
  if (filters.excludePaidRecently && f.paidLast3Days && skip !== "paid") return false;
  if (filters.pendingToday && f.pendingToday <= 0) return false;
  if (!filters.pendingToday && f.pendingToday + f.notDueYet <= 0) return false;
  if (filters.inst2 && !f.overdueInstallments.includes(2)) return false;
  if (filters.bands.length > 0 && !f.classLabels.some((c) => filters.bands.includes(bandIndexOf(c)))) return false;
  if (filters.big && quotedAmount(f, filters) <= BIG_REMINDER_AMOUNT) return false;
  if (filters.bus && !f.usesBus) return false;
  return true;
}

export function pickAudience(families: readonly AudienceFamily[], filters: AudienceFilters): AudienceFamily[] {
  return families.filter((f) => matchesAudience(f, filters));
}

/** How many more families a leave-out rule would let through if it were off. */
export function leftOutBy(families: readonly AudienceFamily[], filters: AudienceFilters, rule: "promised" | "paid" | "left"): number {
  const base = families.filter((f) => matchesAudience(f, filters)).length;
  return families.filter((f) => matchesAudience(f, filters, rule)).length - base;
}

/** "Pending today · Inst 2 · Class 6–8 · has bus" — the line saved with a batch. */
export function audienceLine(filters: AudienceFilters): string {
  const parts = [filters.pendingToday ? "Pending today" : "Pending or coming up"];
  if (filters.inst2) parts.push("Inst 2");
  parts.push(filters.bands.length ? filters.bands.map((b) => BANDS[b] ?? "").filter(Boolean).join(", ") : "all classes");
  if (filters.big) parts.push("over ₹10,000");
  if (filters.bus) parts.push("has bus");
  return parts.join(" · ");
}

export function parseAudience(raw: unknown): AudienceFilters {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof AudienceFilters) => (typeof r[k] === "boolean" ? (r[k] as boolean) : (DEFAULT_AUDIENCE[k] as boolean));
  const bands = Array.isArray(r.bands) ? (r.bands as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < BANDS.length) : [];
  return {
    pendingToday: bool("pendingToday"),
    inst2: bool("inst2"),
    big: bool("big"),
    bus: bool("bus"),
    bands: [...new Set(bands)].sort(),
    excludePromised: bool("excludePromised"),
    excludePaidRecently: bool("excludePaidRecently"),
    excludeLeft: bool("excludeLeft"),
  };
}

export type RuleKey = "before_due" | "on_due" | "after_due" | "weekly_90";

export const SEND_TIMES = ["10", "12", "17", "19"] as const;

export type SendTime = (typeof SEND_TIMES)[number];

export function isSendTime(value: unknown): value is SendTime {
  return typeof value === "string" && (SEND_TIMES as readonly string[]).includes(value);
}

/** Quiet hours, 8 pm – 8 am: a scheduled time inside them waits until 8 am. */
export function respectsQuietHours(hour24: number): boolean {
  return hour24 >= 8 && hour24 < 20;
}

export type RunFunnel = { sent: number; delivered: number; read: number; paid: number };

export function funnelRates(f: RunFunnel): { delivered: number; read: number; paid: number } {
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
  return { delivered: pct(f.delivered, f.sent), read: pct(f.read, f.delivered), paid: pct(f.paid, f.sent) };
}
