import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/platform/observability/log", () => ({ logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/platform/whatsapp/store", () => ({ readSwitches: vi.fn(), queueSecretMatches: vi.fn(async () => false) }));
vi.mock("@/modules/collection/data/drive-documents", () => ({ driveTarget: vi.fn(), supabaseUploadStore: vi.fn() }));
vi.mock("@/modules/collection/data/storage-settings", () => ({ readStorageSettings: vi.fn() }));

import {
  chatsCsv,
  chatsFileName,
  CSV_BOM,
  driveFileName,
  fileScope,
  filesFolder,
  filesMonthFolder,
  hubTime,
  indiaStamp,
  isParentFileType,
  kindWord,
  messageTag,
  monthFolderName,
  scopeAllows,
  type ArchivedRow,
  type FileToName,
} from "@/modules/whatsapp/domain/parent-files";
import { archiveOldChats, copyFilesFromWebhook, copyParentFiles, sweepParentFiles, type ParentFilesDeps } from "@/modules/whatsapp/data/parent-files";
import { readWhatsAppConfig } from "@/platform/whatsapp/config";
import {
  hubFilesClient,
  hubFilesFor,
  type HubAnswer,
  type HubArchivedMessage,
  type HubArchiveNext,
  type HubFileBytes,
  type HubFilesClient,
  type HubSaved,
  type HubWaitingFile,
} from "@/platform/whatsapp/hub-files";
import type { WhatsAppSwitches } from "@/platform/whatsapp/policy";
import type { WebhookInbound } from "@/platform/whatsapp/webhook";

import { driveDepsFor, FakeDrive, ROOT_FOLDER } from "./fake-drive.fixture";

/**
 * Parents' files and old chats into the school's Drive (D-594, D-595). Every
 * number, name and file here is made up (rule 6). The hub is an in-memory
 * stand-in for its `/v1/files` and `/v1/archive` routes, and Drive is the
 * shared fake.
 */

const OWNER = "+919000000001";
const OWNER_WA = "919000000001";
const OTHER_WA = "919000000002";
/** 18:42 in India on 12 Nov 2026. */
const AT = "2026-11-12 13:12:00";
const NOW = new Date("2026-11-12T14:00:00Z");

const switches = (over: Partial<WhatsAppSwitches> = {}): WhatsAppSwitches => ({
  dryRun: true,
  features: { parent_helper: true },
  realRecipients: false,
  ownerTestNumber: OWNER,
  dailyLimit: 250,
  ...over,
});

const ascii = (text: string) => new TextEncoder().encode(text);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const refused = (status: number | null, code: string | null, missing = false) => ({ ok: false as const, status, code, problem: code ?? "no answer", missing });

type HubFile = { file: HubWaitingFile; bytes: Uint8Array; sha256?: string | null; answer?: "gone" | "forbidden" | "busy" };

/** The hub's file queue and archive, in memory, with every call kept. */
class FakeHub implements HubFilesClient {
  files = new Map<string, HubFile>();
  driveIds = new Map<string, string>();
  problems: Array<{ wamid: string; problem: string }> = [];
  calls: string[] = [];
  savedAnswer: "ok" | "unreachable" = "ok";
  notUpdated = false;
  messages: HubArchivedMessage[] = [];
  due: string | null = null;
  pageSize = 500;
  done: Array<{ month: string; driveFileId: string; messages: number }> = [];
  doneAnswer: "ok" | "count_changed" = "ok";
  /** Messages the hub receives between being asked what is due and being told it is done. */
  arriveBeforeDone = 0;

  add(over: Partial<HubWaitingFile> & { wamid: string }, bytes = ascii(`synthetic bytes for ${over.wamid}`), extra: Partial<HubFile> = {}) {
    const file: HubWaitingFile = { waId: OWNER_WA, type: "image", mediaId: String(10_000_000 + this.files.size), mime: "image/jpeg", label: null, name: "Test Parent", at: AT, tries: 0, ...over };
    this.files.set(file.wamid, { file, bytes, sha256: sha(bytes), ...extra });
    return file;
  }

  async waiting(input: { numbers: readonly string[] | null; limit: number }): Promise<HubAnswer<HubWaitingFile[]>> {
    this.calls.push(`waiting ${input.numbers?.join(",") ?? "all"}`);
    if (this.notUpdated) return refused(404, "not_found", true);
    const list = [...this.files.values()]
      .filter((entry) => !this.driveIds.has(entry.file.wamid) && entry.file.tries < 5)
      .filter((entry) => !input.numbers || input.numbers.includes(entry.file.waId))
      .slice(0, input.limit)
      .map((entry) => entry.file);
    return { ok: true, value: list };
  }

  async download(mediaId: string, maxBytes: number): Promise<HubAnswer<HubFileBytes> | { ok: false; tooBig: true }> {
    this.calls.push(`download ${mediaId}`);
    const entry = [...this.files.values()].find((candidate) => candidate.file.mediaId === mediaId);
    if (!entry) return refused(404, "not_found");
    if (entry.answer === "gone") return refused(410, "media_gone");
    if (entry.answer === "forbidden") return refused(403, "test_mode");
    if (entry.answer === "busy") return refused(502, "meta_unreachable");
    if (entry.bytes.byteLength > maxBytes) return { ok: false, tooBig: true };
    return { ok: true, value: { bytes: entry.bytes, mime: entry.file.mime, sha256: entry.sha256 ?? null } };
  }

  async saved(input: { wamid: string; driveFileId: string } | { wamid: string; problem: string }): Promise<HubAnswer<HubSaved>> {
    this.calls.push(`saved ${input.wamid}`);
    if ("problem" in input) {
      this.problems.push({ wamid: input.wamid, problem: input.problem });
      const entry = this.files.get(input.wamid)!;
      entry.file.tries = ["too_big", "gone", "not_allowed"].includes(input.problem) ? 5 : entry.file.tries + 1;
      return { ok: true, value: { saved: false, driveFileId: null, givenUp: entry.file.tries >= 5 } };
    }
    if (this.savedAnswer === "unreachable") return refused(null, null);
    if (!this.driveIds.has(input.wamid)) this.driveIds.set(input.wamid, input.driveFileId);
    return { ok: true, value: { saved: true, driveFileId: this.driveIds.get(input.wamid)!, givenUp: false } };
  }

  async archiveNext(): Promise<HubAnswer<HubArchiveNext>> {
    this.calls.push("archive next");
    if (this.notUpdated) return refused(404, "not_found", true);
    const count = this.due ? this.messages.filter((row) => row.createdAt.startsWith(this.due!)).length : 0;
    return { ok: true, value: { month: this.due, messages: count, reason: this.due ? "old" : null, dbShare: 0.01 } };
  }

  async archivePage(month: string, after: number): Promise<HubAnswer<{ rows: HubArchivedMessage[]; next: number | null }>> {
    this.calls.push(`archive ${month} after ${after}`);
    const rows = this.messages.filter((row) => row.createdAt.startsWith(month) && row.id > after).slice(0, this.pageSize);
    return { ok: true, value: { rows, next: rows.length === this.pageSize ? rows[rows.length - 1]!.id : null } };
  }

  async archiveDone(month: string, input: { driveFileId: string; messages: number }): Promise<HubAnswer<{ removed: number }>> {
    this.calls.push(`archive ${month} done`);
    for (let index = 0; index < this.arriveBeforeDone; index += 1) this.messages.push(row(9_000 + index, `${month}-28 10:00:00`));
    const holding = this.messages.filter((candidate) => candidate.createdAt.startsWith(month)).length;
    if (this.doneAnswer === "count_changed" || holding !== input.messages) return refused(409, "count_changed");
    this.done.push({ month, ...input });
    this.messages = this.messages.filter((candidate) => !candidate.createdAt.startsWith(month));
    this.due = null;
    return { ok: true, value: { removed: input.messages } };
  }
}

function row(id: number, createdAt: string, over: Partial<HubArchivedMessage> = {}): HubArchivedMessage {
  return { id, waId: OWNER_WA, name: "Test Parent", direction: "in", type: "text", body: `message ${id}`, templateName: null, status: "received", sentBy: null, source: null, driveFileId: null, createdAt, ...over };
}

function setup(over: { switches?: WhatsAppSwitches | null; drive?: boolean } = {}) {
  const hub = new FakeHub();
  const drive = new FakeDrive();
  const registry = new Map<string, string>();
  const deps: ParentFilesDeps = {
    readSwitches: async () => (over.switches === undefined ? switches() : over.switches),
    hub: () => hub,
    drive: async () => (over.drive === false ? null : { deps: driveDepsFor(drive), rootFolderId: ROOT_FOLDER }),
    folders: {
      folderFor: async (key) => registry.get(key) ?? null,
      claimFolder: async (key, id) => {
        if (!registry.has(key)) registry.set(key, id);
        return registry.get(key)!;
      },
    },
    now: () => NOW,
  };
  /** Drive's files under one folder path from the root, by name. */
  const filesIn = (...path: string[]) => {
    let parent = ROOT_FOLDER;
    for (const name of path) {
      const folder = [...drive.files.values()].find((file) => file.parents.includes(parent) && file.name === name && file.mimeType.endsWith("folder"));
      if (!folder) return [];
      parent = folder.id;
    }
    return [...drive.files.values()].filter((file) => file.parents.includes(parent) && !file.mimeType.endsWith("folder"));
  };
  return { hub, drive, registry, deps, filesIn };
}

const tagOf = (wamid: string) => messageTag(wamid);

// ----------------------------------------------------------------- domain

describe("whose files are copied (D-594)", () => {
  it("copies nothing while Veer Patta AI is off, or when the switches cannot be read", () => {
    expect(fileScope(null)).toBeNull();
    expect(fileScope(switches({ features: { parent_helper: false } }))).toBeNull();
    expect(fileScope(switches({ features: {} }))).toBeNull();
  });

  it("in practice copies only the owner's own number, into the practice folder", () => {
    expect(fileScope(switches())).toEqual({ practice: true, numbers: [OWNER_WA] });
    expect(fileScope(switches({ ownerTestNumber: null }))).toBeNull();
    const scope = fileScope(switches())!;
    expect(scopeAllows(scope, OWNER_WA)).toBe(true);
    expect(scopeAllows(scope, OWNER)).toBe(true);
    expect(scopeAllows(scope, OTHER_WA)).toBe(false);
  });

  it("once real parents are on, copies everyone the hub allows", () => {
    const scope = fileScope(switches({ realRecipients: true }))!;
    expect(scope).toEqual({ practice: false, numbers: null });
    expect(scopeAllows(scope, OTHER_WA)).toBe(true);
  });

  it("keeps photos, videos, voice notes and documents, never a sticker or a text", () => {
    for (const type of ["image", "video", "audio", "document"]) expect(isParentFileType(type)).toBe(true);
    for (const type of ["sticker", "text", "location", "", null]) expect(isParentFileType(type)).toBe(false);
  });
});

describe("a name the office can find again", () => {
  const photo: FileToName = { wamid: "wamid.TEST1", waId: OWNER_WA, type: "image", mime: "image/jpeg", label: "Fee receipt", name: "Test Parent", at: AT };

  it("starts with the date and time in India, then who, what and the caption", () => {
    expect(driveFileName(photo)).toBe(`2026-11-12 18.42 · Test Parent (…0001) · Photo · Fee receipt · ${tagOf("wamid.TEST1")}.jpg`);
  });

  it("names a voice note, and a sender the school has no name for", () => {
    const voice = { ...photo, wamid: "wamid.TEST2", type: "audio", mime: "audio/ogg; codecs=opus", label: null, name: null };
    expect(driveFileName(voice)).toBe(`2026-11-12 18.42 · …0001 · Voice note · ${tagOf("wamid.TEST2")}.ogg`);
    expect(kindWord("audio", "audio/mpeg")).toBe("Audio");
    expect(kindWord("video", "video/mp4")).toBe("Video");
    expect(kindWord("document", "application/pdf")).toBe("File");
  });

  it("keeps a document's own file name and its extension once", () => {
    const pdf = { ...photo, wamid: "wamid.TEST3", type: "document", mime: "application/pdf", label: "TC request.PDF" };
    expect(driveFileName(pdf)).toBe(`2026-11-12 18.42 · Test Parent (…0001) · File · TC request · ${tagOf("wamid.TEST3")}.pdf`);
    const unknown = { ...pdf, mime: null, label: "marks.xlsx" };
    expect(driveFileName(unknown)).toMatch(/· File · marks · [0-9a-f]{6}\.xlsx$/);
    // A photo's caption is the parent's words, whatever they end with.
    expect(driveFileName({ ...photo, label: "paid.ok" })).toMatch(/· Photo · paid\.ok · [0-9a-f]{6}\.jpg$/);
  });

  it("dates by India's clock, so a file sent after midnight there is the next day's", () => {
    const late = { ...photo, at: "2026-11-30 19:00:00" };
    expect(driveFileName(late).startsWith("2026-12-01 00.30 ·")).toBe(true);
    expect(indiaStamp(hubTime(late.at)!).month).toBe("2026-12");
  });

  it("drops what Drive or a phone trips over, and shortens a long caption", () => {
    const awkward = { ...photo, name: 'A/B: "C"*', label: `${"long ".repeat(30)}end` };
    const name = driveFileName(awkward);
    expect(name).toContain("· A B C (…0001) ·");
    expect(name).not.toMatch(/[/\\:*?"<>|]/);
    expect(name).toMatch(/…/);
  });

  it("gives one message one name, so a second try finds the first copy", () => {
    expect(driveFileName(photo)).toBe(driveFileName({ ...photo }));
    expect(tagOf("wamid.TEST1")).not.toBe(tagOf("wamid.TEST9"));
  });

  it("keeps practice files apart, and every folder key fits the registry", () => {
    expect(filesFolder(true).name).toBe("WhatsApp from parents (practice)");
    expect(filesFolder(false).name).toBe("WhatsApp from parents");
    expect(filesMonthFolder(true, "2026-11")).toEqual({ key: "wa-files:practice:2026-11", name: "2026-11 November" });
    expect(monthFolderName("2027-01")).toBe("2027-01 January");
    for (const key of [filesMonthFolder(true, "2026-11").key, filesMonthFolder(false, "2026-11").key]) expect(key.length).toBeLessThanOrEqual(40);
  });

  it("reads the hub's clock and refuses anything else", () => {
    expect(hubTime(AT)?.toISOString()).toBe("2026-11-12T13:12:00.000Z");
    expect(hubTime("yesterday")).toBeNull();
  });
});

describe("a month of chats as a spreadsheet (D-595)", () => {
  const rows: ArchivedRow[] = [
    row(1, "2026-05-02 04:30:00", { body: "नमस्ते, फ़ीस कब जमा करें?" }),
    row(2, "2026-05-02 04:31:00", { direction: "out", body: 'Answer, with "quotes"\nand a line', sentBy: "one", source: "api:one", status: "read" }),
    row(3, "2026-05-03 10:00:00", { body: "=HYPERLINK(1)", type: "text" }),
    row(4, "2026-05-03 10:01:00", { type: "image", body: "📷 Photo", driveFileId: "1SyntheticFile00000000" }),
  ];

  it("opens in Excel with Hindi intact, in the order the messages came", () => {
    const csv = chatsCsv(rows);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("When (India),Number,Name,Direction,Kind,Message,Template,Status,Sent by,File in Drive");
    expect(lines[1]).toBe("2026-05-02 10:00,91 90000 00001,Test Parent,To the school,text,\"नमस्ते, फ़ीस कब जमा करें?\",,received,,");
    expect(csv).toContain('"Answer, with ""quotes""\nand a line"');
    expect(csv).toContain("From the school");
    expect(csv).toContain(",one app,");
  });

  it("keeps a cell that looks like a formula as text, and links the Drive copy", () => {
    const csv = chatsCsv(rows);
    expect(csv).toContain(",'=HYPERLINK(1),");
    expect(csv).toContain("https://drive.google.com/file/d/1SyntheticFile00000000/view");
    expect(chatsFileName("2026-05")).toBe("WhatsApp chats 2026-05.csv");
  });
});

// ------------------------------------------------------------- hub client

describe("the hub's file routes, as One calls them", () => {
  type Seen = { url: string; method: string; auth: string | null; body: unknown };
  function fakeFetch(answer: (seen: Seen) => Response) {
    const seen: Seen[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = { url: String(input), method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization"), body: typeof init?.body === "string" ? JSON.parse(init.body) : null };
      seen.push(call);
      return answer(call);
    }) as unknown as typeof fetch;
    return { seen, client: hubFilesClient({ hubUrl: "https://hub.example.test", hubKey: "one-test-key-not-real" }, fetcher) };
  }

  it("asks for the waiting files of named numbers with One's key, and drops a row it cannot read", async () => {
    const { seen, client } = fakeFetch(() =>
      Response.json({ ok: true, data: [{ wamid: "wamid.A", wa_id: OWNER_WA, type: "image", media_id: "123456789", mime: "image/jpeg", label: null, name: null, at: AT, tries: 0 }, { wamid: "wamid.B" }] }),
    );
    const answer = await client.waiting({ numbers: [OWNER_WA], limit: 10 });
    expect(seen[0]).toMatchObject({ url: `https://hub.example.test/v1/files/waiting?limit=10&numbers=${OWNER_WA}`, auth: "Bearer one-test-key-not-real" });
    expect(answer.ok && answer.value.map((file) => file.wamid)).toEqual(["wamid.A"]);
  });

  it("reads a hub that has not been updated as missing, and stays quiet", async () => {
    const { client } = fakeFetch(() => Response.json({ ok: false, error: "not_found", message: "Not found." }, { status: 404 }));
    expect(await client.waiting({ numbers: null, limit: 10 })).toMatchObject({ ok: false, missing: true });
    expect(await client.archiveNext()).toMatchObject({ ok: false, missing: true });
  });

  it("refuses a file past the cap, by its stated size or as it streams", async () => {
    const declared = fakeFetch(() => new Response("x".repeat(10), { headers: { "x-file-size": "999999999", "content-type": "image/jpeg" } }));
    expect(await declared.client.download("123456789", 1_000)).toEqual({ ok: false, tooBig: true });
    const streamed = fakeFetch(() => new Response("x".repeat(2_000), { headers: { "content-type": "application/pdf" } }));
    expect(await streamed.client.download("123456789", 1_000)).toEqual({ ok: false, tooBig: true });
  });

  it("hands back the bytes, the bare type and Meta's checksum", async () => {
    const bytes = ascii("synthetic file");
    const { seen, client } = fakeFetch(() => new Response(bytes, { headers: { "content-type": "audio/ogg; codecs=opus", "x-file-sha256": sha(bytes).toUpperCase() } }));
    const answer = await client.download("123456789", 1_000);
    expect(seen[0]!.url).toBe("https://hub.example.test/v1/files/123456789");
    expect(answer).toMatchObject({ ok: true, value: { mime: "audio/ogg", sha256: sha(bytes) } });
    expect(answer.ok && "value" in answer && new TextDecoder().decode(answer.value.bytes)).toBe("synthetic file");
    expect(await client.download("../etc", 1_000)).toMatchObject({ ok: false, code: "bad_media" });
  });

  it("says where the copy is, or why there is none, as the hub's JSON", async () => {
    const { seen, client } = fakeFetch(() => Response.json({ ok: true, saved: true, drive_file_id: "1SyntheticFile00000000" }));
    await client.saved({ wamid: "wamid.A", driveFileId: "1SyntheticFile00000000" });
    await client.saved({ wamid: "wamid.B", problem: "too_big" });
    expect(seen.map((call) => [call.method, call.url, call.body])).toEqual([
      ["POST", "https://hub.example.test/v1/files/saved", { wamid: "wamid.A", drive_file_id: "1SyntheticFile00000000" }],
      ["POST", "https://hub.example.test/v1/files/saved", { wamid: "wamid.B", problem: "too_big" }],
    ]);
  });

  it("refuses a page of chats with a message it cannot read, rather than lose it", async () => {
    const { client } = fakeFetch(() => Response.json({ ok: true, month: "2026-05", data: [{ id: 1, wa_id: OWNER_WA, created_at: "2026-05-01 00:00:00" }, { id: "x" }], next: null }));
    expect(await client.archivePage("2026-05", 0)).toMatchObject({ ok: false, code: "unreadable_row" });
  });

  it("exists only for One's hub connection", () => {
    expect(hubFilesFor(readWhatsAppConfig({ WHATSAPP_HUB_URL: "https://hub.example.test", WHATSAPP_HUB_KEY: "one-test-key-not-real" }))).not.toBeNull();
    expect(hubFilesFor(readWhatsAppConfig({}))).toBeNull();
  });
});

// ------------------------------------------------------------------ copies

describe("a parent's file into the school's Drive (D-594)", () => {
  it("copies a practice photo into its month, and tells the hub where it is", async () => {
    const { hub, deps, filesIn } = setup();
    hub.add({ wamid: "wamid.P1", label: "Fee receipt" });
    const summary = await copyParentFiles(deps);
    expect(summary).toEqual({ status: "done", saved: 1, found: 0, failed: 0, left: 0 });
    const [stored] = filesIn("WhatsApp from parents (practice)", "2026-11 November");
    expect(stored!.name).toBe(`2026-11-12 18.42 · Test Parent (…0001) · Photo · Fee receipt · ${tagOf("wamid.P1")}.jpg`);
    expect(new TextDecoder().decode(stored!.bytes)).toBe("synthetic bytes for wamid.P1");
    expect(stored!.mimeType).toBe("image/jpeg");
    expect(stored!.appProperties).toEqual({ vppsone: "whatsapp-file", kind: "image", message: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(hub.driveIds.get("wamid.P1")).toBe(stored!.id);
    // In practice the hub is asked about the owner's number only.
    expect(hub.calls[0]).toBe(`waiting ${OWNER_WA}`);
  });

  it("puts real parents' files in the real folder once real parents are on", async () => {
    const { hub, deps, filesIn } = setup({ switches: switches({ realRecipients: true }) });
    hub.add({ wamid: "wamid.R1", waId: OTHER_WA, type: "document", mime: "application/pdf", label: "leave note.pdf" });
    expect((await copyParentFiles(deps)).saved).toBe(1);
    expect(hub.calls[0]).toBe("waiting all");
    expect(filesIn("WhatsApp from parents", "2026-11 November").map((file) => file.name)).toEqual([
      `2026-11-12 18.42 · Test Parent (…0002) · File · leave note · ${tagOf("wamid.R1")}.pdf`,
    ]);
    expect(filesIn("WhatsApp from parents (practice)")).toEqual([]);
  });

  it("asks the hub nothing while Veer Patta AI is off, or Drive is not set up", async () => {
    const off = setup({ switches: switches({ features: { parent_helper: false } }) });
    off.hub.add({ wamid: "wamid.O1" });
    expect(await copyParentFiles(off.deps)).toMatchObject({ status: "off", saved: 0 });
    expect(off.hub.calls).toEqual([]);

    const unread = setup({ switches: null });
    expect((await copyParentFiles(unread.deps)).status).toBe("off");

    const noDrive = setup({ drive: false });
    noDrive.hub.add({ wamid: "wamid.O2" });
    expect((await copyParentFiles(noDrive.deps)).status).toBe("no_drive");
    expect(noDrive.hub.calls).toEqual([]);
  });

  it("in practice leaves another number's file alone, without even asking", async () => {
    const { hub, deps } = setup();
    hub.add({ wamid: "wamid.X1", waId: OTHER_WA });
    const inbound: WebhookInbound = { providerMessageId: "wamid.X1", from: `+${OTHER_WA}`, fromName: null, type: "image", text: null, replyTo: null, at: NOW.toISOString(), raw: {} };
    expect(await copyFilesFromWebhook([inbound], null, deps)).toMatchObject({ status: "done", saved: 0 });
    expect(hub.calls).toEqual([]);
  });

  it("copies only the files in the webhook's own messages, so an album never races itself", async () => {
    const { hub, deps, filesIn } = setup();
    hub.add({ wamid: "wamid.A1" });
    hub.add({ wamid: "wamid.A2" });
    const inbound = (id: string, type = "image"): WebhookInbound => ({ providerMessageId: id, from: OWNER, fromName: "Test Parent", type, text: null, replyTo: null, at: NOW.toISOString(), raw: {} });
    expect(await copyFilesFromWebhook([inbound("wamid.A2"), inbound("wamid.T1", "text")], null, deps)).toMatchObject({ saved: 1 });
    expect([...hub.driveIds.keys()]).toEqual(["wamid.A2"]);
    expect(filesIn("WhatsApp from parents (practice)", "2026-11 November")).toHaveLength(1);
    // A text alone starts nothing.
    expect(await copyFilesFromWebhook([inbound("wamid.T2", "text")], null, deps)).toBeNull();
  });

  it("finds its own earlier copy by name when the hub was not told, and makes no second file", async () => {
    const { hub, deps, filesIn } = setup();
    hub.add({ wamid: "wamid.F1" });
    hub.savedAnswer = "unreachable";
    expect((await copyParentFiles(deps)).saved).toBe(1);
    expect(hub.driveIds.size).toBe(0);

    hub.savedAnswer = "ok";
    expect(await copyParentFiles(deps)).toMatchObject({ saved: 0, found: 1 });
    const copies = filesIn("WhatsApp from parents (practice)", "2026-11 November");
    expect(copies).toHaveLength(1);
    expect(hub.driveIds.get("wamid.F1")).toBe(copies[0]!.id);
    expect(hub.calls.filter((call) => call.startsWith("download"))).toHaveLength(1);
  });

  it("tells the hub when a file can never be copied, and leaves it when the fault is not the file's", async () => {
    const { hub, deps, filesIn } = setup();
    hub.add({ wamid: "wamid.BIG" }, new Uint8Array(26 * 1024 * 1024));
    hub.add({ wamid: "wamid.GONE" }, ascii("gone"), { answer: "gone" });
    hub.add({ wamid: "wamid.BAD" }, ascii("bytes that do not match"), { sha256: "0".repeat(64) });
    hub.add({ wamid: "wamid.HELD" }, ascii("held"), { answer: "forbidden" });
    hub.add({ wamid: "wamid.BUSY" }, ascii("busy"), { answer: "busy" });
    const summary = await copyParentFiles(deps);
    expect(summary).toEqual({ status: "done", saved: 0, found: 0, failed: 3, left: 2 });
    expect(hub.problems).toEqual([
      { wamid: "wamid.BIG", problem: "too_big" },
      { wamid: "wamid.GONE", problem: "gone" },
      { wamid: "wamid.BAD", problem: "checksum" },
    ]);
    expect(filesIn("WhatsApp from parents (practice)", "2026-11 November")).toEqual([]);
  });

  it("stops when Drive asks it to wait, and tells the hub nothing: every file stays for the next try", async () => {
    const { hub, drive, deps } = setup();
    hub.add({ wamid: "wamid.W1" });
    hub.add({ wamid: "wamid.W2" });
    for (let index = 0; index < 4; index += 1) drive.faults.push({ on: "start", status: 429, reason: "rateLimitExceeded" });
    expect(await copyParentFiles(deps)).toEqual({ status: "drive_unavailable", saved: 0, found: 0, failed: 0, left: 2 });
    expect(hub.problems).toEqual([]);
    expect(hub.driveIds.size).toBe(0);
  });

  it("stays quiet with a hub that has not been updated yet", async () => {
    const { hub, deps } = setup();
    hub.notUpdated = true;
    expect((await copyParentFiles(deps)).status).toBe("hub_not_ready");
  });

  it("leaves a file younger than ten minutes to the copy its own message started", async () => {
    const { hub, deps } = setup();
    hub.add({ wamid: "wamid.NEW", at: "2026-11-12 13:55:00" });
    hub.add({ wamid: "wamid.OLD", at: "2026-11-12 13:40:00" });
    expect((await sweepParentFiles(deps)).saved).toBe(1);
    expect([...hub.driveIds.keys()]).toEqual(["wamid.OLD"]);
  });
});

// ---------------------------------------------------------------- archive

describe("old chats out of the hub, one month at a time (D-595)", () => {
  it("does nothing on the days nothing is due", async () => {
    const { hub, drive, deps } = setup();
    hub.messages = [row(1, "2026-11-01 10:00:00")];
    expect(await archiveOldChats(deps)).toEqual({ status: "nothing_due", months: [], messages: 0 });
    expect([...drive.files.values()].filter((file) => file.id !== ROOT_FOLDER)).toEqual([]);
  });

  it("writes the month to Drive, reading every page, and only then lets the hub remove it", async () => {
    const { hub, deps, filesIn } = setup();
    hub.pageSize = 2;
    hub.messages = [row(1, "2026-05-01 10:00:00"), row(2, "2026-05-02 10:00:00"), row(3, "2026-05-30 10:00:00"), row(4, "2026-06-01 10:00:00")];
    hub.due = "2026-05";
    expect(await archiveOldChats(deps)).toEqual({ status: "moved", months: ["2026-05"], messages: 3 });
    const [sheet] = filesIn("WhatsApp chats by month");
    expect(sheet!.name).toBe("WhatsApp chats 2026-05.csv");
    const text = new TextDecoder().decode(sheet!.bytes);
    expect(text.trim().split("\r\n")).toHaveLength(4);
    expect(text).toContain("message 3");
    expect(text).not.toContain("message 4");
    expect(hub.done).toEqual([{ month: "2026-05", driveFileId: sheet!.id, messages: 3 }]);
    expect(hub.calls).toEqual(["archive next", "archive 2026-05 after 0", "archive 2026-05 after 2", "archive 2026-05 done", "archive next"]);
    expect(hub.messages.map((message) => message.id)).toEqual([4]);
  });

  it("keeps the month in the hub when the count changed, and writes it again in place tomorrow", async () => {
    const { hub, deps, filesIn } = setup();
    hub.messages = [row(1, "2026-05-01 10:00:00"), row(2, "2026-05-02 10:00:00")];
    hub.due = "2026-05";
    hub.arriveBeforeDone = 1;
    expect((await archiveOldChats(deps)).status).toBe("count_changed");
    expect(hub.messages).toHaveLength(3);
    expect(hub.done).toEqual([]);

    hub.arriveBeforeDone = 0;
    expect(await archiveOldChats(deps)).toMatchObject({ status: "moved", messages: 3 });
    const sheets = filesIn("WhatsApp chats by month");
    expect(sheets).toHaveLength(1);
    expect(new TextDecoder().decode(sheets[0]!.bytes)).toContain("message 9000");
    expect(hub.done).toEqual([{ month: "2026-05", driveFileId: sheets[0]!.id, messages: 3 }]);
  });

  it("stops without removing anything when Drive is unavailable or the hub has not been updated", async () => {
    const down = setup();
    down.hub.messages = [row(1, "2026-05-01 10:00:00")];
    down.hub.due = "2026-05";
    for (let index = 0; index < 4; index += 1) down.drive.faults.push({ on: "any", status: 503 });
    expect((await archiveOldChats(down.deps)).status).toBe("drive_unavailable");
    expect(down.hub.done).toEqual([]);
    expect(down.hub.messages).toHaveLength(1);

    const old = setup();
    old.hub.notUpdated = true;
    expect((await archiveOldChats(old.deps)).status).toBe("hub_not_ready");
  });
});

// ---------------------------------------------------------- the wiring

describe("the wiring", () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

  it("starts a copy from the hub's webhook only for a file, beside the helper", () => {
    const source = read("src/modules/whatsapp/data/whatsapp-webhook.ts");
    expect(source).toMatch(/if \(source === "hub" && parsed\.inbound\.length > 0\) \{[\s\S]*?isParentFileType\(message\.type\)[\s\S]*?copyFilesFromWebhook\(written, identity\)/);
  });

  it("opens the job only to pg_cron's queue secret or CRON_SECRET", () => {
    const source = read("src/app/api/jobs/parent-files/route.ts");
    expect(source).toContain("queueSecretMatches(bearer)");
    expect(source).toContain("isPlatformCron(process.env.CRON_SECRET, header)");
    expect(source).toContain('body?.part === "archive"');
  });

  it("schedules the hourly sweep only while the helper is on, and the archive once a day", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const files = readdirSync(dir).filter((name) => name.endsWith("_parent_files_to_drive.sql"));
    expect(files).toHaveLength(1);
    const sql = readFileSync(join(dir, files[0]!), "utf8").replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/\b(drop|truncate|alter|grant|revoke|delete)\b/i);
    expect(sql).toMatch(/cron\.schedule\(\s*'parent-files',\s*'17 \* \* \* \*'/);
    expect(sql).toMatch(/'parent-files'[\s\S]*?"part": "files"[\s\S]*?f\.key = 'whatsapp_features'[\s\S]*?f\.value -> 'parent_helper' = 'true'::jsonb/);
    expect(sql).toMatch(/cron\.schedule\(\s*'whatsapp-chat-archive',\s*'40 21 \* \* \*'[\s\S]*?"part": "archive"/);
    expect(sql.match(/vault\.decrypted_secrets s where s\.name = 'WHATSAPP_QUEUE_CRON_SECRET'/g)).toHaveLength(2);
    expect(sql.match(/https:\/\/one\.vpps\.co\.in\/api\/jobs\/parent-files/g)).toHaveLength(2);
  });

  it("never writes a parent's file, words or name to One's database", () => {
    const source = read("src/modules/whatsapp/data/parent-files.ts");
    expect(source).not.toMatch(/\.from\(|\.rpc\(|createAdminClient/);
  });
});
