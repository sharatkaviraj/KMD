import { p, type Pair } from "@/vx/text";

/*
 * Family contact (D-265): what actually happened when the school tried to
 * reach a child's family — tried, spoke, or a follow-up agreed with a date.
 *
 * It is a record of a conversation, not a message. Nothing here drafts or
 * sends anything; a drafted WhatsApp is not a contact until somebody records
 * how it went. Stored as `kind = 'contact'` on `vppsone.student_followups`,
 * the same history the coordinator's attention lists already read.
 */

export const CONTACT_OUTCOMES = ["attempted", "spoke", "follow_up_agreed"] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];

export const CONTACT_TEXT: Record<ContactOutcome, Pair> = {
  attempted: p("Tried, not reached", "संपर्क की कोशिश, बात नहीं हुई"),
  spoke: p("Spoke with family", "परिवार से बात हुई"),
  follow_up_agreed: p("Follow-up agreed", "आगे की बात तय हुई"),
};

export function isContactOutcome(value: unknown): value is ContactOutcome {
  return typeof value === "string" && (CONTACT_OUTCOMES as readonly string[]).includes(value);
}

/**
 * Who records a family contact: the school-wide readers (office,
 * coordinators, admin) for any child, and the class's current class teacher
 * for her own class. A subject teacher goes through the class teacher.
 */
export function canLogFamilyContact(viewer: { readsEveryClass: boolean; heldClassIds: ReadonlySet<string> }, classId: string | null): boolean {
  if (viewer.readsEveryClass) return true;
  return classId !== null && viewer.heldClassIds.has(classId);
}

export type ContactInput = { outcome: ContactOutcome; note: string | null; agreedOn: string | null };

export type ContactScope = { owner: string; sessionLabel: string; studentId: string };
export type ContactCommand = ContactScope & ContactInput & { attemptId: string; noteId: string | null };
/** Date-only amendments retain every possible in-flight candidate and UUID. */
export type ContactRequest = ContactCommand & { dateCorrections?: string[] };
export const CONTACT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Canonical comparison/recovery shape; a past date remains valid on replay. */
export function contactCommand(input: unknown): ContactCommand | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (![value.owner, value.studentId, value.attemptId].every(id => typeof id === "string" && CONTACT_UUID.test(id))) return null;
  if (typeof value.sessionLabel !== "string" || !value.sessionLabel || value.sessionLabel.length > 128) return null;
  if (value.noteId != null && (typeof value.noteId !== "string" || !CONTACT_UUID.test(value.noteId))) return null;
  const parsed = parseContact(value, "");
  if (!parsed.ok) return null;
  return { owner: value.owner as string, sessionLabel: value.sessionLabel, studentId: value.studentId as string, attemptId: value.attemptId as string, ...parsed.value, noteId: typeof value.noteId === "string" ? value.noteId : null };
}

export function contactRequest(input: unknown): ContactRequest | null {
  const original = contactCommand(input);
  if (!original) return null;
  const corrections = (input as Record<string, unknown>).dateCorrections;
  if (corrections === undefined) return original;
  if (original.outcome !== "follow_up_agreed" || !Array.isArray(corrections) || corrections.length < 1 || corrections.length > 32 || new Set(corrections).size !== corrections.length) return null;
  if (corrections.some(date => typeof date !== "string" || date === original.agreedOn || !parseContact({ ...original, agreedOn: date }, "").ok)) return null;
  return { ...original, dateCorrections: [...corrections] as string[] };
}
export function latestContactCandidate(request: ContactRequest): ContactCommand {
  return { ...contactCommand(request)!, agreedOn: request.dateCorrections?.at(-1) ?? request.agreedOn };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Tidy what the sheet sent. An agreed date is required for "follow-up
 * agreed", must not be in the past, and is dropped for the other two — the
 * database refuses the mismatch too.
 */
export function parseContact(input: { outcome?: unknown; note?: unknown; agreedOn?: unknown }, today: string): { ok: true; value: ContactInput } | { ok: false; error: Pair } {
  if (!isContactOutcome(input.outcome)) return { ok: false, error: p("Choose what happened.", "क्या हुआ, चुनें।") };
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 400) || null : null;
  if (input.outcome !== "follow_up_agreed") return { ok: true, value: { outcome: input.outcome, note, agreedOn: null } };
  const agreedOn = typeof input.agreedOn === "string" && ISO_DAY.test(input.agreedOn) ? input.agreedOn : null;
  if (agreedOn) {
    const date = new Date(`${agreedOn}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== agreedOn) {
      return { ok: false, error: p("Choose a valid agreed date.", "तय की गई सही तारीख चुनें।") };
    }
  }
  if (!agreedOn) return { ok: false, error: p("Choose the date that was agreed.", "तय हुई तारीख चुनें।") };
  if (agreedOn < today) return { ok: false, error: p("The agreed date cannot be in the past.", "तय तारीख बीती हुई नहीं हो सकती।") };
  return { ok: true, value: { outcome: input.outcome, note, agreedOn } };
}

export type ContactEntry = {
  id: string;
  outcome: ContactOutcome;
  note: string | null;
  agreedOn: string | null;
  at: string;
  by: string;
};
