import { beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  permission: vi.fn(), preview: vi.fn(), visible: vi.fn(), open: vi.fn(), remove: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: mock.permission }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: mock.preview }));
vi.mock("@/platform/auth/test-session-access", () => ({ assertStudentVisible: mock.visible }));
vi.mock("@/modules/collection/data/documents-repo", () => ({ openableDocument: mock.open, deleteDocument: mock.remove }));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidate }));

import { removeStudentDocument } from "@/vx/screens/admin/student-document-actions";

const id = "00000000-0000-4000-8000-0000000000d1";
const studentId = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.resetAllMocks();
  mock.permission.mockResolvedValue({ id: "staff" });
  mock.open.mockResolvedValue({ id, studentId });
});

it("removes only an authorized document and refreshes its actual student's two profiles", async () => {
  expect(await removeStudentDocument(id)).toEqual({ ok: true });
  expect(mock.permission).toHaveBeenCalledWith("documents:manage");
  expect(mock.visible).toHaveBeenCalledWith({ id: "staff" }, studentId);
  expect(mock.remove).toHaveBeenCalledWith(id);
  expect(mock.revalidate.mock.calls).toEqual([[`/students/${studentId}`], [`/teach/student/${studentId}`]]);
});

it.each(["permission", "preview", "visible"] as const)("retains the document when %s denies the action", async (guard) => {
  mock[guard].mockRejectedValue(new Error("Denied"));
  expect(await removeStudentDocument(id)).toEqual({ ok: false });
  expect(mock.remove).not.toHaveBeenCalled();
  expect(mock.revalidate).not.toHaveBeenCalled();
});

it("returns a retryable failure without claiming removal when storage fails", async () => {
  mock.remove.mockRejectedValue(new Error("Unavailable"));
  expect(await removeStudentDocument(id)).toEqual({ ok: false });
  expect(mock.revalidate).not.toHaveBeenCalled();
});

it("does not remove an invalid or inaccessible document", async () => {
  expect(await removeStudentDocument("invalid")).toEqual({ ok: false });
  mock.open.mockResolvedValue(null);
  expect(await removeStudentDocument(id)).toEqual({ ok: false });
  expect(mock.remove).not.toHaveBeenCalled();
});
