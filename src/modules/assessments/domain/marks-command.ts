import { z } from "zod";

import { encodeMessage, t, type Localized } from "@/platform/i18n/language";

/**
 * One save of one paper's marks (P7). A plain module: the `"use server"` file
 * may export only async functions.
 *
 * Four kinds, and they mean different things to a teacher:
 *
 *   draft       — keep what I have typed. Blanks are allowed and stay blank.
 *   submit      — I am done: every child has a mark, an absence or an
 *                 exemption. Submitting approves nothing and issues nothing.
 *   correction  — change a submitted paper, with a reason. It stays complete.
 *   reopen      — the exam coordinator hands a submitted paper back.
 *
 * Every save names the revision the page showed and carries a submission id
 * minted once, so a double press returns the first receipt and a save made
 * on a stale page is refused rather than written over somebody else's.
 */

export const markEntryStates = ["blank", "value", "absent", "exempt"] as const;
export type MarkEntryState = (typeof markEntryStates)[number];

export const marksKinds = ["draft", "submit", "correction", "reopen"] as const;
export type MarksKind = (typeof marksKinds)[number];

export const saveMarksSchema = z
  .object({
    commandId: z.uuid(),
    paperId: z.uuid(),
    kind: z.enum(marksKinds),
    expectedRevision: z.number().int().min(0),
    reason: z
      .string()
      .trim()
      .max(300, { message: encodeMessage(t("कारण बहुत लंबा है", "That reason is too long")) })
      .nullish()
      .transform((value) => (value ? value : null)),
    entries: z.array(
      z.object({
        studentId: z.uuid(),
        state: z.enum(markEntryStates),
        value: z.number().min(0).nullable(),
      }),
    ),
  })
  .refine((value) => value.kind !== "correction" || value.reason !== null, {
    message: encodeMessage(t("बदलाव का कारण लिखें", "Say why you are changing a submitted mark")),
    path: ["reason"],
  });

export type SaveMarksInput = z.infer<typeof saveMarksSchema>;

/**
 * Who may do what with one paper (P7).
 *
 * Marks are the subject teacher's: the one the published timetable assigns to
 * this subject in this class. A class teacher reads her class's papers but
 * does not thereby enter every subject. The exam coordinator and the
 * administrator may enter any paper and are the only ones who hand a
 * submitted paper back. The database decides it all again.
 */
export function paperAuthority(input: {
  isManager: boolean;
  isAssigned: boolean;
  hasWritePermission: boolean;
}): { enter: boolean; reopen: boolean; reason?: Localized } {
  const enter = input.isManager || (input.isAssigned && input.hasWritePermission);
  if (enter) return { enter: true, reopen: input.isManager };
  return {
    enter: false,
    reopen: false,
    reason: t(
      "इस कक्षा में यह विषय आपका नहीं है — अंक इसके विषय-अध्यापक भरेंगे।",
      "This subject is not yours in this class — its subject teacher enters these marks.",
    ),
  };
}

export type MarksCounts = { entered: number; absent: number; exempt: number; blank: number; total: number };

export type MarksReceipt = {
  commandId: string;
  paperId: string;
  kind: MarksKind;
  revision: number;
  entryStatus: "open" | "submitted";
  savedAt: string;
  actorName: string | null;
  changed: number;
  counts: MarksCounts;
  replayed: boolean;
};

export function toMarksReceipt(row: Record<string, unknown>): MarksReceipt {
  const counts = (row.counts ?? {}) as Partial<MarksCounts>;
  return {
    commandId: String(row.command_id),
    paperId: String(row.paper_id),
    kind: row.kind as MarksKind,
    revision: Number(row.revision),
    entryStatus: row.entry_status === "submitted" ? "submitted" : "open",
    savedAt: String(row.saved_at),
    actorName: (row.actor_name as string | null) ?? null,
    changed: Number(row.changed ?? 0),
    counts: {
      entered: Number(counts.entered ?? 0),
      absent: Number(counts.absent ?? 0),
      exempt: Number(counts.exempt ?? 0),
      blank: Number(counts.blank ?? 0),
      total: Number(counts.total ?? 0),
    },
    replayed: Boolean(row.replayed),
  };
}

export type MarksSaveState =
  | { status: "idle" }
  | { status: "saved"; receipt: MarksReceipt }
  | { status: "stale"; message: Localized }
  | { status: "incomplete"; blank: string[]; message: Localized }
  | { status: "invalid"; who: string | null; message: Localized }
  | { status: "refused"; message: Localized }
  | { status: "error"; message: Localized };

export const idleMarksState: MarksSaveState = { status: "idle" };

/** The receipt in one line, built per language because word order differs. */
export function marksReceiptLine(receipt: MarksReceipt, time: string): Localized {
  const who = receipt.actorName ?? "—";
  const { entered, absent, exempt, blank, total } = receipt.counts;
  const hiParts = [
    `${entered}/${total} अंक`,
    absent > 0 ? `${absent} अनुपस्थित` : null,
    exempt > 0 ? `${exempt} छूट` : null,
    blank > 0 ? `${blank} बाकी` : null,
  ];
  const enParts = [
    `${entered} of ${total} marked`,
    absent > 0 ? `${absent} absent` : null,
    exempt > 0 ? `${exempt} exempt` : null,
    blank > 0 ? `${blank} still blank` : null,
  ];
  const hiLead =
    receipt.kind === "submit"
      ? `${who} ने ${time} पर जमा किए`
      : receipt.kind === "correction"
        ? `${who} ने ${time} पर सुधारे`
        : receipt.kind === "reopen"
          ? `${who} ने ${time} पर फिर खोला`
          : `${who} ने ${time} पर मसौदा सहेजा`;
  const enLead =
    receipt.kind === "submit"
      ? `Submitted by ${who} at ${time}`
      : receipt.kind === "correction"
        ? `Corrected by ${who} at ${time}`
        : receipt.kind === "reopen"
          ? `Reopened by ${who} at ${time}`
          : `Draft saved by ${who} at ${time}`;
  return {
    hi: [hiLead, ...hiParts].filter(Boolean).join(" · "),
    en: [enLead, ...enParts].filter(Boolean).join(" · "),
  };
}

/** The database's refusals, in words a teacher can act on. */
export const marksRefusals: Record<string, Localized> = {
  stale: t(
    "यह पेपर किसी और ने अभी सहेजा है। पेज फिर से खोलें — आपके भरे अंक इसी फ़ोन पर रखे हैं।",
    "Someone else saved this paper meanwhile. Reload — what you typed is kept on this phone.",
  ),
  incomplete: t(
    "जमा करने से पहले हर बच्चे के अंक, अनुपस्थित या छूट भरें। खाली को शून्य नहीं माना जाता।",
    "Before submitting, give every child a mark, Absent or Exempt. A blank is never counted as zero.",
  ),
  invalid_value: t("यह अंक इस पेपर में नहीं हो सकता।", "That mark cannot exist on this paper."),
  exempt_not_allowed: t("इस पेपर में छूट नहीं दी जा सकती।", "This paper does not allow exemption."),
  not_on_roll: t(
    "यह बच्चा इस परीक्षा के समय कक्षा में नहीं था। पेज फिर से खोलें।",
    "That child was not in the class during this exam. Reload the page.",
  ),
  cannot_blank: t(
    "जमा पेपर में अंक खाली नहीं किया जा सकता — अनुपस्थित या छूट चुनें।",
    "A submitted paper cannot have a blank — choose Absent or Exempt instead.",
  ),
  no_change: t("कुछ नहीं बदला।", "Nothing changed."),
  reason_required: t("जमा अंक बदलने का कारण लिखें।", "Say why you are changing a submitted mark."),
  already_submitted: t(
    "यह पेपर जमा हो चुका है। बदलने के लिए कारण के साथ सुधारें।",
    "This paper is already submitted. To change it, correct it with a reason.",
  ),
  not_submitted: t("यह पेपर अभी जमा नहीं हुआ है।", "This paper has not been submitted."),
  exam_not_open: t(
    "यह परीक्षा अंकों के लिए खुली नहीं है।",
    "This exam is not open for marks.",
  ),
  not_permitted: t(
    "आप इस पेपर के अंक नहीं भर सकते।",
    "You cannot enter marks on this paper.",
  ),
  not_found: t("यह पेपर नहीं मिला।", "That paper was not found."),
  id_reused: t(
    "यह फ़ॉर्म पहले ही किसी और बदलाव के लिए भेजा जा चुका है। पेज फिर से खोलें।",
    "This form was already used for a different change. Reload the page.",
  ),
  bad_request: t("कुछ अधूरा भेजा गया। पेज फिर से खोलें।", "Something was missing. Reload the page."),
  failed: t(
    "सहेजा नहीं जा सका। फिर से कोशिश करना सुरक्षित है — जो सहेजा गया वह दोबारा नहीं होगा।",
    "Not saved. Trying again is safe — a save that did land will not be made twice.",
  ),
};
