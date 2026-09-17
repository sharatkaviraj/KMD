/**
 * A list of specific children the office typed out, turned into an audience.
 *
 * **The case this exists for.** Thirty-five families whose number is on record
 * and is not a WhatsApp number. Nothing about those children is missing — every
 * gap filter says their records are complete — so no query finds them and the
 * office is the only thing that knows. It puts them in a sheet, writes one line
 * about each, and each class teacher gets her own share of them (S-03, S-06).
 *
 * **What did not match is the point.** A list of thirty-five that quietly
 * becomes a round of thirty-one is the worst thing this can do: the office
 * believes it asked about everyone, and the four it dropped are the four whose
 * rows were already wrong. So `unmatched` comes back beside `matched`, carries
 * the row number the office can act on, and the screen says it in words before
 * anything is created.
 *
 * Ported from SamPark `830548c` (`src/lib/ask-list.ts`), with one change: it
 * reads **CSV**, not `.xlsx`. SOURCES.md records that `excel.ts` was not
 * ported — a spreadsheet library to parse a file Excel already exports is a
 * dependency bought for nothing, and this app writes CSV in the browser
 * already.
 *
 * Pure, and nothing here writes.
 */

/** The header row the template writes, and the upload looks for by name. */
export const TEMPLATE_HEADERS = {
  admissionNo: "SR No",
  name: "Name (not read)",
  note: "Note to teacher",
} as const;

/**
 * Header names the sheet may use, lower-cased. The template writes the first.
 *
 * `name` is read **only so a mis-mapped sheet can be explained** and is never
 * a match key. It has to be in here or the column the office is looking at is
 * one this module cannot see: a row carrying a name and no SR would then be
 * indistinguishable from the blank tail of a spreadsheet, and would vanish
 * instead of being reported.
 */
const HEADERS = {
  admissionNo: ["sr no", "sr_no", "srno", "sr number", "s.r. no", "sr", "admission no", "admission_no", "admission number", "id"],
  note: ["note to teacher", "note", "remark", "remarks", "message"],
  name: ["name (not read)", "name", "student", "student name", "child"],
} as const;

export type AskListRow = {
  /** The number Excel shows down the left, which is the one she can act on. */
  rowNumber: number;
  studentId: string;
  fullName: string;
  admissionNo: string | null;
  classId: string | null;
  note: string | null;
};

export type AskListMiss = {
  rowNumber: number;
  admissionNo: string | null;
  /** What was in the name column, so the office can find the row by eye. */
  name: string | null;
  reason: MissReason;
};

/**
 * Why a row could not be used, as a code rather than a sentence.
 *
 * A code because the screen is bilingual and the reason is rendered from a
 * message pair — a sentence built here would be English in a Hindi reader's
 * error list, which is exactly the half-translated feeling D-129 is about.
 */
export type MissReason =
  | "no-identifier"
  | "not-found"
  | "not-enrolled"
  | "already-listed";

export type AskListResult = {
  matched: AskListRow[];
  /** Named, never counted away. See the note at the top of this file. */
  unmatched: AskListMiss[];
  /** The classes the matched children fall across. Drives the preview. */
  classIds: string[];
};

/** One child, as the caller loaded them, for matching against. */
export type MatchableStudent = {
  id: string;
  fullName: string;
  admissionNo: string | null;
  classId: string | null;
  /** Whether they are on this session's roll. */
  isEnrolled: boolean;
};

/* ------------------------------------------------------------------ CSV */

export type ParsedTable = {
  headers: string[];
  rows: Record<string, string>[];
};

/**
 * Read a CSV the way Excel writes one.
 *
 * Quoted fields, doubled quotes inside them, commas and newlines inside
 * quotes, and a UTF-8 BOM at the front — which Excel writes and which turns
 * the first header into `﻿SR No` if it is not stripped, so the column the
 * office can see becomes one the matcher cannot.
 *
 * Deliberately small. It is not a CSV library and does not try to be; it reads
 * the file this app's own template produces and the file Excel exports from
 * it, and anything stranger fails as an unmatched row rather than silently.
 */
export function parseCsv(text: string): ParsedTable {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const grid = splitCsv(withoutBom);

  const headerRow = grid.find((row) => row.some((cell) => cell.trim() !== ""));
  if (!headerRow) return { headers: [], rows: [] };

  const headers = headerRow.map((cell) => cell.trim());
  const start = grid.indexOf(headerRow) + 1;

  const rows = grid.slice(start).map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? "").trim();
    });
    return row;
  });

  return { headers, rows };
}

function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      // CRLF is one row break, not two.
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

/* -------------------------------------------------------------- matching */

/** Which column of the sheet holds what, by header name. */
function columnFor(headers: string[], aliases: readonly string[]): string | null {
  const lower = headers.map((header) => header.trim().toLowerCase());
  for (const alias of aliases) {
    const index = lower.indexOf(alias);
    if (index !== -1) return headers[index] ?? null;
  }
  return null;
}

/** Is this sheet usable at all? Answered before any row is read. */
export function hasIdentityColumn(headers: string[]): boolean {
  return columnFor(headers, HEADERS.admissionNo) !== null;
}

/** An admission number as it is compared: trimmed, upper-cased. */
export function normaliseAdmissionNo(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Index the roll by admission number.
 *
 * A number held by two children is indexed as **neither**, so a sheet naming
 * it is reported rather than resolved — picking one would be a coin toss about
 * which family gets asked.
 */
export function indexByAdmissionNo(
  students: readonly MatchableStudent[],
): Map<string, MatchableStudent | null> {
  const index = new Map<string, MatchableStudent | null>();

  for (const student of students) {
    if (!student.admissionNo) continue;
    const key = normaliseAdmissionNo(student.admissionNo);
    index.set(key, index.has(key) ? null : student);
  }

  return index;
}

/**
 * Match every row of the sheet to a child, or say why it could not.
 *
 * `students` is everybody the caller loaded — on the roll and not. A child who
 * has **left** is matched and then refused with that as the reason, rather
 * than silently missing: the resolver only ever takes enrolled children, so an
 * id that is no longer on the roll would otherwise vanish between this screen
 * and the frozen roster with nothing said.
 */
export function matchAskList(
  table: ParsedTable,
  students: readonly MatchableStudent[],
): AskListResult {
  const index = indexByAdmissionNo(students);

  const srColumn = columnFor(table.headers, HEADERS.admissionNo);
  const noteColumn = columnFor(table.headers, HEADERS.note);
  const nameColumn = columnFor(table.headers, HEADERS.name);

  const matched: AskListRow[] = [];
  const unmatched: AskListMiss[] = [];
  /** Two rows naming one child is a mistake in the sheet, not a second ask. */
  const seen = new Set<string>();

  table.rows.forEach((row, offset) => {
    // Row 1 is the header, so the first data row is row 2 — the number Excel
    // itself shows down the left, which is the only one the office can act on.
    const rowNumber = offset + 2;
    const admissionNo = srColumn ? (row[srColumn] ?? "").trim() : "";
    const note = noteColumn ? (row[noteColumn] ?? "").trim() : "";
    const name = nameColumn ? (row[nameColumn] ?? "").trim() : "";

    // A wholly blank row is the empty tail of a spreadsheet, not a failure.
    if (!admissionNo && !note && !name) return;

    const miss = (reason: MissReason) =>
      unmatched.push({
        rowNumber,
        admissionNo: admissionNo || null,
        name: name || null,
        reason,
      });

    if (!admissionNo) {
      miss("no-identifier");
      return;
    }

    const student = index.get(normaliseAdmissionNo(admissionNo));

    // `null` is the ambiguous case; `undefined` is nobody at all. Both are
    // "this row does not name one child", which is all the office can act on.
    if (!student) {
      miss("not-found");
      return;
    }
    if (!student.isEnrolled) {
      miss("not-enrolled");
      return;
    }
    if (seen.has(student.id)) {
      miss("already-listed");
      return;
    }

    seen.add(student.id);
    matched.push({
      rowNumber,
      studentId: student.id,
      fullName: student.fullName,
      admissionNo: student.admissionNo,
      classId: student.classId,
      note: note || null,
    });
  });

  return {
    matched,
    unmatched,
    classIds: [
      ...new Set(
        matched
          .map((row) => row.classId)
          .filter((id): id is string => id !== null),
      ),
    ],
  };
}

/** The notes, keyed by student id, in the shape an audience carries. */
export function notesFrom(matched: readonly AskListRow[]): Record<string, string> {
  const notes: Record<string, string> = {};
  for (const row of matched) {
    if (row.note) notes[row.studentId] = row.note;
  }
  return notes;
}

/** The template the office downloads, as CSV text. */
export function templateCsv(): string {
  const header = [
    TEMPLATE_HEADERS.admissionNo,
    TEMPLATE_HEADERS.name,
    TEMPLATE_HEADERS.note,
  ].join(",");

  // A BOM and CRLF, which is the one thing worth keeping from SamPark's
  // `excel.ts`: without them Excel opens Hindi as mojibake, and a template
  // whose notes column cannot hold Hindi is a template for one language.
  return `﻿${header}\r\n`;
}
