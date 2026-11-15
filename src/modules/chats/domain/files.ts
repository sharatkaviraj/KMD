/**
 * Photos and files a person at school sends in a parent chat (D-616). Pure.
 *
 * A photo is made smaller in the browser and sent as a JPEG; a file is a PDF,
 * a Word or an Excel file. Each goes up to a private shelf
 * (`parent-chat-files`), and WhatsApp fetches it once, at send time, through
 * a link that works for an hour, as receipts do (D-597). The kind is read
 * from the file's first bytes, never from its name or what the browser says.
 */

export type ChatFileKind = "image" | "document";

export type ChatFileType = { mime: string; kind: ChatFileKind; ext: string };

/** WhatsApp takes a photo up to 5 MB; ours are made smaller before they leave the phone. */
export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
/** The shelf takes a file up to 16 MB. */
export const MAX_CHAT_FILE_BYTES = 16 * 1024 * 1024;

const OFFICE: Record<string, ChatFileType> = {
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "document", ext: "docx" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "document", ext: "xlsx" },
  doc: { mime: "application/msword", kind: "document", ext: "doc" },
  xls: { mime: "application/vnd.ms-excel", kind: "document", ext: "xls" },
};

function extension(filename: string): string {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

/** The file's kind from its first bytes (and, for Office files, which of them its name says), or null when it is not one we send. */
export function sniffChatFile(head: Uint8Array, filename: string): ChatFileType | null {
  const at = (index: number) => head[index];
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (head.byteLength >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return { mime: "image/jpeg", kind: "image", ext: "jpg" };
  if (head.byteLength >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => at(index) === byte)) {
    return { mime: "image/png", kind: "image", ext: "png" };
  }
  if (head.byteLength >= 5 && ascii(0, 5) === "%PDF-") return { mime: "application/pdf", kind: "document", ext: "pdf" };
  const ext = extension(filename);
  // Word and Excel: a zip (docx, xlsx) or an old compound file (doc, xls), told apart by the name.
  if (head.byteLength >= 4 && at(0) === 0x50 && at(1) === 0x4b && at(2) === 0x03 && at(3) === 0x04) {
    return ext === "docx" || ext === "xlsx" ? OFFICE[ext] : null;
  }
  if (head.byteLength >= 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, index) => at(index) === byte)) {
    return ext === "doc" || ext === "xls" ? OFFICE[ext] : null;
  }
  return null;
}

/** The kinds the shelf takes, as the browser declares them before the upload. */
export const CHAT_FILE_MIMES: readonly string[] = ["image/jpeg", "image/png", "application/pdf", ...Object.values(OFFICE).map((type) => type.mime)];

export function chatFileTypeOf(mime: string): ChatFileType | null {
  if (mime === "image/jpeg") return { mime, kind: "image", ext: "jpg" };
  if (mime === "image/png") return { mime, kind: "image", ext: "png" };
  if (mime === "application/pdf") return { mime, kind: "document", ext: "pdf" };
  return Object.values(OFFICE).find((type) => type.mime === mime) ?? null;
}

export function maxBytesFor(kind: ChatFileKind): number {
  return kind === "image" ? MAX_CHAT_IMAGE_BYTES : MAX_CHAT_FILE_BYTES;
}

/** Where a file lives on the shelf: the chat, then a random id. Never a name a parent typed. */
export function chatFilePath(chatId: string, fileId: string, ext: string): string {
  return `${chatId}/${fileId}.${ext.replace(/[^a-z0-9]/g, "")}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path this chat's own upload made, and nothing else. */
export function isChatFilePath(path: string, chatId: string): boolean {
  const match = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|png|pdf|docx|xlsx|doc|xls)$/i.exec(path);
  return Boolean(match && match[1] === chatId && UUID.test(match[1]) && UUID.test(match[2]));
}

/** A file name fit to show a parent: no folders, no control characters, a sane length, the right ending. */
export function chatFileName(raw: string, ext: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const stem = base.replace(/\.[A-Za-z0-9]{1,5}$/, "").slice(0, 80).trim() || (ext === "jpg" || ext === "png" ? "Photo" : "Document");
  return `${stem}.${ext}`;
}
