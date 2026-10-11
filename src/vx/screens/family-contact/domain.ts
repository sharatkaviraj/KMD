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
