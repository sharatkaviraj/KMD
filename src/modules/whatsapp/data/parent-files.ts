import "server-only";

import { createHash } from "node:crypto";

import { driveTarget, supabaseUploadStore } from "@/modules/collection/data/drive-documents";
import { readStorageSettings } from "@/modules/collection/data/storage-settings";
import {
  bareMime,
  CHATS_FOLDER,
  chatsCsv,
  chatsFileName,
  driveFileName,
  fileProperties,
  filesFolder,
  filesMonthFolder,
  fileScope,
  hubTime,
  indiaStamp,
  isParentFileType,
  MAX_FILE_BYTES,
  scopeAllows,
  SWEEP_MIN_AGE_MINUTES,
  type FileProblem,
} from "@/modules/whatsapp/domain/parent-files";
import { createFolder, DriveError, findChild, replaceContent, uploadLargeFile, type DriveDeps, type DriveFile } from "@/platform/google/drive";
import { logInfo, logWarn } from "@/platform/observability/log";
import { readWhatsAppConfig } from "@/platform/whatsapp/config";
import { hubFilesFor, type HubArchivedMessage, type HubFilesClient, type HubWaitingFile } from "@/platform/whatsapp/hub-files";
import { fromWaId, waDigits } from "@/platform/whatsapp/numbers";
import type { WhatsAppSwitches } from "@/platform/whatsapp/policy";
import { readSwitches } from "@/platform/whatsapp/store";
import type { WebhookInbound } from "@/platform/whatsapp/webhook";

/**
 * Parents' files and old chats into the school's Shared Drive (D-594, D-595).
 * The rules are in `domain/parent-files.ts`; the hub's half is its PR 6.
 *
 * Files: when a parent's photo, voice note, video or document reaches the
 * school, the hub's webhook starts a copy of that message's file at once
 * (`copyFilesFromWebhook`), and an hourly sweep picks up anything that copy
 * missed (`copyParentFiles`, from `/api/jobs/parent-files`). Each file is
 * fetched through the hub, written to "WhatsApp from parents/<month>", and the
 * hub is told where it is. A second try finds the first copy by its name, so a
 * retry never makes a second file.
 *
 * Chats: once a day the hub is asked whether a month has to leave it (older
 * than six months, or sooner when its free database passes 40%). That month
 * becomes one spreadsheet in "WhatsApp chats by month", and the hub removes it
 * only when the count One saved is still the count it holds.
 *
 * Nothing about a parent is written to One's database (D-576): not the file,
 * not the message, not the name. The logs carry counts and months only.
 */

type Folders = {
  folderFor(key: string): Promise<string | null>;
  claimFolder(key: string, folderId: string): Promise<string>;
};

export type ParentFilesDeps = {
  readSwitches: () => Promise<WhatsAppSwitches | null>;
  /** One's own hub connection, or null when One does not talk to the hub. */
  hub: () => HubFilesClient | null;
  /** The school's Drive, or null when it is not set up. */
  drive: () => Promise<{ deps: DriveDeps; rootFolderId: string } | null>;
  /** The `drive_folders` registry: one Drive folder per key, created once. */
  folders: Folders;
  now?: () => Date;
};

export function liveParentFilesDeps(oidcToken: string | null): ParentFilesDeps {
  const store = supabaseUploadStore();
  return {
    readSwitches: () => readSwitches(),
    hub: () => hubFilesFor(readWhatsAppConfig()),
    drive: async () => driveTarget(await readStorageSettings(), oidcToken),
    folders: { folderFor: (key) => store.folderFor(key), claimFolder: (key, id) => store.claimFolder(key, id) },
  };
}

const FOLDER_MIME = "application/vnd.google-apps.folder";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const message = (caught: unknown) => (caught instanceof Error ? caught.message : "unknown").slice(0, 200);

/** A folder by registry key, found by name before one is made, so a lost registry row never makes a second folder. */
async function folderIn(
  drive: DriveDeps,
  folders: Folders,
  cache: Map<string, string>,
  folder: { key: string; name: string },
  parentId: string,
): Promise<string> {
  const cached = cache.get(folder.key);
  if (cached) return cached;
  const known = await folders.folderFor(folder.key);
  if (known) {
    cache.set(folder.key, known);
    return known;
  }
  const existing = await findChild(drive, { parentId, name: folder.name });
  const id = existing?.id && existing.mimeType === FOLDER_MIME ? existing.id : await createFolder(drive, { name: folder.name, parentId });
  const winner = await folders.claimFolder(folder.key, id);
  cache.set(folder.key, winner);
  return winner;
}

/** A Drive failure that is about Drive, not about this file: stop, and try again next time. */
function stopsTheRun(caught: unknown): boolean {
  if (caught instanceof DriveError) return caught.kind !== "invalid" && caught.kind !== "session_gone";
  // The token, not Drive (GoogleAuthError), or anything unexpected.
  return true;
}

// ------------------------------------------------------------------ files

export type FileCopyStatus = "done" | "off" | "no_hub" | "no_drive" | "hub_not_ready" | "hub_unreachable" | "drive_unavailable";

export type FileCopySummary = {
  status: FileCopyStatus;
  /** Copied to Drive now. */
  saved: number;
  /** Already in Drive from an earlier try; the hub is told again. */
  found: number;
  /** A problem with the file itself; the hub counts the try (or stops offering it). */
  failed: number;
  /** Not tried, or to be tried again: out of time, Drive asked to wait, or the hub was busy. */
  left: number;
};

type Outcome = "saved" | "found" | "failed" | "left" | "stop";

async function tellProblem(hub: HubFilesClient, wamid: string, problem: FileProblem): Promise<void> {
  const answer = await hub.saved({ wamid, problem });
  if (!answer.ok) logWarn("whatsapp.files.problem_not_told", { status: answer.status, code: answer.code, problem });
}

async function copyOne(
  hub: HubFilesClient,
  drive: { deps: DriveDeps; rootFolderId: string },
  folders: Folders,
  cache: Map<string, string>,
  practice: boolean,
  file: HubWaitingFile,
  now: Date,
): Promise<Outcome> {
  const month = indiaStamp(hubTime(file.at) ?? now).month;
  const name = driveFileName(file, now);

  let folder: string;
  let existing: DriveFile | null;
  try {
    const top = await folderIn(drive.deps, folders, cache, filesFolder(practice), drive.rootFolderId);
    folder = await folderIn(drive.deps, folders, cache, filesMonthFolder(practice, month), top);
    existing = await findChild(drive.deps, { parentId: folder, name });
  } catch (caught) {
    logWarn("whatsapp.files.drive_failed", { step: "folder", error: message(caught) });
    return "stop";
  }

  if (existing?.id) {
    // An earlier try wrote it and did not get to tell the hub.
    const told = await hub.saved({ wamid: file.wamid, driveFileId: existing.id });
    return told.ok ? "found" : "left";
  }

  const got = await hub.download(file.mediaId, MAX_FILE_BYTES);
  if (!got.ok) {
    if ("tooBig" in got) {
      await tellProblem(hub, file.wamid, "too_big");
      return "failed";
    }
    if (got.code === "media_gone" || got.status === 410) {
      await tellProblem(hub, file.wamid, "gone");
      return "failed";
    }
    // 403: the hub's own switch changed since it listed the file; 5xx or no
    // answer: Meta or the hub was busy. Neither is the file's fault.
    return "left";
  }

  const bytes = got.value.bytes;
  if (bytes.byteLength === 0) {
    await tellProblem(hub, file.wamid, "unreadable");
    return "failed";
  }
  const digest = sha256(bytes);
  if (got.value.sha256 && got.value.sha256 !== digest) {
    await tellProblem(hub, file.wamid, "checksum");
    return "failed";
  }

  let stored: DriveFile;
  try {
    stored = await uploadLargeFile(drive.deps, {
      name,
      parentId: folder,
      contentType: bareMime(got.value.mime ?? file.mime) ?? "application/octet-stream",
      bytes,
      appProperties: fileProperties(file),
    });
    // Drive's own checksum, when it gives one, must be the file's. Once more if not.
    if (stored.sha256Checksum && stored.sha256Checksum.toLowerCase() !== digest) {
      stored = await replaceContent(drive.deps, stored.id, { contentType: bareMime(got.value.mime ?? file.mime) ?? "application/octet-stream", bytes });
      if (stored.sha256Checksum && stored.sha256Checksum.toLowerCase() !== digest) {
        await tellProblem(hub, file.wamid, "checksum");
        return "failed";
      }
    }
  } catch (caught) {
    logWarn("whatsapp.files.drive_failed", { step: "upload", error: message(caught) });
    if (stopsTheRun(caught)) return "stop";
    if (caught instanceof DriveError && caught.kind === "invalid") {
      await tellProblem(hub, file.wamid, "drive_refused");
      return "failed";
    }
    return "left";
  }

  const told = await hub.saved({ wamid: file.wamid, driveFileId: stored.id });
  // Not told: the next try finds this copy by its name and tells the hub then.
  if (!told.ok) logWarn("whatsapp.files.saved_not_told", { status: told.status, code: told.code });
  return "saved";
}

function oldEnough(file: HubWaitingFile, now: Date, minutes: number): boolean {
  if (minutes <= 0) return true;
  const at = hubTime(file.at);
  return at !== null && now.getTime() - at.getTime() >= minutes * 60_000;
}

/**
 * Copy what the hub has waiting, oldest first, until the time runs out.
 *
 * `only` limits it to these messages (the webhook's own, so two copies of one
 * album never race each other), `numbers` to these senders, and `minAgeMinutes`
 * leaves files younger than that to the copy their own message started.
 */
export async function copyParentFiles(
  deps: ParentFilesDeps,
  input: { only?: ReadonlySet<string>; numbers?: readonly string[]; minAgeMinutes?: number; limit?: number; budgetMs?: number } = {},
): Promise<FileCopySummary> {
  const started = Date.now();
  const summary: FileCopySummary = { status: "done", saved: 0, found: 0, failed: 0, left: 0 };

  const scope = fileScope(await deps.readSwitches().catch(() => null));
  if (!scope) return { ...summary, status: "off" };

  let numbers = scope.numbers;
  if (input.numbers) {
    const asked = [...new Set(input.numbers.map((raw) => fromWaId(raw)).filter((n): n is string => n !== null).map(waDigits))];
    const allowed = asked.filter((digits) => scopeAllows(scope, digits));
    if (allowed.length === 0) return summary;
    numbers = allowed;
  }

  const hub = deps.hub();
  if (!hub) return { ...summary, status: "no_hub" };
  const drive = await deps.drive().catch((caught) => {
    logWarn("whatsapp.files.drive_settings_failed", { error: message(caught) });
    return null;
  });
  if (!drive) return { ...summary, status: "no_drive" };

  const waiting = await hub.waiting({ numbers, limit: input.limit ?? 10 });
  if (!waiting.ok) return { ...summary, status: waiting.missing ? "hub_not_ready" : "hub_unreachable" };

  const now = (deps.now ?? (() => new Date()))();
  const files = waiting.value.filter(
    (file) =>
      (!input.only || input.only.has(file.wamid)) &&
      isParentFileType(file.type) &&
      scopeAllows(scope, file.waId) &&
      oldEnough(file, now, input.minAgeMinutes ?? 0),
  );

  const cache = new Map<string, string>();
  const budget = input.budgetMs ?? 40_000;
  for (let index = 0; index < files.length; index += 1) {
    if (Date.now() - started > budget) {
      summary.left += files.length - index;
      break;
    }
    const outcome = await copyOne(hub, drive, deps.folders, cache, scope.practice, files[index]!, now);
    if (outcome === "stop") {
      summary.status = "drive_unavailable";
      summary.left += files.length - index;
      break;
    }
    summary[outcome] += 1;
  }

  if (summary.saved + summary.found + summary.failed > 0 || summary.status !== "done") {
    logInfo("whatsapp.files.copied", { ...summary, practice: scope.practice });
  }
  return summary;
}

/**
 * The webhook's part: the files in these messages, now. Only theirs, so a
 * parent's three photos arriving as three events make three copies, not nine.
 */
export async function copyFilesFromWebhook(
  inbound: readonly WebhookInbound[],
  oidcToken: string | null,
  deps: ParentFilesDeps = liveParentFilesDeps(oidcToken),
): Promise<FileCopySummary | null> {
  const files = inbound.filter((item) => isParentFileType(item.type));
  if (files.length === 0) return null;
  return copyParentFiles(deps, {
    only: new Set(files.map((item) => item.providerMessageId)),
    numbers: files.map((item) => item.from),
    limit: 20,
    budgetMs: 40_000,
  });
}

/** The hourly sweep: whatever the webhook's own copies missed. */
export function sweepParentFiles(deps: ParentFilesDeps, budgetMs = 200_000): Promise<FileCopySummary> {
  return copyParentFiles(deps, { minAgeMinutes: SWEEP_MIN_AGE_MINUTES, limit: 50, budgetMs });
}

// ------------------------------------------------------------ chats by month

export type ArchiveStatus =
  | "nothing_due"
  | "moved"
  | "no_hub"
  | "no_drive"
  | "hub_not_ready"
  | "hub_unreachable"
  | "count_changed"
  | "drive_unavailable"
  | "out_of_time";

export type ArchiveSummary = { status: ArchiveStatus; months: string[]; messages: number };

/** Drive's record of the file must describe the bytes that were sent, or the hub keeps its copy. */
function sameBytes(stored: DriveFile, bytes: Uint8Array): boolean {
  if (stored.size !== undefined && Number(stored.size) !== bytes.byteLength) return false;
  if (stored.sha256Checksum && stored.sha256Checksum.toLowerCase() !== sha256(bytes)) return false;
  return true;
}

/**
 * Move the months of chats that are due out of the hub, oldest first, at most
 * `maxMonths` a run. Each month is read in full, written to Drive as one
 * spreadsheet, checked, and only then removed from the hub, which refuses if
 * the count changed meanwhile. Anything that goes wrong leaves the month in
 * the hub for tomorrow.
 */
export async function archiveOldChats(
  deps: ParentFilesDeps,
  input: { maxMonths?: number; budgetMs?: number } = {},
): Promise<ArchiveSummary> {
  const started = Date.now();
  const budget = input.budgetMs ?? 200_000;
  const summary: ArchiveSummary = { status: "nothing_due", months: [], messages: 0 };
  const finish = (status: ArchiveStatus): ArchiveSummary => {
    const result: ArchiveSummary = { ...summary, status: summary.months.length > 0 && status === "nothing_due" ? "moved" : status };
    if (result.status !== "nothing_due") logInfo("whatsapp.chats.archive", { status: result.status, months: result.months.join(","), messages: result.messages });
    return result;
  };

  const hub = deps.hub();
  if (!hub) return finish("no_hub");
  const drive = await deps.drive().catch((caught) => {
    logWarn("whatsapp.chats.drive_settings_failed", { error: message(caught) });
    return null;
  });
  if (!drive) return finish("no_drive");
  const cache = new Map<string, string>();

  for (let round = 0; round < (input.maxMonths ?? 3); round += 1) {
    if (Date.now() - started > budget) return finish("out_of_time");
    const next = await hub.archiveNext();
    if (!next.ok) return finish(next.missing ? "hub_not_ready" : "hub_unreachable");
    const month = next.value.month;
    if (!month) return finish("nothing_due");

    const rows: HubArchivedMessage[] = [];
    let after = 0;
    for (;;) {
      if (Date.now() - started > budget) return finish("out_of_time");
      const page = await hub.archivePage(month, after);
      if (!page.ok) return finish("hub_unreachable");
      rows.push(...page.value.rows);
      if (page.value.next === null) break;
      if (page.value.next <= after) return finish("hub_unreachable");
      after = page.value.next;
    }
    if (rows.length !== next.value.messages) {
      logWarn("whatsapp.chats.count_changed", { month, listed: next.value.messages, read: rows.length });
      return finish("count_changed");
    }

    const bytes = new TextEncoder().encode(chatsCsv(rows));
    let stored: DriveFile;
    try {
      const folder = await folderIn(drive.deps, deps.folders, cache, CHATS_FOLDER, drive.rootFolderId);
      const name = chatsFileName(month);
      // A month written before whose removal did not happen: write it again in place.
      const existing = await findChild(drive.deps, { parentId: folder, name });
      stored = existing?.id
        ? await replaceContent(drive.deps, existing.id, { contentType: "text/csv", bytes })
        : await uploadLargeFile(drive.deps, {
            name,
            parentId: folder,
            contentType: "text/csv",
            bytes,
            appProperties: { vppsone: "whatsapp-chats", month, messages: String(rows.length) },
          });
    } catch (caught) {
      logWarn("whatsapp.chats.drive_failed", { month, error: message(caught) });
      return finish("drive_unavailable");
    }
    if (!stored.id || !sameBytes(stored, bytes)) {
      logWarn("whatsapp.chats.drive_mismatch", { month });
      return finish("drive_unavailable");
    }

    const done = await hub.archiveDone(month, { driveFileId: stored.id, messages: rows.length });
    if (!done.ok) {
      logWarn("whatsapp.chats.not_removed", { month, status: done.status, code: done.code });
      return finish(done.code === "count_changed" || done.code === "not_due" ? "count_changed" : "hub_unreachable");
    }
    summary.months.push(month);
    summary.messages += rows.length;
  }
  return finish("nothing_due");
}
