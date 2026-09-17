import { z } from "zod";

import {
  encodeMessage,
  t,
  type Language,
  type Localized,
} from "@/platform/i18n/language";
import type { CollectionField } from "@/modules/collection/domain/fields";

/**
 * A request, and who may open it.
 *
 * Ported from `sampark/src/lib/auth/token.ts`, which says of itself that it is
 * the one place authorization lives and that a bug in it is the expensive
 * kind. The same is true here, so the *rule* is a pure function with tests and
 * the database read is somewhere else.
 *
 * A token resolves to exactly one request: one class, one field set, one
 * roll. There is no navigation past it and no way to reach another.
 */

export const requestStatuses = ["draft", "open", "closed"] as const;
export type RequestStatus = (typeof requestStatuses)[number];

export const requestStatusLabels: Record<RequestStatus, Localized> = {
  draft: t("मसौदा", "Draft"),
  open: t("खुला", "Open"),
  closed: t("बंद", "Closed"),
};

export type CollectionRequest = {
  id: string;
  sessionLabel: string;
  /**
   * The title, as authored. **One half may be null**, because the office types
   * it in whichever language it thinks in and asking for both doubles the most
   * common task in the app (B-05). `readAuthored()` decides what a given
   * reader sees and whether it fell back.
   */
  titleHi: string | null;
  titleEn: string | null;
  classId: string;
  classLabel: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  language: Language;
  token: string;
  dueDate: string | null;
  status: RequestStatus;
  reasonHi: string | null;
  reasonEn: string | null;
  openedAt: string | null;
  closedAt: string | null;
  fields: CollectionField[];
};

export type TokenRejection = "not_found" | "closed";

export type TokenCheck = { ok: true } | { ok: false; reason: TokenRejection };

/**
 * Whether a link still opens.
 *
 * **A passed due date is not a rejection.** The deadline is a deadline for the
 * teacher and the office, not an authorization boundary: an overdue link keeps
 * working until somebody deliberately closes it. A teacher finishing on Sunday
 * evening what was due Friday is the normal case, and a link that had locked
 * itself would turn her work into a phone call to the office.
 *
 * A draft has never been sent, so it is not "closed" — but it does not open
 * either, and from outside the two are the same 404 (see below).
 */
export function checkRequestAccess(request: {
  status: RequestStatus;
}): TokenCheck {
  if (request.status === "open") return { ok: true };
  return { ok: false, reason: "closed" };
}

/**
 * Every rejection renders the same 404.
 *
 * An unknown token and a deliberately closed one must be indistinguishable
 * from outside: telling a stranger "that link exists but is closed" is telling
 * them their guess was right.
 */
export const TOKEN_REJECTION_IS_ALWAYS_404 = true;

/* -------------------------------------------------------------- the ask */

export type RollRow = {
  studentId: string;
  rollNo: string | null;
  fullName: string;
  fatherName: string | null;
  /**
   * What the school held **when this link went out**, per field key.
   *
   * From the frozen member snapshot, not re-derived (S-02, B-07). A legacy
   * request made before rounds existed falls back to today’s record, because
   * an old link rendering as an empty class is a worse answer than a rebuilt
   * one.
   */
  current: Record<string, string | null>;
  /** What this link has already been answered with, per field key. */
  answered: Record<string, string | null>;
  /**
   * One line about this child on this link — "number belongs to an uncle".
   * Set from the office’s uploaded ask list; null for an ordinary round.
   */
  askNote?: string | null;
};

/**
 * How much of a request is done.
 *
 * Counted over (child × field), not over children: a request asking three
 * things of forty children is a hundred and twenty answers, and a progress
 * line that counted children would sit at zero until the first child was
 * finished completely.
 */
export type Completeness = {
  expected: number;
  answered: number;
  students: number;
  studentsDone: number;
  percent: number;
};

export function completeness(roll: RollRow[], fields: CollectionField[]): Completeness {
  const expected = roll.length * fields.length;
  let answered = 0;
  let studentsDone = 0;

  for (const row of roll) {
    let forThisChild = 0;
    for (const field of fields) {
      if (isAnswered(row, field)) forThisChild += 1;
    }
    answered += forThisChild;
    if (fields.length > 0 && forThisChild === fields.length) studentsDone += 1;
  }

  return {
    expected,
    answered,
    students: roll.length,
    studentsDone,
    percent: expected === 0 ? 0 : Math.round((answered / expected) * 100),
  };
}

/**
 * Whether this child's answer for this field is in.
 *
 * A `confirm` field counts as answered when the school already holds a value
 * *and* the teacher has been through the row — which is what a submission
 * records, even when the submission says "unchanged". A `collect` field needs
 * an actual value. Both are the same question from the teacher's side: has
 * anybody looked at this?
 */
export function isAnswered(row: RollRow, field: CollectionField): boolean {
  return Object.prototype.hasOwnProperty.call(row.answered, field.key);
}

/** The children still owing something, in roll order. */
export function outstandingRows(
  roll: RollRow[],
  fields: CollectionField[],
): RollRow[] {
  return roll.filter((row) => fields.some((field) => !isAnswered(row, field)));
}

/* ----------------------------------------------------------- validation */

/** An optional authored half: trimmed, length-capped, blank becomes null. */
const authoredLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: encodeMessage(t("बहुत लंबा है", "That is too long")) })
    .transform((value) => (value === "" ? null : value))
    .nullable();

export const requestSchema = z.object({
  // Neither half is required on its own; the refinement below asks for one of
  // them. Requiring both is what made a one-language school type every title
  // twice (B-05, PLAN §3a).
  titleHi: authoredLine(120),
  titleEn: authoredLine(120),
  classId: z.uuid({
    message: encodeMessage(t("कक्षा चुनें", "Choose a class")),
  }),
  assignedStaffId: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable(),
  fieldIds: z.array(z.uuid()).min(1, {
    message: encodeMessage(
      t("कम से कम एक जानकारी चुनें", "Choose at least one thing to ask for"),
    ),
  }),
  dueDate: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .refine((value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), {
      message: encodeMessage(t("तारीख़ चुनें", "Choose a date")),
    }),
  reasonHi: z
    .string()
    .trim()
    .max(300)
    .transform((value) => (value === "" ? null : value))
    .nullable(),
  reasonEn: z
    .string()
    .trim()
    .max(300)
    .transform((value) => (value === "" ? null : value))
    .nullable(),
});

/**
 * One title, in whichever language it was typed.
 *
 * A refinement rather than two required fields, and reported against
 * `titleHi` so the message lands on a field the form actually renders — an
 * error attached to nothing at all is an error nobody sees.
 */
export const requestInputSchema = requestSchema.refine(
  (value) => Boolean(value.titleHi ?? value.titleEn),
  {
    path: ["titleHi"],
    message: encodeMessage(t("शीर्षक भरें", "Give it a title")),
  },
);

export type RequestInput = z.infer<typeof requestSchema>;

/* ---------------------------------------------------------------- links */

/**
 * The three public paths, and what each is for.
 *
 * `/w/` exists because a WhatsApp template's URL button is approved with its
 * base URL fixed and the app may only append one value at send time. Whether a
 * "/" inside that value survives Meta and the provider is a question that costs
 * several re-approvals to get wrong, so the value is a bare token and `/w/`
 * works out what it names. It redirects and does nothing else.
 */
export const REQUEST_PATH = "/r";
export const STAFF_PATH = "/t";
export const WHATSAPP_PATH = "/w";

export function requestUrl(origin: string, token: string): string {
  return `${origin}${REQUEST_PATH}/${token}`;
}

export function staffUrl(origin: string, token: string): string {
  return `${origin}${STAFF_PATH}/${token}`;
}

/** Whether a path is one of the token links, for the proxy's allow-list. */
export function isPublicTokenPath(pathname: string): boolean {
  return [REQUEST_PATH, STAFF_PATH, WHATSAPP_PATH].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * A ready-made WhatsApp message, for the human who presses send.
 *
 * `wa.me` opens the person's own WhatsApp with the text filled in — it sends
 * nothing by itself, which is exactly the property D-10 asks for. The template
 * path through the provider is for volume; this is for one teacher, now.
 */
export function waMeLink(phone: string, message: string): string {
  return `https://wa.me/91${phone}?text=${encodeURIComponent(message)}`;
}
