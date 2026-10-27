/**
 * The handful of Drive v3 calls VPPS One needs, over plain `fetch` (D-333).
 *
 * Not the `googleapis` package: it is 100+ MB of generated code for six
 * endpoints, and every request it would make is written out here where it can
 * be read and tested against a fake server.
 *
 * Every call names `supportsAllDrives=true` — without it Drive answers 404 for
 * a file that lives in a Shared Drive, which looks exactly like "not found".
 *
 * Nothing here deletes, trashes or shares a file. The service account is a
 * Contributor on one Shared Drive: it can add files and edit content, not
 * remove anything, and the app never asks it to make a link public.
 */

export type DriveFailure =
  /** The token was refused, or the account lost its Shared Drive membership. */
  | "forbidden"
  /** No such file or folder, as far as this account can see. */
  | "not_found"
  /** Google asked us to slow down. */
  | "rate_limited"
  /** The Shared Drive or the organisation is out of space. */
  | "quota"
  /** The resumable session has expired or was never valid. */
  | "session_gone"
  /** Google was unreachable or failed; trying again may work. */
  | "unavailable"
  /** Google answered with something this code does not understand. */
  | "invalid";

export class DriveError extends Error {
  constructor(
    readonly kind: DriveFailure,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DriveError";
  }

  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "unavailable";
  }
}

export type DriveDeps = {
  /** A current access token. Called once per request, so a refresh is picked up. */
  token: () => Promise<string>;
  fetch?: typeof fetch;
  /** Waits between retries; replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Base URL for the API, replaced in tests by a local fake. */
  apiBase?: string;
};

export type DriveFile = {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  md5Checksum?: string;
  sha256Checksum?: string;
  trashed?: boolean;
  driveId?: string;
  parents?: string[];
};

const DEFAULT_API = "https://www.googleapis.com";
const FILE_FIELDS = "id,name,mimeType,size,md5Checksum,sha256Checksum,trashed,driveId,parents";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const RETRY_DELAYS_MS = [400, 1200, 3000] as const;

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function api(deps: DriveDeps) {
  return deps.apiBase ?? DEFAULT_API;
}

/** Map an error response to a failure kind. Reads Drive's `reason`, not just the status. */
export async function classify(response: Response): Promise<DriveError> {
  let reason = "";
  let message = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as {
      error?: { message?: string; errors?: { reason?: string }[] };
    };
    reason = body.error?.errors?.[0]?.reason ?? "";
    message = (body.error?.message ?? message).slice(0, 200);
  } catch {
    // Not JSON; the status says enough.
  }

  const status = response.status;
  if (status === 429 || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") {
    return new DriveError("rate_limited", message, status);
  }
  if (reason === "storageQuotaExceeded" || reason === "teamDriveFileLimitExceeded" || reason === "quotaExceeded") {
    return new DriveError("quota", message, status);
  }
  if (status === 401 || status === 403) return new DriveError("forbidden", message, status);
  if (status === 404) return new DriveError("not_found", message, status);
  if (status === 410) return new DriveError("session_gone", message, status);
  if (status >= 500) return new DriveError("unavailable", message, status);
  return new DriveError("invalid", message, status);
}

/**
 * One request, retried on a rate limit or a 5xx with growing waits.
 *
 * Only for requests that are safe to repeat: reads, status queries, and a
 * folder create that is checked against the database afterwards. A chunk
 * upload is not retried here — the resumable protocol says to ask Drive how
 * far it got first, which `uploadChunk` does.
 */
async function send(deps: DriveDeps, url: string, init: RequestInit, retries = true): Promise<Response> {
  const run = deps.fetch ?? fetch;
  const wait = deps.sleep ?? sleepFor;
  const attempts = retries ? RETRY_DELAYS_MS.length + 1 : 1;

  let last: DriveError | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await wait(RETRY_DELAYS_MS[attempt - 1]! + Math.floor(Math.random() * 200));
    let response: Response;
    try {
      const token = await deps.token();
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${token}`);
      response = await run(url, { ...init, headers, cache: "no-store" });
    } catch (error) {
      if (error instanceof DriveError) throw error;
      // A thrown GoogleAuthError is the token, not Drive: let it through as is.
      if (error instanceof Error && error.name === "GoogleAuthError") throw error;
      last = new DriveError("unavailable", "Could not reach Google Drive.");
      continue;
    }
    if (response.ok || response.status === 308) return response;
    const failure = await classify(response);
    if (!failure.retryable) throw failure;
    last = failure;
  }
  throw last ?? new DriveError("unavailable", "Google Drive did not answer.");
}

/**
 * Bytes as a request body. Any `Uint8Array` is a valid body to `fetch`; the
 * DOM typings only accept one backed by a plain `ArrayBuffer`.
 */
const asBody = (bytes: Uint8Array): BodyInit => bytes as Uint8Array<ArrayBuffer>;

const query = (params: Record<string, string>) => new URLSearchParams({ supportsAllDrives: "true", ...params }).toString();

/** A Shared Drive's id and name, as the service account sees it. */
export async function getSharedDrive(deps: DriveDeps, driveId: string): Promise<{ id: string; name: string }> {
  const response = await send(deps, `${api(deps)}/drive/v3/drives/${encodeURIComponent(driveId)}?fields=id,name`, {
    method: "GET",
  });
  return (await response.json()) as { id: string; name: string };
}

export async function getFile(deps: DriveDeps, fileId: string): Promise<DriveFile> {
  const response = await send(
    deps,
    `${api(deps)}/drive/v3/files/${encodeURIComponent(fileId)}?${query({ fields: FILE_FIELDS })}`,
    { method: "GET" },
  );
  return (await response.json()) as DriveFile;
}

/**
 * The bytes of one file, as Drive's own streaming response. `range` is passed
 * through so a PDF viewer can ask for the page it is on.
 */
export async function downloadFile(deps: DriveDeps, fileId: string, range?: string | null): Promise<Response> {
  // Identity, so the Content-Length and Content-Range passed on to the
  // browser describe the bytes it actually receives.
  const headers: Record<string, string> = { "accept-encoding": "identity" };
  if (range) headers.range = range;
  return send(deps, `${api(deps)}/drive/v3/files/${encodeURIComponent(fileId)}?${query({ alt: "media" })}`, {
    method: "GET",
    headers,
  });
}

/**
 * A file or folder by exact name inside one folder, oldest first.
 *
 * The `user` corpus, not `drive`: the account may hold access to one folder
 * of a Shared Drive without being a member of the drive, and `corpora=drive`
 * answers "not found" to a non-member.
 */
export async function findChild(
  deps: DriveDeps,
  input: { parentId: string; name: string },
): Promise<DriveFile | null> {
  const escaped = input.name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const params = query({
    corpora: "user",
    includeItemsFromAllDrives: "true",
    q: `'${input.parentId}' in parents and name = '${escaped}' and trashed = false`,
    orderBy: "createdTime",
    pageSize: "1",
    fields: `files(${FILE_FIELDS})`,
  });
  const response = await send(deps, `${api(deps)}/drive/v3/files?${params}`, { method: "GET" });
  const body = (await response.json()) as { files?: DriveFile[] };
  return body.files?.[0] ?? null;
}

export async function createFolder(deps: DriveDeps, input: { name: string; parentId: string }): Promise<string> {
  const response = await send(deps, `${api(deps)}/drive/v3/files?${query({ fields: "id" })}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: input.name, mimeType: FOLDER_MIME, parents: [input.parentId] }),
  });
  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new DriveError("invalid", "Drive created a folder without an id.");
  return body.id;
}

/** A small file in one request, for the health check and archive copies. */
export async function createSmallFile(
  deps: DriveDeps,
  input: { name: string; parentId: string; contentType: string; bytes: Uint8Array; appProperties?: Record<string, string> },
): Promise<DriveFile> {
  const boundary = `vppsone-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name: input.name,
    parents: [input.parentId],
    mimeType: input.contentType,
    appProperties: input.appProperties,
  });
  const head = new TextEncoder().encode(
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\ncontent-type: ${input.contentType}\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.byteLength + input.bytes.byteLength + tail.byteLength);
  body.set(head, 0);
  body.set(input.bytes, head.byteLength);
  body.set(tail, head.byteLength + input.bytes.byteLength);

  const response = await send(
    deps,
    `${api(deps)}/upload/drive/v3/files?${query({ uploadType: "multipart", fields: FILE_FIELDS })}`,
    { method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body: asBody(body) },
    // A repeated create is a second file, so this is never retried blindly.
    false,
  );
  return (await response.json()) as DriveFile;
}

/** Replace a file's content. Contributors may edit; used by the health check only. */
export async function replaceContent(
  deps: DriveDeps,
  fileId: string,
  input: { contentType: string; bytes: Uint8Array },
): Promise<DriveFile> {
  const response = await send(
    deps,
    `${api(deps)}/upload/drive/v3/files/${encodeURIComponent(fileId)}?${query({ uploadType: "media", fields: FILE_FIELDS })}`,
    { method: "PATCH", headers: { "content-type": input.contentType }, body: asBody(input.bytes) },
  );
  return (await response.json()) as DriveFile;
}

/**
 * Open a resumable upload and return its session URL.
 *
 * The URL is a capability to write this one file for up to a week, so it is
 * kept on the server (vppsone.document_upload_sessions) and never sent to the
 * browser: the browser sends chunks to VPPS One, which forwards them.
 */
export async function startResumableUpload(
  deps: DriveDeps,
  input: {
    name: string;
    parentId: string;
    contentType: string;
    bytes: number;
    appProperties: Record<string, string>;
  },
): Promise<string> {
  const response = await send(
    deps,
    `${api(deps)}/upload/drive/v3/files?${query({ uploadType: "resumable", fields: FILE_FIELDS })}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": input.contentType,
        "x-upload-content-length": String(input.bytes),
      },
      body: JSON.stringify({
        name: input.name,
        parents: [input.parentId],
        mimeType: input.contentType,
        appProperties: input.appProperties,
      }),
    },
  );
  const location = response.headers.get("location");
  if (!location || !location.startsWith(`${api(deps)}/upload/drive/v3/`)) {
    throw new DriveError("invalid", "Drive did not return an upload session.");
  }
  return location;
}

export type UploadProgress = { done: false; received: number } | { done: true; file: DriveFile };

/** `Range: bytes=0-N` → N+1; no header → 0. */
function receivedFrom(response: Response): number {
  const range = response.headers.get("range");
  const match = range ? /^bytes=0-(\d+)$/.exec(range.trim()) : null;
  return match ? Number(match[1]) + 1 : 0;
}

async function progressOf(response: Response): Promise<UploadProgress> {
  if (response.status === 308) return { done: false, received: receivedFrom(response) };
  return { done: true, file: (await response.json()) as DriveFile };
}

/** How far Drive has got with an upload: the resumable protocol's status query. */
export async function uploadStatus(deps: DriveDeps, sessionUrl: string, total: number): Promise<UploadProgress> {
  const response = await send(deps, sessionUrl, {
    method: "PUT",
    // Drive's 308 means "resume incomplete", never a redirect to follow.
    redirect: "manual",
    headers: { "content-range": `bytes */${total}` },
    body: new Uint8Array(0),
  });
  return progressOf(response);
}

/**
 * Send one chunk starting at `offset`. On a failure the chunk is not blindly
 * re-sent: Drive is asked how much it has, and only the missing tail of this
 * chunk goes again. That is what makes a retried request safe.
 */
export async function uploadChunk(
  deps: DriveDeps,
  input: { sessionUrl: string; offset: number; total: number; bytes: Uint8Array },
): Promise<UploadProgress> {
  const wait = deps.sleep ?? sleepFor;
  const end = input.offset + input.bytes.byteLength;
  let from = input.offset;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await wait(RETRY_DELAYS_MS[attempt - 1]!);
    const slice = input.bytes.subarray(from - input.offset);
    let failure: DriveError;
    try {
      const response = await send(
        deps,
        input.sessionUrl,
        {
          method: "PUT",
          redirect: "manual",
          headers: { "content-range": `bytes ${from}-${end - 1}/${input.total}` },
          body: asBody(slice),
        },
        false,
      );
      return progressOf(response);
    } catch (error) {
      // A 400 on a chunk usually means our count is behind Drive's (a lost
      // reply earlier). Ask, and carry on from Drive's answer if it is ahead.
      if (error instanceof DriveError && error.kind === "invalid" && error.status === 400) {
        const status = await uploadStatus(deps, input.sessionUrl, input.total);
        if (status.done || status.received > input.offset) return status;
        throw error;
      }
      if (!(error instanceof DriveError) || !error.retryable) throw error;
      failure = error;
    }

    // Ask before re-sending: part of the chunk may have landed.
    const status = await uploadStatus(deps, input.sessionUrl, input.total);
    if (status.done) return status;
    if (status.received >= end) return status;
    if (status.received < input.offset) {
      throw new DriveError("invalid", `Drive has ${status.received} bytes, fewer than this chunk's start.`);
    }
    from = status.received;
    if (attempt === RETRY_DELAYS_MS.length) throw failure;
  }
  throw new DriveError("unavailable", "The chunk could not be sent.");
}
