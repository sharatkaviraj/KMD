/**
 * What goes into an exported workbook, as plain rows (P10d, S-13).
 *
 * Pure, so the rules a spreadsheet silently breaks are tested here rather than
 * discovered by the office:
 *
 *   * **Every cell is text.** An SR number "0101" written as a number opens
 *     as 101, and then matches a different child when the file comes back.
 *   * **Blank is not zero, and neither is Absent.** A cell with nothing held
 *     stays empty; "0" stays "0"; "Absent" stays a word.
 *   * **Hindi stays Hindi.** The labels carry both halves; the bytes are the
 *     workbook library's UTF-8, never a CSV opened in the wrong code page.
 *   * **The counts are written down.** The About sheet says how many rows each
 *     sheet holds, so a file that lost rows on the way says so.
 *
 * Sheet names are cleaned the way SamPark's `excel.ts` (`safeSheetName`,
 * `uniqueSheetName`) cleans them: Excel refuses `[]:*?/\`, a name over 31
 * characters, and two sheets with one name.
 */

export type Cell = string;
export type Sheet = { name: string; rows: Cell[][] };

const FORBIDDEN = /[[\]:*?/\\]/g;

/** A name Excel accepts: no `[]:*?/\`, at most 31 characters, never empty. */
export function safeSheetName(name: string): string {
  const cleaned = name.replace(FORBIDDEN, "-").replace(/^'+|'+$/g, "").trim().slice(0, 31);
  return cleaned === "" ? "Sheet" : cleaned;
}

/** `safeSheetName`, then " (2)", " (3)"… until it is not taken. */
export function uniqueSheetName(name: string, taken: Set<string>): string {
  const base = safeSheetName(name);
  let candidate = base;
  for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) {
    const suffix = ` (${n})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

const text = (value: string | null | undefined): Cell => (value === null || value === undefined ? "" : String(value));

export type ExportField = { key: string; labelHi: string; labelEn: string };

export type StudentExportRow = {
  srNo: string | null;
  samparkId: string | null;
  name: string;
  classLabel: string | null;
  /** field key → what is held and where it came from; absent means nothing held. */
  values: Record<string, { value: string | null; source: string; sourceDetail: string | null; recordedOn: string | null }>;
};

/** The students workbook: one row per child, the provenance beside it, and what the file is. */
export function studentWorkbook(input: {
  sessionLabel: string;
  generatedOn: string;
  fields: ExportField[];
  rows: StudentExportRow[];
}): Sheet[] {
  const header = ["SR No", "SamPark ID", "Name", "Class", ...input.fields.map((field) => `${field.labelEn} / ${field.labelHi}`)];
  const students: Cell[][] = [
    header,
    ...input.rows.map((row) => [
      text(row.srNo),
      text(row.samparkId),
      text(row.name),
      text(row.classLabel),
      ...input.fields.map((field) => text(row.values[field.key]?.value)),
    ]),
  ];

  const sources: Cell[][] = [["SR No", "Name", "Field", "Value", "Source", "Import", "Recorded on"]];
  for (const row of input.rows) {
    for (const field of input.fields) {
      const held = row.values[field.key];
      if (!held) continue;
      sources.push([text(row.srNo), text(row.name), field.key, text(held.value), held.source, text(held.sourceDetail), text(held.recordedOn)]);
    }
  }

  const about: Cell[][] = [
    ["Session", input.sessionLabel],
    ["Generated on", input.generatedOn],
    ["Students rows", String(input.rows.length)],
    ["Sources rows", String(sources.length - 1)],
    ["A blank cell", "Nothing is held. It is not zero."],
    ["Every cell", "Text, so SR numbers keep their leading zeros."],
  ];

  return [
    { name: "Students", rows: students },
    { name: "Sources", rows: sources },
    { name: "About", rows: about },
  ];
}

export type RoundLinkExport = {
  label: string;
  fields: ExportField[];
  members: {
    rollNo: string | null;
    srNo: string | null;
    name: string;
    /** field key → what the teacher was shown (the frozen snapshot). */
    shown: Record<string, string | null>;
    /** field key → her answer and its status; absent means not answered. */
    answers: Record<string, { value: string | null; status: string }>;
  }[];
};

/**
 * A round's workbook: one sheet per link, each child's shown value beside the
 * answer and what became of it, and an About sheet with the counts.
 */
export function roundWorkbook(input: { title: string; sessionLabel: string; generatedOn: string; links: RoundLinkExport[] }): Sheet[] {
  const taken = new Set<string>(["about"]);
  const sheets: Sheet[] = input.links.map((link) => {
    const header = ["Roll", "SR No", "Name"];
    for (const field of link.fields) {
      header.push(`${field.labelEn} — shown`, `${field.labelEn} — answer`, `${field.labelEn} — status`);
    }
    const rows: Cell[][] = [
      header,
      ...link.members.map((member) => {
        const cells: Cell[] = [text(member.rollNo), text(member.srNo), text(member.name)];
        for (const field of link.fields) {
          const answer = member.answers[field.key];
          cells.push(text(member.shown[field.key]), text(answer?.value), answer ? answer.status : "not answered");
        }
        return cells;
      }),
    ];
    return { name: uniqueSheetName(link.label, taken), rows };
  });

  const about: Cell[][] = [
    ["Round", input.title],
    ["Session", input.sessionLabel],
    ["Generated on", input.generatedOn],
    ...sheets.map((sheet) => [`${sheet.name} rows`, String(sheet.rows.length - 1)]),
    ["A blank answer", "Not answered, or answered as no change. It is not zero."],
  ];
  return [...sheets, { name: "About", rows: about }];
}
