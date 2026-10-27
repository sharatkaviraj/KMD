import { beforeEach, expect, it, vi } from "vitest";

/**
 * Opening a document (D-333): the row is read as the person asking, so a
 * document id from another class — or a made-up one — opens nothing, mints
 * nothing and fetches nothing from Drive.
 */

const mock = vi.hoisted(() => ({
  permitted: true,
  row: null as Record<string, unknown> | null,
  filters: [] as string[],
  sign: vi.fn(),
  driveBytes: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT ${to}`), { to });
  },
}));
vi.mock("@/platform/auth/current-staff", () => ({
  assertPermission: async (permission: string) => {
    if (!mock.permitted) throw new Error(`Permission denied: ${permission}`);
    return { id: "staff", role: "teacher" };
  },
}));
vi.mock("@/platform/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => (mock.filters.push(`${column}=${String(value)}`), query),
        is: (column: string, value: unknown) => (mock.filters.push(`${column} is ${String(value)}`), query),
        maybeSingle: async () => ({ data: mock.row, error: null }),
      };
      return query;
    },
  }),
}));
vi.mock("@/platform/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: () => ({ createSignedUrl: mock.sign }) } }),
}));
vi.mock("@/modules/collection/data/drive-documents", () => ({ driveDocumentBytes: mock.driveBytes }));
vi.mock("@/platform/google/vercel-oidc", () => ({ vercelOidcToken: async () => "oidc" }));
vi.mock("@/platform/observability/log", () => ({ logError: vi.fn() }));

import { GET } from "@/app/(app)/documents/[id]/route";
import { DriveError } from "@/platform/google/drive";

const ID = "00000000-0000-4000-8000-0000000000d1";
const open = (id = ID, headers: Record<string, string> = {}, query = "") =>
  GET(new Request(`https://vppsone.test/documents/${id}${query}`, { headers }), { params: Promise.resolve({ id }) });

const driveRow = {
  id: ID,
  student_id: "student",
  storage_provider: "gdrive",
  storage_path: `gdrive/${ID}`,
  drive_file_id: "1SyntheticDriveFile0001",
  file_name: 'Synthetic "child" record.pdf',
  content_type: "application/pdf",
  byte_size: 9,
};

beforeEach(() => {
  mock.permitted = true;
  mock.row = null;
  mock.filters = [];
  mock.sign.mockReset().mockResolvedValue({ data: { signedUrl: "https://storage.test/signed" }, error: null });
  mock.driveBytes.mockReset().mockResolvedValue(new Response("%PDF-1.7\n", { headers: { "content-length": "9" } }));
});

it("opens nothing for a document outside the person's classes", async () => {
  mock.row = null; // what the scoped policy returns for another class's row
  await expect(open()).rejects.toMatchObject({ to: "/access-denied?permission=documents%3Aview" });
  expect(mock.filters).toEqual(expect.arrayContaining([`id=${ID}`, "upload_state=stored", "removed_at is null"]));
  expect(mock.sign).not.toHaveBeenCalled();
  expect(mock.driveBytes).not.toHaveBeenCalled();
});

it("does not even look up a forged id", async () => {
  await expect(open("..%2F..%2Fsecret")).rejects.toMatchObject({ to: "/access-denied?permission=documents%3Aview" });
  expect(mock.filters).toEqual([]);
});

it("refuses someone without documents:view", async () => {
  mock.permitted = false;
  mock.row = driveRow;
  await expect(open()).rejects.toMatchObject({ to: "/access-denied?permission=documents%3Aview" });
  expect(mock.driveBytes).not.toHaveBeenCalled();
});

it("still sends a bucket document to a one-minute signed link", async () => {
  mock.row = { ...driveRow, storage_provider: "supabase", storage_path: "2026-27/student/x.pdf", drive_file_id: null };
  await expect(open()).rejects.toMatchObject({ to: "https://storage.test/signed" });
  expect(mock.sign).toHaveBeenCalledWith("2026-27/student/x.pdf", 60);
});

it("streams a Drive document privately, uncached, as exactly its checked type", async () => {
  mock.row = driveRow;
  const response = await open();
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("%PDF-1.7\n");
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-disposition")).toMatch(/^inline; filename="Synthetic-child-record\.pdf"/);
  expect(mock.driveBytes).toHaveBeenCalledWith(driveRow.drive_file_id, null, "oidc");
});

it("saves a download under the checked type's extension, whatever it was called", async () => {
  mock.row = { ...driveRow, file_name: "notes.html" };
  const response = await open(ID, {}, "?download=1");
  expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="notes\.pdf"/);
  expect(response.headers.get("content-type")).toBe("application/pdf");
});

it("passes a PDF viewer's range request through", async () => {
  mock.row = driveRow;
  mock.driveBytes.mockResolvedValue(
    new Response("PDF", { status: 206, headers: { "content-range": "bytes 1-3/9", "content-length": "3" } }),
  );
  const response = await open(ID, { range: "bytes=1-3" }, "?download=1");
  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe("bytes 1-3/9");
  expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
  expect(mock.driveBytes).toHaveBeenCalledWith(driveRow.drive_file_id, "bytes=1-3", "oidc");
});

it("says try again, without bytes or details, when Drive is down", async () => {
  mock.row = driveRow;
  mock.driveBytes.mockRejectedValue(new DriveError("unavailable", "synthetic outage", 503));
  const response = await open();
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).not.toContain("synthetic outage");
});
