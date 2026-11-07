// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CUE_SOUND, CUE_VIBRATION, cue, emptyCueHistory, primeFeedback, resetCueStateForTests, RESULT_WINDOW_MS, shouldCue, type CueHistory } from "@/ui/feedback/cue";
import { FEEDBACK_DEFAULTS, FEEDBACK_KEY, parseFeedbackPrefs, writeFeedbackPrefs } from "@/ui/feedback/prefs";
import { langOf, pickVoice, speakable, speakLines, START_WATCHDOG_MS, stopSpeaking, VOICE_WAIT_MS } from "@/ui/feedback/speak";
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

/*
 * A fake speech engine, enough for speakLines: a voice list that can load
 * late, and utterances whose start, end and error the test fires by hand.
 */
type FakeUtterance = {
  text: string;
  lang: string;
  voice: unknown;
  rate: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function installFakeSpeech(initialVoices: { lang: string; name: string; localService: boolean }[]) {
  let voices = initialVoices;
  const spoken: FakeUtterance[] = [];
  const listeners = new Set<() => void>();
  const synth = {
    getVoices: () => voices,
    speak: (u: FakeUtterance) => spoken.push(u),
    cancel: vi.fn(() => {
      const queued = spoken.splice(0);
      queued.forEach((u) => u.onerror?.({ error: "canceled" }));
    }),
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  class Utterance {
    lang = "";
    voice: unknown = null;
    rate = 1;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    constructor(public text: string) {}
  }
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance, configurable: true });
  return {
    synth,
    spoken,
    loadVoices(next: typeof voices) {
      voices = next;
      listeners.forEach((fn) => fn());
    },
  };
}

describe("speakLines on a real phone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopSpeaking();
    vi.useRealTimers();
    Reflect.deleteProperty(window, "speechSynthesis");
    Reflect.deleteProperty(window, "SpeechSynthesisUtterance");
  });

  it("speaks by language when the voice list is still empty, instead of saying there is no voice", async () => {
    const fake = installFakeSpeech([]);
    const run = speakLines(["पहला कदम", "दूसरा कदम"]);
    await vi.advanceTimersByTimeAsync(VOICE_WAIT_MS + 10);
    expect(await run).toBe(true);
    expect(fake.spoken.map((u) => u.lang)).toEqual(["hi-IN", "hi-IN"]);
    expect(fake.spoken[0].voice).toBeNull();
  });

  it("starts as soon as late voices arrive and picks the Hindi one", async () => {
    const fake = installFakeSpeech([]);
    const run = speakLines(["पहला कदम"]);
    await vi.advanceTimersByTimeAsync(20);
    fake.loadVoices([{ lang: "hi_IN", name: "Hindi India", localService: true }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(await run).toBe(true);
    expect((fake.spoken[0].voice as { name: string }).name).toBe("Hindi India");
  });

  it("says no voice only when the loaded list has none for the words", async () => {
    const fake = installFakeSpeech([{ lang: "en-US", name: "US", localService: true }]);
    expect(await speakLines(["पहला कदम"])).toBe(false);
    expect(fake.spoken).toHaveLength(0);
  });

  it("reports a failure before the first word, so the button does not sit on Stop", async () => {
    const fake = installFakeSpeech([]);
    const onEnd = vi.fn();
    const onFail = vi.fn();
    const run = speakLines(["पहला कदम", "दूसरा कदम"], { onEnd, onFail });
    await vi.advanceTimersByTimeAsync(VOICE_WAIT_MS + 10);
    await run;
    fake.spoken[0].onerror?.({ error: "language-unavailable" });
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
    expect(fake.synth.cancel).toHaveBeenCalled();
  });

  it("gives up when nothing starts at all", async () => {
    installFakeSpeech([{ lang: "hi-IN", name: "Hindi", localService: true }]);
    const onFail = vi.fn();
    await speakLines(["पहला कदम"], { onFail });
    await vi.advanceTimersByTimeAsync(START_WATCHDOG_MS + 10);
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it("treats a Stop as an ending, never as a missing voice", async () => {
    const fake = installFakeSpeech([{ lang: "hi-IN", name: "Hindi", localService: true }]);
    const onLine = vi.fn();
    const onEnd = vi.fn();
    const onFail = vi.fn();
    await speakLines(["पहला कदम", "दूसरा कदम"], { onLine, onEnd, onFail });
    fake.spoken[0].onstart?.();
    expect(onLine).toHaveBeenCalledWith(0);
    stopSpeaking();
    expect(onFail).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(START_WATCHDOG_MS + 10);
    expect(onFail).not.toHaveBeenCalled();
  });

  it("never starts a run that was stopped while it waited for voices", async () => {
    const fake = installFakeSpeech([]);
    const onEnd = vi.fn();
    const run = speakLines(["पहला कदम"], { onEnd });
    stopSpeaking();
    await vi.advanceTimersByTimeAsync(VOICE_WAIT_MS + 10);
    await run;
    expect(fake.spoken).toHaveLength(0);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
