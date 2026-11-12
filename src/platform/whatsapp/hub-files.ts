import "server-only";

import type { WhatsAppConfig } from "@/platform/whatsapp/config";

/**
 * The school's WhatsApp hub, for parents' files and old chats (D-594, D-595;
 * the hub's README, hub PR 6).
 *
 *   GET  /v1/files/waiting?numbers=…&limit=…   parents' files with no Drive copy yet
 *   GET  /v1/files/{media_id}                  one file, from Meta, through the hub
 *   POST /v1/files/saved                       {wamid, drive_file_id} | {wamid, problem}
 *   GET  /v1/archive/next                      the month of chats due to leave the hub
 *   GET  /v1/archive/{YYYY-MM}?after=…         that month, 500 messages at a time
 *   POST /v1/archive/{YYYY-MM}/done            {drive_file_id, messages}
 *
 * The hub holds the WhatsApp token and decides whose files may leave (its own
 * SEND_MODE); One holds the Google identity and writes to the school's Drive.
 * A hub that has not been updated answers 404 for all of these: `missing`,
 * and One stays quiet.
 */

export type HubRefusal = {
  ok: false;
  /** No answer at all: the hub was unreachable or slow. */
  status: number | null;
  /** The hub's own code (`media_gone`, `test_mode`, `count_changed` …), when it gave one. */
  code: string | null;
  problem: string;
  /** The hub does not have this route yet (not updated). */
  missing: boolean;
};

export type HubAnswer<T> = { ok: true; value: T } | HubRefusal;

export type HubWaitingFile = {
  wamid: string;
  waId: string;
  type: string;
  mediaId: string;
  mime: string | null;
  label: string | null;
  name: string | null;
  /** UTC, "YYYY-MM-DD HH:MM:SS", as the hub writes it. */
  at: string;
  tries: number;
};

export type HubFileBytes = {
  bytes: Uint8Array;
  mime: string | null;
  /** Meta's own SHA-256 of the file, when it gave one. */
  sha256: string | null;
};

export type HubSaved = { saved: boolean; driveFileId: string | null; givenUp: boolean };

export type HubArchiveNext = { month: string | null; messages: number; reason: "old" | "full" | null; dbShare: number | null };

export type HubArchivedMessage = {
  id: number;
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

export type HubFilesClient = {
  waiting(input: { numbers: readonly string[] | null; limit: number }): Promise<HubAnswer<HubWaitingFile[]>>;
  /** `too_big` without reading the rest once the file passes `maxBytes`. */
  download(mediaId: string, maxBytes: number): Promise<HubAnswer<HubFileBytes> | { ok: false; tooBig: true }>;
  saved(input: { wamid: string; driveFileId: string } | { wamid: string; problem: string }): Promise<HubAnswer<HubSaved>>;
  archiveNext(): Promise<HubAnswer<HubArchiveNext>>;
  archivePage(month: string, after: number): Promise<HubAnswer<{ rows: HubArchivedMessage[]; next: number | null }>>;
  archiveDone(month: string, input: { driveFileId: string; messages: number }): Promise<HubAnswer<{ removed: number }>>;
};

const TIMEOUT_MS = 15_000;
/** A file can be tens of megabytes on a slow link from Meta. */
const DOWNLOAD_TIMEOUT_MS = 45_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0);

async function refusal(response: Response): Promise<HubRefusal> {
  const body = asRecord(await response.json().catch(() => null));
  const code = text(body.error);
  return {
    ok: false,
    status: response.status,
    code,
    problem: (text(body.message) ?? `The hub answered ${response.status}.`).slice(0, 300),
    // The hub's own 404 for a route it does not know says `not_found`; so does
    // a gateway. Either way there is nothing here to talk to yet.
    missing: response.status === 404 && (code === null || code === "not_found"),
  };
}

const noAnswer = (caught: unknown): HubRefusal => ({
  ok: false,
  status: null,
  code: null,
  problem: (caught instanceof Error ? caught.message : "No answer from the hub.").slice(0, 300),
  missing: false,
});

export function readWaitingFile(raw: unknown): HubWaitingFile | null {
  const r = asRecord(raw);
  const wamid = text(r.wamid);
  const waId = text(r.wa_id);
  const mediaId = text(r.media_id);
  const type = text(r.type);
  const at = text(r.at);
  if (!wamid || !waId || !mediaId || !/^\d{5,25}$/.test(mediaId) || !type || !at) return null;
  return { wamid, waId, type, mediaId, mime: text(r.mime), label: text(r.label), name: text(r.name), at, tries: count(r.tries) };
}

export function readArchivedMessage(raw: unknown): HubArchivedMessage | null {
  const r = asRecord(raw);
  const id = Number(r.id);
  const waId = text(r.wa_id);
  const createdAt = text(r.created_at);
  if (!Number.isInteger(id) || id <= 0 || !waId || !createdAt) return null;
  return {
    id,
    waId,
    name: text(r.name),
    direction: text(r.direction) ?? "",
    type: text(r.type) ?? "",
    body: typeof r.body === "string" ? r.body : null,
    templateName: text(r.template_name),
    status: text(r.status),
    sentBy: text(r.sent_by),
    source: text(r.source),
    driveFileId: text(r.drive_file_id),
    createdAt,
  };
}

export function hubFilesClient(
  config: { hubUrl: string; hubKey: string },
  fetcher: typeof fetch = fetch,
): HubFilesClient {
  const base = `${config.hubUrl}/v1`;
  const auth = { Authorization: `Bearer ${config.hubKey}` };

  async function call(path: string, init?: { method: "POST"; body: unknown }): Promise<HubAnswer<Record<string, unknown>>> {
    let response: Response;
    try {
      response = await fetcher(`${base}${path}`, {
        method: init?.method ?? "GET",
        headers: init ? { ...auth, "Content-Type": "application/json" } : auth,
        body: init ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (caught) {
      return noAnswer(caught);
    }
    if (!response.ok) return refusal(response);
    return { ok: true, value: asRecord(await response.json().catch(() => null)) };
  }

  return {
    async waiting({ numbers, limit }) {
      const query = new URLSearchParams({ limit: String(Math.max(1, Math.min(Math.floor(limit), 50))) });
      if (numbers && numbers.length) query.set("numbers", numbers.join(","));
      const answer = await call(`/files/waiting?${query.toString()}`);
      if (!answer.ok) return answer;
      const list = Array.isArray(answer.value.data) ? answer.value.data : [];
      return { ok: true, value: list.map(readWaitingFile).filter((file): file is HubWaitingFile => file !== null) };
    },

    async download(mediaId, maxBytes) {
      if (!/^\d{5,25}$/.test(mediaId)) return { ok: false, status: 400, code: "bad_media", problem: "Bad media id.", missing: false };
      let response: Response;
      try {
        response = await fetcher(`${base}/files/${mediaId}`, {
          headers: auth,
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
          cache: "no-store",
        });
      } catch (caught) {
        return noAnswer(caught);
      }
      if (!response.ok) return refusal(response);
      const declared = Number(response.headers.get("x-file-size") ?? response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel().catch(() => {});
        return { ok: false, tooBig: true };
      }
      // Read with a running cap: a size the hub did not state is still bounded.
      const parts: Uint8Array[] = [];
      let total = 0;
      try {
        const reader = response.body?.getReader();
        if (reader) {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
              await reader.cancel().catch(() => {});
              return { ok: false, tooBig: true };
            }
            parts.push(value);
          }
        }
      } catch (caught) {
        return noAnswer(caught);
      }
      const bytes = new Uint8Array(total);
      let at = 0;
      for (const part of parts) {
        bytes.set(part, at);
        at += part.byteLength;
      }
      const sha = response.headers.get("x-file-sha256");
      return {
        ok: true,
        value: {
          bytes,
          mime: response.headers.get("content-type")?.split(";")[0]?.trim() || null,
          sha256: sha && /^[0-9a-f]{64}$/i.test(sha) ? sha.toLowerCase() : null,
        },
      };
    },

    async saved(input) {
      const body = "driveFileId" in input ? { wamid: input.wamid, drive_file_id: input.driveFileId } : { wamid: input.wamid, problem: input.problem };
      const answer = await call("/files/saved", { method: "POST", body });
      if (!answer.ok) return answer;
      return {
        ok: true,
        value: { saved: answer.value.saved === true, driveFileId: text(answer.value.drive_file_id), givenUp: answer.value.given_up === true },
      };
    },

    async archiveNext() {
      const answer = await call("/archive/next");
      if (!answer.ok) return answer;
      const month = text(answer.value.month);
      const reason = answer.value.reason === "old" || answer.value.reason === "full" ? answer.value.reason : null;
      const share = Number(answer.value.db_share);
      return {
        ok: true,
        value: {
          month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null,
          messages: count(answer.value.messages),
          reason,
          dbShare: Number.isFinite(share) && answer.value.db_share !== null ? share : null,
        },
      };
    },

    async archivePage(month, after) {
      const answer = await call(`/archive/${month}?after=${Math.max(0, Math.floor(after))}`);
      if (!answer.ok) return answer;
      const list = Array.isArray(answer.value.data) ? answer.value.data : [];
      const rows = list.map(readArchivedMessage);
      // A row this cannot read is a row the file would lose: refuse the page.
      if (rows.some((row) => row === null)) {
        return { ok: false, status: 200, code: "unreadable_row", problem: "The hub sent a message this could not read.", missing: false };
      }
      const next = Number(answer.value.next);
      return { ok: true, value: { rows: rows as HubArchivedMessage[], next: answer.value.next === null || !Number.isInteger(next) ? null : next } };
    },

    async archiveDone(month, input) {
      const answer = await call(`/archive/${month}/done`, { method: "POST", body: { drive_file_id: input.driveFileId, messages: input.messages } });
      if (!answer.ok) return answer;
      return { ok: true, value: { removed: count(answer.value.removed) } };
    },
  };
}

/** The client for One's own hub connection, or null when One does not talk to the hub. */
export function hubFilesFor(config: WhatsAppConfig, fetcher: typeof fetch = fetch): HubFilesClient | null {
  if (!config.ok || config.provider !== "hub") return null;
  return hubFilesClient({ hubUrl: config.hubUrl, hubKey: config.hubKey }, fetcher);
}
