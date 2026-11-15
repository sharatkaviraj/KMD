import "server-only";

import {
  chatFilePath,
  chatFileTypeOf,
  isChatFilePath,
  maxBytesFor,
  sniffChatFile,
  type ChatFileKind,
  type ChatFileType,
} from "@/modules/chats/domain/files";
import { readWhatsAppConfig } from "@/platform/whatsapp/config";
import { hubFilesFor } from "@/platform/whatsapp/hub-files";
import { whatsappDb } from "@/platform/whatsapp/store";

/**
 * Photos and files in parent chats (D-616).
 *
 * What somebody at school sends goes up from their phone straight to the
 * private shelf `parent-chat-files` with a signed upload link for one path,
 * and is checked here before it is sent: the right size, and a JPEG, a PNG,
 * a PDF, a Word or an Excel file by its first bytes. WhatsApp then fetches
 * it once through a link that works for an hour.
 *
 * What a parent sends stays where WhatsApp keeps it, and is fetched through
 * the school's hub only when a person at school opens it.
 */

export const CHAT_FILES_BUCKET = "parent-chat-files";

type Db = ReturnType<typeof whatsappDb>;

export type UploadStart = { ok: true; path: string; token: string } | { ok: false; reason: "type" | "size" | "storage" };

/** A signed upload link for one new file in one chat. The caller has checked that the person may write in it. */
export async function beginChatUpload(
  input: { chatId: string; mime: string; bytes: number; kind: ChatFileKind },
  db: Db = whatsappDb(),
): Promise<UploadStart> {
  const type = chatFileTypeOf(input.mime);
  if (!type || type.kind !== input.kind) return { ok: false, reason: "type" };
  if (!Number.isFinite(input.bytes) || input.bytes <= 0 || input.bytes > maxBytesFor(type.kind)) return { ok: false, reason: "size" };
  const path = chatFilePath(input.chatId, crypto.randomUUID(), type.ext);
  const { data, error } = await db.storage.from(CHAT_FILES_BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (error || !data?.token) return { ok: false, reason: "storage" };
  return { ok: true, path, token: data.token };
}

export type CheckedFile = { path: string; type: ChatFileType; bytes: number };

/**
 * The uploaded file, checked: on this chat's shelf, there, not too big, and
 * by its first bytes the kind its name says. Null when it is none of that.
 */
export async function checkChatUpload(input: { chatId: string; path: string; filename: string }, db: Db = whatsappDb()): Promise<CheckedFile | null> {
  if (!isChatFilePath(input.path, input.chatId)) return null;
  const { data, error } = await db.storage.from(CHAT_FILES_BUCKET).download(input.path);
  if (error || !data) return null;
  if (data.size <= 0 || data.size > maxBytesFor("document")) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  const type = sniffChatFile(bytes.subarray(0, 16), input.filename || input.path);
  if (!type || data.size > maxBytesFor(type.kind)) return null;
  // The path's ending was chosen from the type the browser declared; the bytes must agree with it.
  if (!input.path.toLowerCase().endsWith(`.${type.ext}`)) return null;
  return { path: input.path, type, bytes: data.size };
}

/** A link to a file on the shelf that works for `seconds` (an hour for WhatsApp, a few minutes for a screen). */
export async function chatFileLink(path: string, seconds: number, options: { download?: string } = {}, db: Db = whatsappDb()): Promise<string | null> {
  const { data, error } = await db.storage
    .from(CHAT_FILES_BUCKET)
    .createSignedUrl(path, seconds, options.download ? { download: options.download } : undefined);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export type ParentFile = { ok: true; bytes: Uint8Array; mime: string | null } | { ok: false; reason: "gone" | "too_big" | "unavailable" };

/** The most a parent's file may weigh to be shown in One: WhatsApp's own ceiling for a document. */
const PARENT_FILE_MAX_BYTES = 100 * 1024 * 1024;

/** A parent's photo or file, through the school's hub, for a person at school to look at. */
export async function readParentFile(mediaId: string): Promise<ParentFile> {
  if (!/^\d{5,25}$/.test(mediaId)) return { ok: false, reason: "gone" };
  const hub = hubFilesFor(readWhatsAppConfig());
  if (!hub) return { ok: false, reason: "unavailable" };
  const answer = await hub.download(mediaId, PARENT_FILE_MAX_BYTES).catch(() => null);
  if (!answer) return { ok: false, reason: "unavailable" };
  if (answer.ok) return { ok: true, bytes: answer.value.bytes, mime: answer.value.mime };
  if ("tooBig" in answer) return { ok: false, reason: "too_big" };
  return { ok: false, reason: answer.status === 404 || answer.code === "media_gone" ? "gone" : "unavailable" };
}
