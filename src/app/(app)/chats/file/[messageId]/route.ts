import { NextResponse, type NextRequest } from "next/server";

import { chatFileLink, readParentFile } from "@/modules/chats/data/files";
import { currentChatViewer } from "@/modules/chats/data/people";
import { isUuid, readChatById, readMessage } from "@/modules/chats/data/store";
import { chatAccess } from "@/modules/chats/domain/access";

/**
 * A photo, file or voice note in a parent chat (D-616), for a person who may
 * read that chat, and nobody else: anything else is the same 404.
 *
 *  - A file somebody at school sent is on the private shelf: a link that
 *    works for five minutes, followed at once.
 *  - A parent's file stays where WhatsApp keeps it and comes through the
 *    school's hub now. Pictures, sound, video and PDFs open in place; any
 *    other kind is only ever a download, so nothing a parent sends can run
 *    as a page of One.
 *
 * `?download=1` saves it under its own name instead of opening it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_HERE = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** What a parent's file may be shown as, in place. */
const INLINE = /^(image\/(jpeg|png|webp|gif)|audio\/(ogg|mpeg|mp4|aac|amr|opus)|video\/(mp4|3gpp)|application\/pdf)$/;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
};

/** A file name a browser will keep as it is: letters, digits, dots, dashes and spaces only. */
function plainName(raw: string | null | undefined, mime: string): string {
  const cleaned = (raw ?? "").normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (cleaned && cleaned !== "." && cleaned !== "..") return cleaned;
  return `parent-file.${EXTENSIONS[mime] ?? "bin"}`;
}

export async function GET(request: NextRequest, context: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await context.params;
  if (!isUuid(messageId)) return NOT_HERE();
  const reader = await currentChatViewer();
  if (!reader) return NOT_HERE();

  const message = await readMessage(messageId).catch(() => null);
  if (!message?.media) return NOT_HERE();
  const chat = await readChatById(message.chatId).catch(() => null);
  if (!chat || chatAccess(reader.viewer, chat) === "none") return NOT_HERE();
  const download = request.nextUrl.searchParams.get("download") === "1";

  if (message.media.path) {
    const name = plainName(message.media.filename, message.media.mime ?? "");
    const link = await chatFileLink(message.media.path, 300, download ? { download: name } : {}).catch(() => null);
    if (!link) return NOT_HERE();
    const response = NextResponse.redirect(link, 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

  if (!message.media.mediaId) return NOT_HERE();
  const file = await readParentFile(message.media.mediaId);
  if (!file.ok) {
    const status = file.reason === "gone" ? 410 : file.reason === "too_big" ? 413 : 503;
    return NextResponse.json({ ok: false, reason: file.reason }, { status, headers: { "Cache-Control": "no-store" } });
  }
  const declared = (file.mime ?? message.media.mime ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const inline = !download && INLINE.test(declared);
  const name = plainName(message.media.filename, declared);
  const headers: Record<string, string> = {
    "Content-Type": inline ? declared : "application/octet-stream",
    "Content-Length": String(file.bytes.byteLength),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  // A browser's own PDF viewer needs its plug-in; a picture or a sound needs nothing else at all.
  if (declared !== "application/pdf") headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'";
  return new Response(file.bytes as unknown as BodyInit, { status: 200, headers });
}
