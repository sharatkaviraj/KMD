// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scene = vi.hoisted(() => ({ upload: vi.fn(), refresh: vi.fn(), compress: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: scene.refresh }) }));
vi.mock("@/platform/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: scene.upload }) } }),
}));
vi.mock("@/lib/ai/ui/camera-capture", () => ({ compressAiPhoto: scene.compress, CameraCapture: () => null }));

import { CoverPhotoPanel } from "@/lib/ai/ui/cover-photo-panel";

let root: Root;
let host: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const day = "2026-11-04";
const jobId = "00000000-0000-4000-8000-000000000009";

describe("quick substitute from a photo", () => {
  it("reads the photo taken from the + sheet at once, and shows what was applied with Undo", async () => {
    scene.compress.mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }));
    scene.upload.mockResolvedValue({ error: null });
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, jobId, uploads: [{ path: `${jobId}/1.jpg`, token: "mock" }] }));
    fetchMock.mockResolvedValueOnce(Response.json({
      ok: true, jobId, applied: [0], undoUntil: new Date(Date.now() + 120_000).toISOString(),
      review: { rows: [{ index: 0, source: { period: "3", classLabel: "7B", absentTeacher: "QT", substitute: "RM", sourceDate: "04/11/2026" }, issue: null, suggestions: [] }] },
    }));
    const photo = new File(["register"], "register.jpg", { type: "image/jpeg" });
    await act(async () => root.render(<CoverPhotoPanel day={day} initial={null} embedded initialPhotos={[photo]} />));
    await act(async () => {});

    expect(scene.compress).toHaveBeenCalledWith(photo);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ day, pages: 1 });
    expect(scene.upload).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/ai/substitution-photo/parse");
    expect(host.textContent).toContain("1 assignments saved");
    expect(host.textContent).toContain("Undo photo assignments");
    expect(host.textContent).not.toContain("Open photo tools");
    expect(scene.refresh).toHaveBeenCalled();
  });

  it("says so when the photo cannot be prepared, without calling the server", async () => {
    scene.compress.mockRejectedValue(new Error("Image too large"));
    await act(async () => root.render(<CoverPhotoPanel day={day} initial={null} embedded initialPhotos={[new File(["x"], "x.jpg")]} />));
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Could not upload the photo");
  });
});
