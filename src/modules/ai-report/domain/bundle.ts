import type * as Xlsx from "xlsx";

/**
 * Putting the AI report together in the browser: the two workbooks become
 * one, the photographs get readable names, and a read-me says how to use the
 * file with an assistant. Pure, so it is tested in Node with the same `xlsx`
 * the browser loads.
 *
 * Why the browser: each half is one response from the server, and a response
 * cannot pass 4.5 MB on Vercel. Joined here, the year can outgrow that.
 */

export type AiPhoto = {
  studentId: string;
  admissionNo: string | null;
  fullName: string;
  classLabel: string;
  status: string;
  contentType: string;
  /** Base64 of the image bytes. */
  data: string;
};
export type AiPhotoSkip = { studentId: string; admissionNo: string | null; fullName: string; reason: "missing" | "unreadable" };

export const reportBaseName = (sessionLabel: string) => `VPPS-AI-report-${sessionLabel.replace(/[^A-Za-z0-9-]/g, "")}`;

const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]+/g;
const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** "photos/1234 - Asha Kumari (Class 5 - Section A).jpg", never two the same. */
export function photoFileName(photo: Pick<AiPhoto, "admissionNo" | "fullName" | "classLabel" | "contentType" | "studentId">, taken: Set<string>): string {
  const parts = [photo.admissionNo?.trim() || "No SR", photo.fullName.trim() || "No name"];
  const stem = `${parts.join(" - ")}${photo.classLabel ? ` (${photo.classLabel})` : ""}`.replace(UNSAFE, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  const extension = EXTENSIONS[photo.contentType] ?? "jpg";
  let name = `photos/${stem}.${extension}`;
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `photos/${stem} (${n}).${extension}`;
  taken.add(name.toLowerCase());
  return name;
}

const csvCell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** photos/index.csv: one line per child with a photograph, then the ones without. */
export function photoIndexCsv(rows: readonly { file: string; photo: Pick<AiPhoto, "admissionNo" | "fullName" | "classLabel" | "status"> }[], skipped: readonly AiPhotoSkip[]): string {
  const lines = [["File", "SR no", "Student", "Class", "Status", "Note"]];
  for (const { file, photo } of rows) lines.push([file.replace(/^photos\//, ""), photo.admissionNo ?? "", photo.fullName, photo.classLabel, photo.status, ""]);
  for (const skip of skipped) {
    lines.push(["", skip.admissionNo ?? "", skip.fullName, "", "", skip.reason === "missing" ? "Photograph on record but the file is missing" : "Photograph could not be read"]);
  }
  return `${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** Base64 to bytes, in the browser and in Node. */
export function base64Bytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Excel's sheet-name rules: 31 characters, a short list of characters, unique ignoring case. */
export function uniqueSheetName(wanted: string, taken: Set<string>): string {
  const clean = wanted.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim() || "Sheet";
  let name = clean.slice(0, 31);
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) {
    const suffix = ` ${n}`;
    name = `${clean.slice(0, 31 - suffix.length)}${suffix}`;
  }
  taken.add(name.toLowerCase());
  return name;
}

/**
 * One workbook: One's sheets, then every Fees sheet under a "Fees " name
 * ("_README" becomes "Fees README"), so a reader knows which app a number
 * came from. Compressed, as the parts were.
 */
export function mergeWorkbooks(XLSX: typeof Xlsx, school: ArrayBuffer | Uint8Array, fees: ArrayBuffer | Uint8Array | null): Uint8Array {
  const options = { type: "array" as const, cellNF: true, cellStyles: true };
  const book = XLSX.read(school, options);
  if (fees) {
    const feesBook = XLSX.read(fees, options);
    const taken = new Set(book.SheetNames.map((name) => name.toLowerCase()));
    for (const name of feesBook.SheetNames) {
      XLSX.utils.book_append_sheet(book, feesBook.Sheets[name], uniqueSheetName(`Fees ${name.replace(/^_+/, "")}`, taken));
    }
  }
  const out = XLSX.write(book, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer;
  return new Uint8Array(out);
}

export type ReadmeInput = {
  sessionLabel: string;
  madeAt: string;
  madeBy: string;
  workbook: string;
  /** Whether the Fees half is in the workbook, and why not when it is not. */
  fees: { included: true } | { included: false; reason: string };
  photos: { included: number; withoutPhoto: number; skipped: number } | { included: false; reason: string };
  /** The workbook arrived as two files because they could not be joined here. */
  separateFeesFile?: string | null;
};

export const EXAMPLE_QUESTIONS: readonly string[] = [
  "Which classes have the lowest attendance this month, and which children in them were absent most?",
  "List families with fees pending in more than one child, with phone numbers, largest amount first.",
  "Compare each class's average marks in the last two assessments and name the subjects that fell.",
  "Which children have both low attendance and pending fees? Give class, SR no and the father's phone.",
  "Make a one-page summary for the principal: enrolment, collection so far, defaulters, attendance, exams.",
  "Which teachers covered the most periods for absent colleagues, and on which days?",
  "List open health and family notes that still need a follow-up, oldest first.",
];

/** READ-ME-FIRST.txt, at the top of the .zip. */
export function readmeText(input: ReadmeInput): string {
  const lines = [
    `VPPS AI report - ${input.sessionLabel}`,
    `Shri Veer Patta Senior Secondary School. Made ${input.madeAt} (India time) by ${input.madeBy}.`,
    "",
    "WHAT THIS IS",
    `Everything VPPS One and the Fees app hold for the ${input.sessionLabel} session, in one file, to give to an`,
    "AI assistant such as ChatGPT so it can answer questions and build whatever report you need.",
    "",
    "WHAT IS INSIDE",
    `* ${input.workbook} - every sheet. Start with the "_README" sheet, then "_SHEETS" (each sheet, what it`,
    "  holds and how many rows). Sheets whose name starts with \"Fees \" come from the Fees app (the money);",
    "  \"Fees README\" there explains the money rules.",
  ];
  if (input.separateFeesFile) lines.push(`* ${input.separateFeesFile} - the Fees sheets, kept as their own file because the two could not be joined.`);
  if (!input.fees.included) lines.push(`* Fees sheets are NOT included: ${input.fees.reason}`);
  if (input.photos.included === false) lines.push(`* Photographs are NOT included: ${input.photos.reason}`);
  else {
    lines.push(`* photos/ - ${input.photos.included} student photographs, named "SR no - Name (Class)". photos/index.csv lists them.`);
    if (input.photos.withoutPhoto > 0) lines.push(`  ${input.photos.withoutPhoto} children have no photograph on file.`);
    if (input.photos.skipped > 0) lines.push(`  ${input.photos.skipped} photographs on record could not be read; index.csv names them.`);
  }
  lines.push(
    "",
    "HOW TO USE IT WITH CHATGPT",
    "1. Open ChatGPT and attach this .zip (or only the .xlsx when you do not need the photographs).",
    `2. Write: "This is my school's data for ${input.sessionLabel}. Read the _README sheet first." Then ask for the report.`,
    "3. For any number you will act on, ask it to say which sheet and which rows it used.",
    "",
    "EXAMPLE QUESTIONS",
    ...EXAMPLE_QUESTIONS.map((question) => `- ${question}`),
    "",
    "KEEP IT PRIVATE",
    "This file holds children's Aadhaar numbers, phone numbers, addresses, marks, health and family notes",
    "and photographs. Do not forward it or post it in a group. Delete it when your report is done.",
    "",
  );
  return lines.join("\r\n");
}
