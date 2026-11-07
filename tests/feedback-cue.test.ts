// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CUE_SOUND, CUE_VIBRATION, cue, emptyCueHistory, primeFeedback, resetCueStateForTests, RESULT_WINDOW_MS, shouldCue, type CueHistory } from "@/ui/feedback/cue";
import { FEEDBACK_DEFAULTS, FEEDBACK_KEY, parseFeedbackPrefs, writeFeedbackPrefs } from "@/ui/feedback/prefs";
import { langOf, pickVoice, speakable } from "@/ui/feedback/speak";
import { TONES, toneLength } from "@/ui/feedback/tones";
import { toastCue } from "@/vx/ui/overlays";

/*
 * The feedback cues (D-497): a buzz and a short chime for saved, done,
 * failed and listening. These pin the rules that keep them from becoming
 * noise: nothing before the person's first touch, one cue per result, the
 * person's own switches, and quick taps on a register still felt.
 */

describe("shouldCue", () => {
  const at = (kind: Parameters<typeof shouldCue>[0], ms: number, h: CueHistory) => {
    const ok = shouldCue(kind, ms, h);
    if (ok) h[kind === "tap" || kind === "select" ? "touch" : kind === "listen" || kind === "stop" ? "mic" : "result"] = { kind, at: ms };
    return ok;
  };

  it("lets a register be marked at speed", () => {
    const h = emptyCueHistory();
    expect(at("select", 0, h)).toBe(true);
    expect(at("select", 60, h)).toBe(true);
    expect(at("tap", 120, h)).toBe(true);
    expect(at("select", 130, h)).toBe(false);
  });

  it("never sounds one save twice: a toast and its save line cue once", () => {
    const h = emptyCueHistory();
    expect(at("success", 0, h)).toBe(true);
    expect(at("success", 200, h)).toBe(false);
    expect(at("success", RESULT_WINDOW_MS + 1, h)).toBe(true);
  });

  it("lets a stronger result through, never a weaker one", () => {
    const h = emptyCueHistory();
    expect(at("success", 0, h)).toBe(true);
    expect(at("done", 100, h)).toBe(true);
    expect(at("success", 200, h)).toBe(false);
    expect(at("error", 300, h)).toBe(false);
  });

  it("keeps the microphone's start and stop apart from results", () => {
    const h = emptyCueHistory();
    expect(at("done", 0, h)).toBe(true);
    expect(at("listen", 10, h)).toBe(true);
    expect(at("stop", 50, h)).toBe(true);
    expect(at("stop", 100, h)).toBe(false);
  });
});

describe("cue", () => {
  let vibrate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetCueStateForTests();
    window.localStorage.clear();
    Object.defineProperty(navigator, "userActivation", { value: { hasBeenActive: false }, configurable: true });
    vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    // No audio in jsdom: sounds are a quiet no-op here.
    writeFeedbackPrefs({ sound: false });
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("stays still on page load, before the person has touched anything", () => {
    cue("success");
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("buzzes once the person has touched the page", () => {
    primeFeedback();
    window.dispatchEvent(new Event("pointerdown"));
    // jsdom marks synthetic events untrusted; the first trusted touch is what counts.
    cue("success");
    expect(vibrate).not.toHaveBeenCalled();
    resetCueStateForTests();
    Object.defineProperty(navigator, "userActivation", { value: { hasBeenActive: true }, configurable: true });
    cue("success");
    expect(vibrate).toHaveBeenCalledWith(CUE_VIBRATION.success);
  });

  it("respects the Vibration switch", () => {
    Object.defineProperty(navigator, "userActivation", { value: { hasBeenActive: true }, configurable: true });
    writeFeedbackPrefs({ vibrate: false });
    cue("error");
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("is silent while the app is in the background", () => {
    Object.defineProperty(navigator, "userActivation", { value: { hasBeenActive: true }, configurable: true });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    cue("done");
    expect(vibrate).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
});

describe("the switches", () => {
  it("default to sounds and vibration on, read aloud off", () => {
    expect(parseFeedbackPrefs(null)).toEqual({ sound: true, vibrate: true, speak: false });
    expect(FEEDBACK_DEFAULTS.speak).toBe(false);
  });

  it("read a stored choice key by key and survive junk", () => {
    expect(parseFeedbackPrefs(JSON.stringify({ sound: false }))).toEqual({ sound: false, vibrate: true, speak: false });
    expect(parseFeedbackPrefs("{not json")).toEqual(FEEDBACK_DEFAULTS);
    expect(parseFeedbackPrefs(JSON.stringify({ sound: "yes", speak: true }))).toEqual({ sound: true, vibrate: true, speak: true });
  });

  it("are kept on this device under one key", () => {
    window.localStorage.clear();
    writeFeedbackPrefs({ speak: true });
    expect(JSON.parse(window.localStorage.getItem(FEEDBACK_KEY) ?? "{}")).toEqual({ sound: true, vibrate: true, speak: true });
    window.localStorage.clear();
  });
});

describe("toasts cue by their tone", () => {
  it("maps ok, bad and info, and lets a screen choose", () => {
    expect(toastCue({})).toBe("success");
    expect(toastCue({ tone: "ok" })).toBe("success");
    expect(toastCue({ tone: "bad" })).toBe("error");
    expect(toastCue({ tone: "info" })).toBe("tap");
    expect(toastCue({ cue: "done" })).toBe("done");
    expect(toastCue({ tone: "bad", cue: false })).toBeNull();
  });
});

describe("sounds", () => {
  it("are short: every chime is under half a second", () => {
    for (const name of Object.keys(TONES) as (keyof typeof TONES)[]) expect(toneLength(name)).toBeLessThanOrEqual(0.5);
  });

  it("are never made for a touch", () => {
    expect(CUE_SOUND.tap).toBeUndefined();
    expect(CUE_SOUND.select).toBeUndefined();
  });
});

describe("reading aloud", () => {
  it("picks Hindi for Devanagari and English otherwise", () => {
    expect(langOf("सहेजा गया")).toBe("hi");
    expect(langOf("Saved at 9:40")).toBe("en");
  });

  it("drops the separators a voice would read badly", () => {
    expect(speakable("Saved · 3 absent ✓")).toBe("Saved, 3 absent");
  });

  it("prefers an Indian voice on the phone, then any voice of the language", () => {
    const voices = [
      { lang: "en-US", name: "US", localService: true },
      { lang: "hi_IN", name: "Hindi", localService: false },
      { lang: "en-IN", name: "India", localService: true },
    ];
    expect(pickVoice(voices, "hi")?.name).toBe("Hindi");
    expect(pickVoice(voices, "en")?.name).toBe("India");
    expect(pickVoice([{ lang: "en-GB", name: "UK", localService: true }], "hi")).toBeNull();
  });
});
