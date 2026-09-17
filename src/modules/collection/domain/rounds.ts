import { z } from "zod";

import { encodeMessage, t } from "@/platform/i18n/language";
import {
  emptyAudience,
  isAudienceEmpty,
  type Audience,
} from "@/modules/collection/domain/audience";

/**
 * A round, as a form and as a URL.
 *
 * **The selection lives in the URL.** Every choice the office makes is a query
 * parameter, so the preview is a server render of the real resolver rather
 * than a number the browser worked out from what it happens to have loaded
 * (D-139). Back works, a half-built round can be sent to somebody to look at,
 * and the screen ships no JavaScript of its own — which is the difference
 * between usable and not on the connection this is opened on.
 *
 * Pure: what a round's form means. The reads are `data/rounds-repo.ts`.
 */

/** An optional authored half: trimmed, length-capped, blank becomes null. */
const authoredLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: encodeMessage(t("बहुत लंबा है", "That is too long")) })
    .transform((value) => (value === "" ? null : value))
    .nullable();

export const roundSchema = z.object({
  // One half is enough, like a request's title (B-05, D-129).
  titleHi: authoredLine(120),
  titleEn: authoredLine(120),
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
  reasonHi: authoredLine(300),
  reasonEn: authoredLine(300),
});

export const roundInputSchema = roundSchema.refine(
  (value) => Boolean(value.titleHi ?? value.titleEn),
  {
    path: ["titleHi"],
    message: encodeMessage(t("शीर्षक भरें", "Give it a title")),
  },
);

export type RoundFormInput = z.infer<typeof roundSchema>;

/* ------------------------------------------------------------ the URL */

type Params = Record<string, string | string[] | undefined>;

const list = (value: string | string[] | undefined): string[] => {
  if (value === undefined) return [];
  const all = Array.isArray(value) ? value : [value];
  return [...new Set(all.flatMap((entry) => entry.split(",")).map((entry) => entry.trim()).filter(Boolean))];
};

/**
 * Read the audience out of the query string.
 *
 * Unknown parameters are ignored and unreadable ones are dropped, in the one
 * direction that is safe: dropping narrows (D-150). A URL somebody has edited
 * by hand cannot widen a send.
 */
export function audienceFromParams(params: Params): Audience {
  const classIds = list(params.class);

  return {
    ...emptyAudience,
    classIds,
    houses: list(params.house),
    routeIds: list(params.route),
    search: typeof params.q === "string" ? params.q : "",
    gaps: list(params.gap).map((fieldKey) => ({ fieldKey })),
    // `all=1` is the deliberate "everybody", and it is ignored the moment any
    // class is ticked — otherwise a leftover parameter from an earlier click
    // silently turns "Class 6" back into the whole school.
    allEnrolled: params.all === "1" && classIds.length === 0,
    studentIds: [],
    notes: {},
    from: null,
  };
}

/** The same audience as a query string, so the form can rebuild its own URL. */
export function audienceToParams(audience: Audience): URLSearchParams {
  const params = new URLSearchParams();

  for (const id of audience.classIds) params.append("class", id);
  for (const house of audience.houses) params.append("house", house);
  for (const route of audience.routeIds) params.append("route", route);
  for (const gap of audience.gaps) params.append("gap", gap.fieldKey);

  if (audience.search.trim()) params.set("q", audience.search.trim());
  if (audience.allEnrolled && audience.classIds.length === 0) params.set("all", "1");

  return params;
}

export function roundHref(audience: Audience): string {
  const search = audienceToParams(audience).toString();
  return search ? `/collection/rounds/new?${search}` : "/collection/rounds/new";
}

/* ------------------------------------------------------- the rules */

/**
 * Whether this round needs the office to say why.
 *
 * **A subset of a class reads as a broken list.** A teacher sent nine of her
 * forty-six children with no explanation assumes the link is wrong, and the
 * conscientious ones ring the office to check — so a narrowed audience has to
 * carry a reason and a whole-class one does not need to invent one (S-03).
 *
 * Whole classes, and everybody, are the two selections that explain
 * themselves. Everything else narrows within a class and does not.
 */
export function needsReason(audience: Audience): boolean {
  if (isAudienceEmpty(audience)) return false;
  if (audience.allEnrolled && audience.gaps.length === 0 && !audience.search.trim()) {
    return false;
  }

  return (
    audience.gaps.length > 0 ||
    audience.search.trim() !== "" ||
    audience.houses.length > 0 ||
    audience.routeIds.length > 0 ||
    audience.studentIds.length > 0
  );
}

/** Whether the office has given one, in either language. */
export function hasReason(round: {
  reasonHi: string | null;
  reasonEn: string | null;
}): boolean {
  return Boolean(
    (round.reasonHi ?? "").trim() !== "" || (round.reasonEn ?? "").trim() !== "",
  );
}

export const roundStatusLabels = {
  draft: t("बना हुआ", "Written down"),
  open: t("भेजा गया", "Sent"),
  closed: t("बंद", "Closed"),
} as const;

export function roundStatusLabel(status: string) {
  return (
    roundStatusLabels[status as keyof typeof roundStatusLabels] ?? {
      hi: status,
      en: status,
    }
  );
}
