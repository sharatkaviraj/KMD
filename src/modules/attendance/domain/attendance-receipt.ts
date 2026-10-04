import { SCHOOL_UTC_OFFSET_MINUTES } from "@/platform/dates";
import { t, type Localized } from "@/platform/i18n/language";

/**
 * What saving a register tells the screen (P6). A plain module, not the
 * `"use server"` file, which may export only async functions.
 *
 * Only a receipt makes a register recorded. Everything short of one is said
 * as what it is:
 *
 *  - **saved** — the receipt: who, when, the revision and the totals.
 *  - **stale** — somebody saved this register since the page was drawn. The
 *    latest receipt is shown; nothing was overwritten.
 *  - **roster_changed** — the roll for that date is not the one on the page:
 *    a child joined or left. Nothing was saved; the page reloads the roll.
 *  - **refused** — the facts say no (a future date, a closed day, no right to
 *    this class, a correction with no reason). Nothing was saved.
 *  - **error** — no definite answer. The screen asks whether the save landed
 *    before offering to send it again, with the same submission id.
 */

export type AttendanceTotals = {
  present: number;
  absent: number;
  half_day: number;
  late: number;
  leave: number;
  total: number;
};

export type AttendanceReceipt = {
  commandId: string;
  registerId: string;
  classId: string;
  day: string;
  revision: number;
  kind: "save" | "correction" | "imported";
  savedAt: string;
  actorStaffId: string | null;
  actorName: string | null;
  onBehalfOf: string | null;
  totals: AttendanceTotals;
  /** How many children this revision changed. */
  changes: number;
  replayed: boolean;
};

export type AttendanceSaveState =
  | { status: "idle" }
  | { status: "saved"; receipt: AttendanceReceipt }
  | { status: "stale"; latest: AttendanceReceipt | null; message: Localized }
  | { status: "roster_changed"; joined: string[]; left: string[]; message: Localized }
  | { status: "refused"; message: Localized }
  | { status: "error"; message: Localized };

export const idleAttendanceState: AttendanceSaveState = { status: "idle" };

/** The database's receipt, in the screen's shape. */
export function toAttendanceReceipt(row: Record<string, unknown>): AttendanceReceipt {
  const totals = (row.totals ?? {}) as Partial<AttendanceTotals>;
  return {
    commandId: String(row.command_id),
    registerId: String(row.register_id),
    classId: String(row.class_id),
    day: String(row.day),
    revision: Number(row.revision),
    kind: row.kind as AttendanceReceipt["kind"],
    savedAt: String(row.saved_at),
    actorStaffId: (row.actor_staff_id as string | null) ?? null,
    actorName: (row.actor_name as string | null) ?? null,
    onBehalfOf: (row.on_behalf_of as string | null) ?? null,
    totals: {
      present: totals.present ?? 0,
      absent: totals.absent ?? 0,
      half_day: totals.half_day ?? 0,
      late: totals.late ?? 0,
      leave: totals.leave ?? 0,
      total: totals.total ?? 0,
    },
    changes: Number(row.changes ?? 0),
    replayed: Boolean(row.replayed),
  };
}

/** "09:12", in school time, for "saved at". */
export function schoolClockTime(iso: string): string {
  const at = new Date(new Date(iso).getTime() + SCHOOL_UTC_OFFSET_MINUTES * 60_000);
  return `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`;
}

/** The totals in words, leaving out what is zero. */
export function totalsSentence(totals: AttendanceTotals): Localized {
  const hi = [
    `${totals.present} उपस्थित`,
    totals.absent > 0 ? `${totals.absent} अनुपस्थित` : null,
    totals.half_day > 0 ? `${totals.half_day} आधा दिन` : null,
    totals.late > 0 ? `${totals.late} देर से` : null,
    totals.leave > 0 ? `${totals.leave} छुट्टी` : null,
  ];
  const en = [
    `${totals.present} present`,
    totals.absent > 0 ? `${totals.absent} absent` : null,
    totals.half_day > 0 ? `${totals.half_day} half day` : null,
    totals.late > 0 ? `${totals.late} late` : null,
    totals.leave > 0 ? `${totals.leave} on leave` : null,
  ];
  return { hi: hi.filter(Boolean).join(" · "), en: en.filter(Boolean).join(" · ") };
}

/**
 * The receipt in one line: who, when, which revision.
 *
 * "by" comes before the time in English and after the name in Hindi, so the
 * whole line is built per language rather than glued from parts.
 */
export function receiptLine(receipt: AttendanceReceipt): Localized {
  return revisionLine(receipt);
}

/** The same line for any revision in a register's history. */
export function revisionLine(entry: {
  kind: AttendanceReceipt["kind"];
  revision: number;
  actorName: string | null;
  savedAt: string;
}): Localized {
  const time = schoolClockTime(entry.savedAt);
  const who = entry.actorName ?? "—";
  const corrected = entry.kind === "correction";
  return {
    hi: corrected
      ? `${who} ने ${time} पर सुधारा · संशोधन ${entry.revision}`
      : `${who} ने ${time} पर सहेजा · संशोधन ${entry.revision}`,
    en: corrected
      ? `Corrected by ${who} at ${time} · revision ${entry.revision}`
      : `Saved by ${who} at ${time} · revision ${entry.revision}`,
  };
}

/** The database's refusals, in words a teacher can act on. */
export const attendanceRefusals: Record<string, Localized> = {
  stale: t(
    "यह रजिस्टर किसी और ने अभी सहेजा है। नई स्थिति देखें।",
    "Someone else saved this register meanwhile. Look at what they saved.",
  ),
  roster_changed: t(
    "जब से पेज खुला, कक्षा की सूची बदल गई है। नई सूची देखें और फिर सहेजें।",
    "The class list changed since you opened it. Check the new list and save again.",
  ),
  not_permitted: t(
    "आप इस कक्षा का रजिस्टर नहीं सहेज सकते।",
    "You cannot save this class's register.",
  ),
  future_day: t("आगे की तारीख़ की उपस्थिति नहीं ली जा सकती।", "Attendance cannot be taken for a day that has not happened."),
  school_closed: t("उस दिन स्कूल बंद था।", "The school was closed that day."),
  empty_roster: t("उस दिन कक्षा में कोई बच्चा नहीं था।", "Nobody was on the class list that day."),
  not_saved_yet: t(
    "यह रजिस्टर अभी सहेजा ही नहीं गया — सुधार से पहले सहेजें।",
    "This register has not been saved yet — save it before correcting it.",
  ),
  reason_required: t("सुधार का कारण लिखें।", "Say why you are correcting it."),
  no_change: t("कुछ नहीं बदला — सुधार के लिए कम से कम एक बच्चा बदलें।", "Nothing changed — change at least one child to correct it."),
  id_reused: t(
    "यह फ़ॉर्म पहले ही किसी और बदलाव के लिए भेजा जा चुका है। पेज फिर से खोलें।",
    "This form was already used for a different change. Reload the page.",
  ),
  request_not_pending: t(
    "यह अनुरोध पहले ही तय हो चुका है, या आपका अपना है।",
    "That request has already been decided, or it is your own.",
  ),
  bad_request: t("कुछ अधूरा भेजा गया। पेज फिर से खोलें।", "Something was missing. Reload the page."),
  failed: t(
    "सहेजा नहीं जा सका। फिर से कोशिश करना सुरक्षित है — जो सहेजा गया वह दोबारा नहीं होगा।",
    "Not saved. Trying again is safe — a save that did land will not be made twice.",
  ),
};
