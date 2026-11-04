// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scene = vi.hoisted(() => ({ upload: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: scene.refresh }) }));
vi.mock("@/platform/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: scene.upload }) } }),
}));

import { BoloPanel } from "@/lib/ai/ui/bolo-panel";
import { VoiceButton } from "@/lib/ai/ui/voice-button";

class Recorder {
  static isTypeSupported = vi.fn<(type: string) => boolean>();
  state = "inactive";
  mimeType: string;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  constructor(_stream: unknown, { mimeType }: MediaRecorderOptions) {
    this.mimeType = mimeType ?? "";
  }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["synthetic clip"]) });
    this.onstop?.();
  }
}

let root: Root;
let host: HTMLDivElement;
let layer: HTMLDivElement;
let stopTrack: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  stopTrack = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }),
  } });
  vi.stubGlobal("MediaRecorder", Recorder);
  Recorder.isTypeSupported.mockImplementation((type) => type.startsWith("audio/webm"));
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  layer = document.createElement("div");
  layer.id = "vx-layer";
  host = document.createElement("div");
  document.body.append(host, layer);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  layer.remove();
  Reflect.deleteProperty(navigator, "mediaDevices");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function button(text: string) {
  const found = Array.from(document.querySelectorAll("button")).find((el) => el.textContent === text);
  if (!found) throw new Error(`Missing ${text}`);
  return found;
}

async function press(key: "keydown" | "keyup") {
  await act(async () => button("Hold to speak").dispatchEvent(new KeyboardEvent(key, { key: " ", bubbles: true, cancelable: true })));
}

describe("Bolo microphone and review", () => {
  it.each(["audio/webm", "audio/mp4"])("sends %s and stops at sixty seconds", async (type) => {
    Recorder.isTypeSupported.mockImplementation((mime) => mime.startsWith(type));
    const onClip = vi.fn();
    act(() => root.render(<VoiceButton onClip={onClip} />));
    await press("keydown");
    expect(button("Hold to speak").getAttribute("aria-pressed")).toBe("true");
    act(() => vi.advanceTimersByTime(59_999));
    expect(onClip).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClip).toHaveBeenCalledWith(expect.objectContaining({ type }));
    expect(stopTrack).toHaveBeenCalledTimes(1);
    await press("keyup");
    expect(onClip).toHaveBeenCalledTimes(1);
  });

  it("shows a draft and transcript and discards it without applying on Cancel", async () => {
    const request = "7B में सभी बच्चे उपस्थित हैं।";
    scene.upload.mockResolvedValue({ error: null });
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, jobId: "job", uploads: [{ path: "job/1.webm", token: "mock" }] }));
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, jobId: "job", transcript: request, confirmation: "confirmation",
      result: { kind: "attendance_mark", classLabel: "7B", day: "2026-11-04", correction: false, reason: null, changes: [],
        tally: { present: 22, absent: 0, half_day: 0, late: 0, leave: 0, marked: 22, total: 22, complete: true } },
    }));
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));
    act(() => root.render(<BoloPanel />));
    act(() => button("Open Bolo").click());
    await press("keydown");
    await press("keyup");
    expect(layer.textContent).toContain(request);
    expect(layer.textContent).toContain("Present 22");
    expect(button("Save").disabled).toBe(false);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/ai/voice/upload", "/api/ai/voice/parse"]);
    await act(async () => button("Cancel").click());
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/ai/voice/upload", "/api/ai/voice/parse", "/api/ai/voice/discard"]);
    expect(layer.textContent).not.toContain(request);
  });
});
