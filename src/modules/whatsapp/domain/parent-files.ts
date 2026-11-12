import { createHash } from "node:crypto";

import { spreadsheetText } from "@/platform/helpers/spreadsheet-text";
import { fromWaId, toE164, waDigits } from "@/platform/whatsapp/numbers";
import type { WhatsAppSwitches } from "@/platform/whatsapp/policy";

/**
 * Parents' photos, voice notes and files, and old months of chats, in the
 * school's Shared Drive (D-594, D-595). The rules; the work is in
 * `data/parent-files.ts`.
 *
 * Meta keeps a file a parent sends for about a month and the hub keeps only
 * its id, so without a copy the photo of a fee receipt or a doctor's note is
 * gone in thirty days. One copies each file into the school's Drive as it
 * arrives, with a name the office can find again by date, family and kind,
 * and tells the hub where the copy is, so its chat links to it.
 *
 * Nothing here is kept in One's database (D-576): the file goes from the hub
 * to Drive through this server's memory, and the hub keeps the link.
 */

/** Kinds of file a parent sends that are kept: the hub's own list. A sticker is not. */
export const PARENT_FILE_TYPES = ["image", "video", "audio", "document"] as const;

export function isParentFileType(type: string | null | undefined): boolean {
  return (PARENT_FILE_TYPES as readonly string[]).includes(String(type ?? ""));
}

/** The largest file copied. WhatsApp lets a document reach 100 MB; past this it stays in the chat. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * The hourly sweep leaves a file this young alone: the copy started by its own
 * message is still running, and two copies of one file would be two files.
 */
export const SWEEP_MIN_AGE_MINUTES = 10;

/** Whose files One copies now, and whether they are practice ones. */
export type FileScope = {
  /** Practice: only the owner's own number, into the practice folder. */
  practice: boolean;
  /** The numbers to ask the hub about (digits, country code first), or null for everyone the hub allows. */
  numbers: string[] | null;
};

/**
 * Files are copied only while Veer Patta AI is switched on, and, until real
 * parents are switched on, only from the owner's own number, exactly like the
 * helper's answers. The hub has its own switch on top: in test mode it hands
 * over only its test numbers' files.
 */
export function fileScope(switches: WhatsAppSwitches | null): FileScope | null {
  if (!switches) return null;
  if (switches.features.parent_helper !== true) return null;
  if (switches.realRecipients) return { practice: false, numbers: null };
  const owner = toE164(switches.ownerTestNumber ?? "");
  return owner ? { practice: true, numbers: [waDigits(owner)] } : null;
}

/** Whether this number's files may be copied now. */
export function scopeAllows(scope: FileScope, waId: string): boolean {
  if (scope.numbers === null) return true;
  const number = fromWaId(waId);
  return number !== null && scope.numbers.includes(waDigits(number));
}

/** "2026-11-12 13:12:00" (the hub, UTC) as a moment; null when it is not one. */
export function hubTime(at: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(at.trim());
  if (!match) return null;
  const moment = new Date(`${match[1]}T${match[2]}Z`);
  return Number.isNaN(moment.getTime()) ? null : moment;
}

/** The moment in India: "2026-11-12", "18.42", "2026-11". */
export function indiaStamp(moment: Date): { date: string; time: string; month: string } {
  const india = new Date(moment.getTime() + 330 * 60_000).toISOString();
  return { date: india.slice(0, 10), time: `${india.slice(11, 13)}.${india.slice(14, 16)}`, month: india.slice(0, 7) };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-11 November": sorts by date in Drive, and reads as a month. */
export function monthFolderName(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return `${month} ${MONTHS[index] ?? ""}`.trim();
}

/** The registry keys (`drive_folders`) and names of the folders the files go in. */
export function filesFolder(practice: boolean): { key: string; name: string } {
  return practice
    ? { key: "wa-files:practice", name: "WhatsApp from parents (practice)" }
    : { key: "wa-files", name: "WhatsApp from parents" };
}

export function filesMonthFolder(practice: boolean, month: string): { key: string; name: string } {
  return { key: `${filesFolder(practice).key}:${month}`, name: monthFolderName(month) };
}

export const CHATS_FOLDER = { key: "wa-chats", name: "WhatsApp chats by month" } as const;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/wav": "wav",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
};

/** The type alone, without "; codecs=opus". */
export function bareMime(mime: string | null | undefined): string | null {
  const bare = String(mime ?? "").split(";")[0]?.trim().toLowerCase();
  return bare ? bare : null;
}

export function kindWord(type: string, mime: string | null): string {
  if (type === "image") return "Photo";
  if (type === "video") return "Video";
  // WhatsApp records a voice note as Ogg Opus; anything else is an audio file.
  if (type === "audio") return bareMime(mime) === "audio/ogg" || bareMime(mime) === "audio/opus" ? "Voice note" : "Audio";
  return "File";
}

/** Characters Drive, Windows or a phone's downloads folder trips over, and runs of space. */
function clean(text: string | null | undefined, max: number): string {
  const tidy = String(text ?? "")
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return tidy.length > max ? `${tidy.slice(0, max - 1).trim()}…` : tidy;
}

/** Six letters that are always the same for one message, so a second try finds the first copy by name. */
export function messageTag(wamid: string): string {
  return createHash("sha256").update(`vppsone-whatsapp-file:${wamid}`).digest("hex").slice(0, 6);
}

export type FileToName = {
  wamid: string;
  waId: string;
  type: string;
  mime: string | null;
  label: string | null;
  name: string | null;
  at: string;
};

/**
 * "2026-11-12 18.42 · Asha (…3824) · Photo · Fee receipt · 3f9a1c.jpg"
 *
 * The date and time in India first, so Drive sorts a month by when the files
 * came; then who sent it (the name the school gave the number, or their
 * WhatsApp name, and the last four digits), what it is, the parent's own
 * caption or file name, and the message's tag.
 */
export function driveFileName(file: FileToName, fallbackMoment: Date = new Date()): string {
  const stamp = indiaStamp(hubTime(file.at) ?? fallbackMoment);
  const digits = String(file.waId).replace(/\D/g, "");
  const tail = digits.length >= 4 ? `…${digits.slice(-4)}` : "…";
  const who = clean(file.name, 40);
  const sender = who ? `${who} (${tail})` : tail;

  let label = clean(file.label, 60);
  let extension = EXTENSIONS[bareMime(file.mime) ?? ""] ?? null;
  // A document's label is its own file name: keep its extension, once. A
  // photo's label is the parent's caption, whatever it ends with.
  const own = file.type === "document" ? /\.([A-Za-z0-9]{1,5})$/.exec(label) : null;
  if (own) {
    extension = extension ?? own[1]!.toLowerCase();
    if (own[1]!.toLowerCase() === extension) label = label.slice(0, -own[0].length).trim();
  }
  const parts = [`${stamp.date} ${stamp.time}`, sender, kindWord(file.type, file.mime)];
  if (label) parts.push(label);
  parts.push(messageTag(file.wamid));
  return `${parts.join(" · ")}${extension ? `.${extension}` : ""}`;
}

/** Drive's own labels on the file: small, and never the parent's words (124 bytes a pair at most). */
export function fileProperties(file: { wamid: string; type: string }): Record<string, string> {
  return {
    vppsone: "whatsapp-file",
    kind: file.type.slice(0, 20),
    message: createHash("sha256").update(file.wamid).digest("hex").slice(0, 32),
  };
}

/**
 * What to tell the hub when a copy fails. Three are final, and the hub stops
 * offering the file at once: it is too big, Meta no longer has it, or the hub
 * will not hand it over. Anything else is tried again, up to five times.
 */
export type FileProblem = "too_big" | "gone" | "not_allowed" | "checksum" | "drive_full" | "drive_refused" | "unreadable";

// ------------------------------------------------------------ chats by month

export type ArchivedRow = {
  waId: string;
  name: string | null;
  direction: string;
  type: string;
  body: string | null;
  templateName: string | null;
  status: string | null;
  sentBy: string | null;
  source: string | null;
  driveFileId: string | null;
  createdAt: string;
};

export function chatsFileName(month: string): string {
  return `WhatsApp chats ${month}.csv`;
}

export const CSV_BOM = "﻿";

const CHAT_COLUMNS = ["When (India)", "Number", "Name", "Direction", "Kind", "Message", "Template", "Status", "Sent by", "File in Drive"];

function csvCell(value: string | null): string {
  const text = spreadsheetText(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * "91 98765 43210": a number a spreadsheet keeps as text. With a leading "+"
 * the formula guard would prefix it, and as bare digits Excel shows 9.2E+11.
 */
export function spacedNumber(waId: string): string {
  const digits = String(waId).replace(/\D/g, "");
  if (digits.length <= 10) return digits;
  const local = digits.slice(-10);
  return `${digits.slice(0, -10)} ${local.slice(0, 5)} ${local.slice(5)}`;
}

function sentByWords(row: ArchivedRow): string {
  if (row.direction === "in") return "";
  const by = row.sentBy?.trim() ?? "";
  const source = row.source?.trim() ?? "";
  if (source.startsWith("api:")) return `${source.slice(4)} app${by && by !== source.slice(4) ? ` (${by})` : ""}`;
  return by || source;
}

/**
 * One month of the hub's chats, as a spreadsheet the office can open: every
 * message in the order it came, Hindi intact (the byte-order mark tells Excel
 * it is UTF-8), and a cell that starts like a formula is kept as text.
 */
export function chatsCsv(rows: readonly ArchivedRow[]): string {
  const lines = [CHAT_COLUMNS.map(csvCell).join(",")];
  for (const row of rows) {
    const moment = hubTime(row.createdAt);
    const when = moment ? `${indiaStamp(moment).date} ${indiaStamp(moment).time.replace(".", ":")}` : row.createdAt;
    lines.push(
      [
        when,
        spacedNumber(row.waId),
        row.name,
        row.direction === "in" ? "To the school" : "From the school",
        row.type,
        row.body,
        row.templateName,
        row.status,
        sentByWords(row),
        row.driveFileId ? `https://drive.google.com/file/d/${encodeURIComponent(row.driveFileId)}/view` : null,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}
