import type { ChatFilter } from "@/modules/chats/domain/filters";
import type { ChatLanguage } from "@/modules/chats/domain/types";
import { dayMonthP, schoolToday, timeP } from "@/vx/format";
import type { Pair } from "@/vx/text";

import type { ChatMessageView } from "./view";
import { QUICK_REPLIES, T } from "./words";

/*
 * The Chats screens' own small rules (D-616), kept apart from the components
 * so they are tested without a browser: where a tap goes, how a day and a
 * time read, how the lines the polling brings join the ones on screen, and
 * whether a message reaches the parent now or waits for them. Pure.
 */

/* ------------------------------------------------------------- links */

/** The list's address, with the same filter and one change; every default is left out. */
export function chatsHref(filter: ChatFilter, patch: Partial<ChatFilter> & { chat?: string | null } = {}): string {
  const next = { ...filter, ...patch };
  const params = new URLSearchParams();
  if (next.view !== "you") params.set("view", next.view);
  if (next.show !== "active") params.set("show", next.show);
  if (next.teacherId) params.set("teacher", next.teacherId);
  if (next.dues) params.set("dues", "1");
  if (next.query) params.set("q", next.query);
  if (patch.chat) params.set("c", patch.chat);
  const query = params.toString();
  return query ? `/chats?${query}` : "/chats";
}

/* ------------------------------------------------------------ times */

const DAY_MS = 86_400_000;

/** The school day a moment falls on (IST), for the day lines between messages. */
export function dayKey(at: string): string {
  const time = Date.parse(at);
  return Number.isFinite(time) ? schoolToday(new Date(time)) : "";
}

/** "Today", "Yesterday" or "12 Nov" for the line that opens a day's messages. */
export function dayLabel(at: string, now: string): Pair {
  const key = dayKey(at);
  const nowMs = Date.parse(now);
  if (!key || !Number.isFinite(nowMs)) return dayMonthP(at);
  if (key === schoolToday(new Date(nowMs))) return T.today;
  if (key === schoolToday(new Date(nowMs - DAY_MS))) return T.yesterday;
  return dayMonthP(at);
}

/** A list row's time, as WhatsApp writes it: the time today, "Yesterday", else the date. */
export function rowTime(at: string, now: string): Pair {
  const key = dayKey(at);
  const nowMs = Date.parse(now);
  if (!key || !Number.isFinite(nowMs)) return { en: "" };
  if (key === schoolToday(new Date(nowMs))) return timeP(at);
  if (key === schoolToday(new Date(nowMs - DAY_MS))) return T.yesterday;
  return dayMonthP(at);
}

/* --------------------------------------------------------- the lines */

const timeOf = (value: string) => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
};

/** Oldest first, as WhatsApp draws them; the same moment keeps the order it came in. */
export function sortLines<T extends Pick<ChatMessageView, "at">>(lines: readonly T[]): T[] {
  return lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => timeOf(a.line.at) - timeOf(b.line.at) || a.index - b.index)
    .map((entry) => entry.line);
}

/**
 * The lines on screen with what the polling (or a send) brought: a line seen
 * before is replaced by its newer self (a tick that moved, a failure), and a
 * line the screen drew itself while sending (`local`, found by `ref`) gives
 * way to the saved one.
 */
export function mergeLines(current: readonly ChatMessageView[], incoming: readonly ChatMessageView[]): ChatMessageView[] {
  if (incoming.length === 0) return [...current];
  const byId = new Map(incoming.map((line) => [line.id, line]));
  const refs = new Map(incoming.filter((line) => line.ref).map((line) => [line.ref as string, line]));
  const kept: ChatMessageView[] = [];
  const placed = new Set<string>();
  for (const line of current) {
    const newer = byId.get(line.id) ?? (line.ref ? refs.get(line.ref) : undefined);
    if (newer) {
      if (!placed.has(newer.id)) {
        kept.push(newer);
        placed.add(newer.id);
      }
    } else kept.push(line);
  }
  for (const line of incoming) {
    if (placed.has(line.id)) continue;
    kept.push(line);
    placed.add(line.id);
  }
  return sortLines(kept);
}

/** A line the screen draws at once while it sends; the saved line replaces it. */
export function localLine(input: { ref: string; text: string; at: string; by: Pair; file: ChatMessageView["file"] }): ChatMessageView {
  return {
    id: `local:${input.ref}`,
    direction: "out",
    kind: input.file ? (input.file.kind === "image" ? "image" : "document") : "text",
    body: input.text || null,
    at: input.at,
    by: input.by,
    as: null,
    tick: "sending",
    problem: null,
    resent: false,
    file: input.file,
    map: null,
    contacts: null,
    event: null,
    ref: input.ref,
  };
}

export const isLocal = (line: Pick<ChatMessageView, "id">) => line.id.startsWith("local:");

/**
 * A new id for a message the screen sends, which also makes a repeated send
 * harmless (the server keeps one per id). `crypto.randomUUID` is missing on
 * some older phones' browsers, so it is made from random bytes there.
 */
export function newRef(source: Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string } = globalThis.crypto): string {
  if (typeof source.randomUUID === "function") return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Who wrote a line, for grouping: the parent, the AI, a note, or a person at school by name. */
function speakerOf(line: ChatMessageView): string {
  if (line.direction === "in") return "in";
  if (line.direction === "ai") return "ai";
  if (line.direction === "note") return "note";
  return `out:${line.by?.en ?? ""}`;
}

const RUN_GAP_MS = 5 * 60_000;

export type DrawnLine = {
  line: ChatMessageView;
  /** A new day starts here: draw its date line first. */
  day: Pair | null;
  /** The first of a run from the same person: say who wrote it. */
  head: boolean;
};

/** The lines as they are drawn: a date line at each new day, and the writer named at the start of each run. */
export function drawLines(lines: readonly ChatMessageView[], now: string): DrawnLine[] {
  let lastDay = "";
  let last: ChatMessageView | null = null;
  return lines.map((line) => {
    const key = dayKey(line.at);
    const day = key && key !== lastDay ? dayLabel(line.at, now) : null;
    if (key) lastDay = key;
    const head = !last || day !== null || speakerOf(last) !== speakerOf(line) || timeOf(line.at) - timeOf(last.at) > RUN_GAP_MS;
    last = line;
    return { line, day, head };
  });
}

/* ---------------------------------------------------------- the window */

export type WindowState = "open" | "closed" | "never";

/** Whether a typed message reaches the parent now: inside WhatsApp's 24 hours since they last wrote. */
export function windowState(windowUntil: string | null, now: string): WindowState {
  if (!windowUntil) return "never";
  const until = Date.parse(windowUntil);
  const at = Date.parse(now);
  if (!Number.isFinite(until) || !Number.isFinite(at)) return "never";
  return at < until ? "open" : "closed";
}

/* ------------------------------------------------------------ a file */

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

/**
 * What a chosen file is, from what the browser says and else from its name
 * (an Android file picker often says nothing for a Word file): a photo to
 * make smaller, a document to send as it is, or something we do not send.
 * The server reads the bytes again before anything goes.
 */
export function pickedKind(name: string, type: string): { kind: "photo" } | { kind: "document"; mime: string } | null {
  const declared = type.trim().toLowerCase();
  if (declared.startsWith("image/")) return { kind: "photo" };
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name.trim())?.[1]?.toLowerCase() ?? "";
  const mime = Object.values(MIME_BY_EXT).includes(declared) ? declared : MIME_BY_EXT[ext] ?? "";
  if (!mime) return null;
  if (mime.startsWith("image/")) return { kind: "photo" };
  return { kind: "document", mime };
}

/** A photo's name for the parent: the date it was sent, never the phone's own file name. */
export function photoName(at: string): string {
  const day = dayKey(at);
  return day ? `Photo ${day}.jpg` : "Photo.jpg";
}

/* ------------------------------------------------------------ smaller */

/** "240 KB", "1.4 MB". */
export function sizeWords(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The ready lines in the parent's own language. */
export function quickReplies(language: ChatLanguage): readonly string[] {
  return QUICK_REPLIES[language] ?? QUICK_REPLIES.en;
}

/** Speech in the parent's language: Hindi for Hindi and Hinglish, English for English. */
export function speechLang(language: ChatLanguage): "hi-IN" | "en-IN" {
  return language === "en" ? "en-IN" : "hi-IN";
}

/** "+919829012345" for the phone's dialler. */
export function telHref(e164: string): string {
  return `tel:${e164.replace(/[^\d+]/g, "")}`;
}

/** How long after tapping Call the chat still asks whether the call settled it (D-645). */
export const CALL_ASK_MS = 2 * 60 * 60 * 1000;

/** Whether a Call tapped at `calledAt` still asks "Did the call settle it?" at `now`: within two hours, never from the future. */
export function callAskOpen(calledAt: string | null, now: string): boolean {
  if (!calledAt) return false;
  const at = Date.parse(calledAt);
  const clock = Date.parse(now);
  if (!Number.isFinite(at) || !Number.isFinite(clock)) return false;
  return at <= clock + 60_000 && clock - at < CALL_ASK_MS;
}
