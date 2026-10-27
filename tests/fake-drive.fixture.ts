import { createHash } from "node:crypto";

/**
 * A small in-memory Google Drive for the tests (D-333): the resumable upload
 * protocol (308 + Range, status queries, Content-Range), folders, multipart
 * and media uploads, `alt=media` with Range, file metadata and a Shared Drive.
 * Faults are injected per request, so a dropped chunk, a rate limit, a revoked
 * membership or a missing checksum can each be made to happen exactly once.
 */

export const DRIVE_API = "https://drive.test";
export const DRIVE_TOKEN = "synthetic-access-token";
export const SHARED_DRIVE = "0ASyntheticSharedDrive00";
export const ROOT_FOLDER = "1SyntheticRootFolder0000";

type StoredFile = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  bytes: Uint8Array;
  appProperties?: Record<string, string>;
  createdTime: number;
};

type Session = {
  url: string;
  name: string;
  mimeType: string;
  parents: string[];
  total: number;
  received: Uint8Array[];
  appProperties?: Record<string, string>;
};

export type Fault = {
  /** Which request: "start", "chunk", "status", "media", "metadata", "folder", "any". */
  on: "start" | "chunk" | "status" | "media" | "metadata" | "folder" | "any";
  status: number;
  reason?: string;
  /** For a chunk: accept this many bytes of it before failing, as a dropped connection does. */
  acceptBytes?: number;
};

export class FakeDrive {
  files = new Map<string, StoredFile>();
  sessions = new Map<string, Session>();
  faults: Fault[] = [];
  requests: { method: string; url: string; kind: string }[] = [];
  bytesReceived = 0;
  omitSha256 = false;
  private next = 0;
  private clock = 0;

  constructor() {
    this.files.set(ROOT_FOLDER, {
      id: ROOT_FOLDER,
      name: "VPPS One documents",
      mimeType: "application/vnd.google-apps.folder",
      parents: [SHARED_DRIVE],
      bytes: new Uint8Array(0),
      createdTime: 0,
    });
  }

  private id(prefix: string) {
    this.next += 1;
    return `${prefix}${String(this.next).padStart(22, "0")}`;
  }

  private meta(file: StoredFile, withSha = true) {
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: String(file.bytes.byteLength),
      md5Checksum: createHash("md5").update(file.bytes).digest("hex"),
      ...(withSha && !this.omitSha256 ? { sha256Checksum: createHash("sha256").update(file.bytes).digest("hex") } : {}),
      trashed: false,
      driveId: SHARED_DRIVE,
      parents: file.parents,
    };
  }

  private takeFault(kind: string): Fault | undefined {
    const index = this.faults.findIndex((fault) => fault.on === kind || fault.on === "any");
    return index === -1 ? undefined : this.faults.splice(index, 1)[0];
  }

  private error(status: number, reason = "backendError") {
    return Response.json({ error: { code: status, message: `synthetic ${reason}`, errors: [{ reason }] } }, { status });
  }

  private store(name: string, mimeType: string, parents: string[], bytes: Uint8Array, appProperties?: Record<string, string>) {
    const file: StoredFile = { id: this.id("1F"), name, mimeType, parents, bytes, appProperties, createdTime: (this.clock += 1) };
    this.files.set(file.id, file);
    return file;
  }

  private sessionProgress(session: Session) {
    return session.received.reduce((sum, part) => sum + part.byteLength, 0);
  }

  private complete(session: Session): Response {
    const total = this.sessionProgress(session);
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const part of session.received) {
      bytes.set(part, at);
      at += part.byteLength;
    }
    const file = this.store(session.name, session.mimeType, session.parents, bytes, session.appProperties);
    this.sessions.delete(session.url);
    return Response.json(this.meta(file), { status: 200 });
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const kind = this.kindOf(method, url, headers);
    this.requests.push({ method, url: url.href, kind });

    if (headers.get("authorization") !== `Bearer ${DRIVE_TOKEN}`) return this.error(401, "authError");
    if (url.searchParams.get("supportsAllDrives") !== "true" && !url.pathname.startsWith("/drive/v3/drives/") && kind !== "chunk" && kind !== "status") {
      return this.error(404, "notFound");
    }

    const fault = this.takeFault(kind);
    if (fault && fault.acceptBytes === undefined) return this.error(fault.status, fault.reason);

    const raw = init?.body;
    const body =
      typeof raw === "string"
        ? new TextEncoder().encode(raw)
        : raw instanceof Uint8Array
          ? raw
          : raw instanceof ArrayBuffer
            ? new Uint8Array(raw)
            : new Uint8Array(0);

    switch (kind) {
      case "drive": {
        const id = url.pathname.split("/").pop();
        return id === SHARED_DRIVE ? Response.json({ id, name: "Synthetic school documents" }) : this.error(404, "notFound");
      }
      case "folder": {
        const meta = JSON.parse(new TextDecoder().decode(body)) as { name: string; parents: string[] };
        const file = this.store(meta.name, "application/vnd.google-apps.folder", meta.parents, new Uint8Array(0));
        return Response.json({ id: file.id });
      }
      case "list": {
        const q = url.searchParams.get("q") ?? "";
        const parent = /'([^']+)' in parents/.exec(q)?.[1];
        const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'");
        const found = [...this.files.values()]
          .filter((file) => file.parents.includes(parent ?? "") && file.name === name)
          .sort((a, b) => a.createdTime - b.createdTime);
        return Response.json({ files: found.slice(0, 1).map((file) => this.meta(file)) });
      }
      case "metadata": {
        const file = this.files.get(url.pathname.split("/").pop() ?? "");
        return file ? Response.json(this.meta(file)) : this.error(404, "notFound");
      }
      case "media": {
        const file = this.files.get(url.pathname.split("/").pop() ?? "");
        if (!file) return this.error(404, "notFound");
        const range = headers.get("range");
        const match = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
        if (match) {
          const start = Number(match[1]);
          const end = match[2] ? Math.min(Number(match[2]), file.bytes.byteLength - 1) : file.bytes.byteLength - 1;
          return new Response(file.bytes.slice(start, end + 1), {
            status: 206,
            headers: {
              "content-range": `bytes ${start}-${end}/${file.bytes.byteLength}`,
              "content-length": String(end - start + 1),
            },
          });
        }
        return new Response(file.bytes.slice(), { status: 200, headers: { "content-length": String(file.bytes.byteLength) } });
      }
      case "start": {
        const meta = JSON.parse(new TextDecoder().decode(body)) as {
          name: string;
          parents: string[];
          mimeType: string;
          appProperties?: Record<string, string>;
        };
        const sessionUrl = `${DRIVE_API}/upload/drive/v3/files?uploadType=resumable&upload_id=${this.id("U")}`;
        this.sessions.set(sessionUrl, {
          url: sessionUrl,
          name: meta.name,
          mimeType: headers.get("x-upload-content-type") ?? meta.mimeType,
          parents: meta.parents,
          total: Number(headers.get("x-upload-content-length")),
          received: [],
          appProperties: meta.appProperties,
        });
        return new Response(null, { status: 200, headers: { location: sessionUrl } });
      }
      case "status":
      case "chunk": {
        const session = this.sessions.get(url.href);
        if (!session) return this.error(404, "notFound");
        const have = this.sessionProgress(session);
        if (kind === "chunk") {
          const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers.get("content-range") ?? "");
          if (!match || Number(match[1]) !== have) return this.error(400, "badContentRange");
          const accepted = fault?.acceptBytes !== undefined ? body.subarray(0, fault.acceptBytes) : body;
          session.received.push(accepted.slice());
          this.bytesReceived += accepted.byteLength;
          if (fault) return this.error(fault.status, fault.reason);
        }
        const now = this.sessionProgress(session);
        if (now >= session.total) return this.complete(session);
        return new Response(null, { status: 308, headers: now > 0 ? { range: `bytes=0-${now - 1}` } : {} });
      }
      case "multipart": {
        const text = new TextDecoder().decode(body);
        const meta = JSON.parse(text.split("\r\n\r\n")[1]!.split("\r\n--")[0]!) as { name: string; parents: string[]; mimeType: string };
        const content = text.split("\r\n\r\n")[2]!.split("\r\n--")[0]!;
        const file = this.store(meta.name, meta.mimeType, meta.parents, new TextEncoder().encode(content));
        return Response.json(this.meta(file));
      }
      case "replace": {
        const file = this.files.get(url.pathname.split("/").pop() ?? "");
        if (!file) return this.error(404, "notFound");
        file.bytes = body.slice();
        return Response.json(this.meta(file));
      }
      default:
        return this.error(400, "unknownRequest");
    }
  };

  private kindOf(method: string, url: URL, headers: Headers): string {
    const path = url.pathname;
    if (path.startsWith("/drive/v3/drives/")) return "drive";
    if (path === "/upload/drive/v3/files" && url.searchParams.get("upload_id")) {
      return (headers.get("content-range") ?? "").startsWith("bytes */") ? "status" : "chunk";
    }
    if (path === "/upload/drive/v3/files" && url.searchParams.get("uploadType") === "resumable") return "start";
    if (path === "/upload/drive/v3/files" && url.searchParams.get("uploadType") === "multipart") return "multipart";
    if (path.startsWith("/upload/drive/v3/files/") && method === "PATCH") return "replace";
    if (path === "/drive/v3/files" && method === "POST") return "folder";
    if (path === "/drive/v3/files" && method === "GET") return "list";
    if (path.startsWith("/drive/v3/files/") && url.searchParams.get("alt") === "media") return "media";
    if (path.startsWith("/drive/v3/files/")) return "metadata";
    return "unknown";
  }
}

export function driveDepsFor(drive: FakeDrive) {
  return {
    token: async () => DRIVE_TOKEN,
    fetch: drive.fetch,
    sleep: async () => {},
    apiBase: DRIVE_API,
  };
}

/** Synthetic bytes that start like the type they claim. */
export function syntheticFile(type: "pdf" | "jpeg" | "html", size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (index * 31 + 7) % 251;
  const head =
    type === "pdf" ? [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37] : type === "jpeg" ? [0xff, 0xd8, 0xff, 0xe0] : [0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e];
  bytes.set(head, 0);
  return bytes;
}

export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
