import { t, type Localized } from "@/platform/i18n/language";

/**
 * Bringing SamPark's records in (P10b), as pure logic: which column is which,
 * and which child a row is.
 *
 * The office exports SamPark's Students workbook (`src/lib/student-export.ts`
 * in that repo — the headers below are its headers) and uploads it here.
 * Nothing in this file reads a database or writes anything.
 *
 * **Identity is a multimap, never a guess** (plan §11). SamPark's importers
 * keyed children on SR, NIC, temporary and legacy text ids; the fee app's
 * importer kept a last-wins SR map. So a row resolves to exactly one child,
 * to several (ambiguous), or to none (unmatched) — and only by an id:
 *
 *   1. a mapping a person or an earlier import already made
 *      (`external_student_ids`, app `sampark`);
 *   2. the SR number, against the fee record's `admission_no`;
 *   3. failing an SR, SamPark's own admission number, against the same.
 *
 * **Never by name, and never by phone.** A name is shown to the person
 * resolving a row; it never decides one. Two ids that disagree — the mapping
 * says one child and the SR another — are an ambiguity for a person, not a
 * tie for the code to break. Two rows in one file for the same child are both
 * refused, as SamPark's photo matcher refuses two files for one face.
 */

/* ------------------------------------------------------------- headers */

/** Lower-case, single spaces, no punctuation — "Father's Name" → "fathers name". */
export function headerKey(header: string): string {
  return header
    .toLowerCase()
    .replace(/[’'.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The columns that say who a row is. Read for identity and display only. */
export const IDENTITY_HEADERS = {
  externalId: ["student id"],
  sr: ["sr no", "sr", "sr number", "srno"],
  admission: ["admission no", "admission number"],
  name: ["name", "student name"],
  classLabel: ["class"],
  section: ["section"],
} as const;

/**
 * SamPark columns that carry a value this app collects, by the field key here.
 *
 * Deliberately short. "Mobile No" is the parent's number in SamPark and the
 * guardian's here; "Alternate Mobile" is *some* other number, and putting it
 * in `mother_phone` would be a guess — so it is left out, and the preview says
 * which columns were not read.
 */
export const VALUE_HEADERS: Record<string, string> = {
  "mobile no": "guardian_phone",
  "date of birth": "date_of_birth",
  "aadhaar last 4": "aadhaar_last4",
  address: "address",
  "bus route": "transport",
};

export type SamparkRow = {
  /** 1-based, the row as Excel numbers it (the header is row 1). */
  rowNo: number;
  externalId: string | null;
  sr: string | null;
  admission: string | null;
  name: string | null;
  classLabel: string | null;
  /** field key → the cell as it read, untrimmed of meaning but not validated. */
  values: Record<string, string | null>;
};

export type SheetReading = {
  rows: SamparkRow[];
  /** Columns read into a field here. */
  mapped: { header: string; fieldKey: string }[];
  /** Columns present and not read — said out loud, never silently dropped. */
  ignored: string[];
  /** No column that can identify a child: nothing in the file can be matched. */
  noIdentity: boolean;
};

const cell = (value: string | undefined | null): string | null => {
  const text = (value ?? "").toString().trim();
  return text === "" ? null : text;
};

/**
 * Read a sheet's rows into SamPark rows. `fieldKeys` is the set of fields this
 * app has; a SamPark column for a field nobody has created here is ignored.
 */
export function readSheet(table: { headers: string[]; rows: string[][] }, fieldKeys: ReadonlySet<string>): SheetReading {
  const keys = table.headers.map(headerKey);
  const indexOf = (aliases: readonly string[]) => keys.findIndex((key) => aliases.includes(key));

  const at = {
    externalId: indexOf(IDENTITY_HEADERS.externalId),
    sr: indexOf(IDENTITY_HEADERS.sr),
    admission: indexOf(IDENTITY_HEADERS.admission),
    name: indexOf(IDENTITY_HEADERS.name),
    classLabel: indexOf(IDENTITY_HEADERS.classLabel),
    section: indexOf(IDENTITY_HEADERS.section),
  };

  const identityColumns = new Set(Object.values(at).filter((index) => index >= 0));
  const mapped: { header: string; fieldKey: string; index: number }[] = [];
  const ignored: string[] = [];
  keys.forEach((key, index) => {
    if (identityColumns.has(index) || key === "") return;
    const fieldKey = VALUE_HEADERS[key];
    if (fieldKey && fieldKeys.has(fieldKey)) {
      mapped.push({ header: table.headers[index]!, fieldKey, index });
    } else {
      ignored.push(table.headers[index]!);
    }
  });

  const rows: SamparkRow[] = [];
  table.rows.forEach((raw, offset) => {
    if (raw.every((value) => cell(value) === null)) return;
    const get = (index: number) => (index >= 0 ? cell(raw[index]) : null);
    const section = get(at.section);
    const classLabel = get(at.classLabel);
    rows.push({
      rowNo: offset + 2,
      externalId: get(at.externalId),
      sr: get(at.sr),
      admission: get(at.admission),
      name: get(at.name),
      classLabel: classLabel && section ? `${classLabel} ${section}` : classLabel,
      values: Object.fromEntries(mapped.map((entry) => [entry.fieldKey, get(entry.index)])),
    });
  });

  return {
    rows,
    mapped: mapped.map(({ header, fieldKey }) => ({ header, fieldKey })),
    ignored,
    noIdentity: at.externalId < 0 && at.sr < 0 && at.admission < 0,
  };
}

/* ------------------------------------------------------------ identity */

/**
 * The form an id is compared in: trimmed, upper-cased, inner spaces removed.
 * **Leading zeros are kept** — "0123" and "123" are different SR numbers
 * until a person says otherwise, because stripping them is how two children
 * become one.
 */
export function idKey(value: string | null | undefined): string | null {
  const key = (value ?? "").replace(/\s+/g, "").toUpperCase();
  return key === "" ? null : key;
}

export type IdentityIndex = {
  /** SamPark id → children already mapped to it (a table key: at most one). */
  mappings: ReadonlyMap<string, string[]>;
  /** `idKey(admission_no)` → every child with that number. */
  byAdmission: ReadonlyMap<string, string[]>;
};

export function buildIndex(input: {
  mappings: { externalId: string; studentId: string }[];
  students: { id: string; admissionNo: string | null }[];
}): IdentityIndex {
  const mappings = new Map<string, string[]>();
  for (const entry of input.mappings) {
    mappings.set(entry.externalId, [...(mappings.get(entry.externalId) ?? []), entry.studentId]);
  }
  const byAdmission = new Map<string, string[]>();
  for (const student of input.students) {
    const key = idKey(student.admissionNo);
    if (!key) continue;
    byAdmission.set(key, [...(byAdmission.get(key) ?? []), student.id]);
  }
  return { mappings, byAdmission };
}

export type MatchedOn = "mapping" | "sr" | "admission";

export type IdentityResolution =
  | { kind: "matched"; studentId: string; by: MatchedOn }
  | { kind: "ambiguous"; candidates: string[]; why: AmbiguityReason }
  | { kind: "unmatched" };

export type AmbiguityReason = "several_children" | "ids_disagree" | "same_child_twice";

const unique = (ids: string[]) => [...new Set(ids)];

/** Which child one row is, by ids alone. */
export function resolveIdentity(row: Pick<SamparkRow, "externalId" | "sr" | "admission">, index: IdentityIndex): IdentityResolution {
  const found: { by: MatchedOn; ids: string[] }[] = [];

  if (row.externalId) {
    const mapped = index.mappings.get(row.externalId);
    if (mapped && mapped.length > 0) found.push({ by: "mapping", ids: unique(mapped) });
  }
  const sr = idKey(row.sr);
  if (sr) {
    const ids = index.byAdmission.get(sr);
    if (ids && ids.length > 0) found.push({ by: "sr", ids: unique(ids) });
  } else {
    const admission = idKey(row.admission);
    const ids = admission ? index.byAdmission.get(admission) : undefined;
    if (ids && ids.length > 0) found.push({ by: "admission", ids: unique(ids) });
  }

  if (found.length === 0) return { kind: "unmatched" };

  const several = found.find((entry) => entry.ids.length > 1);
  if (several) return { kind: "ambiguous", candidates: unique(found.flatMap((entry) => entry.ids)), why: "several_children" };

  const children = unique(found.map((entry) => entry.ids[0]!));
  if (children.length > 1) return { kind: "ambiguous", candidates: children, why: "ids_disagree" };

  return { kind: "matched", studentId: children[0]!, by: found[0]!.by };
}

/**
 * Resolve a whole file, refusing two rows that land on one child. Neither is
 * taken: which SamPark row is the real one is a person's call.
 */
export function resolveAll(rows: SamparkRow[], index: IdentityIndex): Map<number, IdentityResolution> {
  const first = new Map(rows.map((row) => [row.rowNo, resolveIdentity(row, index)] as const));
  const claims = new Map<string, number>();
  for (const resolution of first.values()) {
    if (resolution.kind === "matched") claims.set(resolution.studentId, (claims.get(resolution.studentId) ?? 0) + 1);
  }
  const out = new Map<number, IdentityResolution>();
  for (const [rowNo, resolution] of first) {
    out.set(
      rowNo,
      resolution.kind === "matched" && (claims.get(resolution.studentId) ?? 0) > 1
        ? { kind: "ambiguous", candidates: [resolution.studentId], why: "same_child_twice" }
        : resolution,
    );
  }
  return out;
}

export const ambiguityLabels: Record<AmbiguityReason, Localized> = {
  several_children: t("इस नंबर के एक से ज़्यादा बच्चे हैं", "More than one child has this number"),
  ids_disagree: t("पहचान के नंबर अलग-अलग बच्चे बताते हैं", "Its ids point at different children"),
  same_child_twice: t("फ़ाइल में इस बच्चे की दो पंक्तियाँ हैं", "The file has two rows for this child"),
};

export const matchedOnLabels: Record<MatchedOn | "hand", Localized> = {
  mapping: t("पहले की पहचान से", "By an earlier match"),
  sr: t("SR नंबर से", "By SR number"),
  admission: t("प्रवेश नंबर से", "By admission number"),
  hand: t("कार्यालय ने चुना", "Chosen by the office"),
};

export type ImportCounts = { matched: number; ambiguous: number; unmatched: number };

export function countResolutions(resolutions: Iterable<IdentityResolution>): ImportCounts {
  const counts: ImportCounts = { matched: 0, ambiguous: 0, unmatched: 0 };
  for (const resolution of resolutions) counts[resolution.kind] += 1;
  return counts;
}

/**
 * What applying a batch did, every number said — and, first among them, what
 * precedence kept: "applied 400" over a file that changed nothing a teacher
 * had confirmed would read as success while saying nothing (D-234).
 */
export function applySentence(receipt: {
  rowsApplied: number;
  written: number;
  unchanged: number;
  keptPerson: number;
  keptOtherImport: number;
  sentBackToQueue: number;
}): Localized {
  const hi = [
    `${receipt.rowsApplied} पंक्तियाँ लागू हुईं: ${receipt.written} मान दर्ज, ${receipt.unchanged} पहले जैसे।`,
  ];
  const en = [`Applied ${receipt.rowsApplied} rows: ${receipt.written} values recorded, ${receipt.unchanged} already the same.`];
  if (receipt.keptPerson > 0) {
    hi.push(`${receipt.keptPerson} मान नहीं बदले — वे किसी व्यक्ति ने दर्ज किए थे।`);
    en.push(`${receipt.keptPerson} kept as they were, because a person recorded them.`);
  }
  if (receipt.keptOtherImport > 0) {
    hi.push(`${receipt.keptOtherImport} मान नहीं बदले — वे किसी दूसरे आयात से हैं।`);
    en.push(`${receipt.keptOtherImport} kept, because a different import recorded them.`);
  }
  if (receipt.sentBackToQueue > 0) {
    hi.push(`${receipt.sentBackToQueue} पंक्तियाँ पहले की पहचान से टकराईं और सूची में वापस गईं।`);
    en.push(`${receipt.sentBackToQueue} rows disagreed with an earlier match and went back to the queue.`);
  }
  return t(hi.join(" "), en.join(" "));
}
