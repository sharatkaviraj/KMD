// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendSpoken, speechSessionText } from "@/vx/ui/speech-text";
import { useHeardText, useSpeech } from "@/vx/ui/voice";

const final = (text: string) => ({ text, isFinal: true });
const interim = (text: string) => ({ text, isFinal: false });

describe("speechSessionText", () => {
  it("keeps one copy when Android resends every phrase so far as final", () => {
    expect(speechSessionText([final("aaj"), final("aaj Riya"), final("aaj Riya absent hai")]))
      .toEqual({ final: "aaj Riya absent hai", interim: "" });
    expect(speechSessionText([final("आज"), final("आज रिया"), final("आज रिया अनुपस्थित है")]).final)
      .toBe("आज रिया अनुपस्थित है");
  });

  it("drops a final phrase repeated after a pause, and keeps genuinely new phrases", () => {
    expect(speechSessionText([final("Riya absent hai"), final("Riya absent hai")]).final).toBe("Riya absent hai");
    expect(speechSessionText([final("aaj Riya"), final("absent hai")]).final).toBe("aaj Riya absent hai");
    expect(speechSessionText([final("homework done"), final("homework done today")]).final).toBe("homework done today");
  });

  it("keeps words a teacher repeats on purpose", () => {
    expect(speechSessionText([final("dheere dheere padhta hai")]).final).toBe("dheere dheere padhta hai");
    expect(speechSessionText([final("very"), final("very good")]).final).toBe("very good");
    expect(appendSpoken("very", "very good")).toBe("very very good");
  });

  it("removes what the interim part restates of the settled part", () => {
    expect(speechSessionText([final("aaj"), interim("aaj Riya")])).toEqual({ final: "aaj", interim: "Riya" });
    expect(speechSessionText([final("class seven B"), interim("seven B mein")])).toEqual({ final: "class seven B", interim: "mein" });
    expect(speechSessionText([interim("still "), interim("speaking")])).toEqual({ final: "", interim: "still speaking" });
  });
});

describe("appendSpoken", () => {
  it("adds speech after typed text without writing the shared words twice", () => {
    expect(appendSpoken("", "hello")).toBe("hello");
    expect(appendSpoken("Note: ", "Riya came late")).toBe("Note: Riya came late");
    expect(appendSpoken("Riya absent hai", "absent hai aur Aman bhi")).toBe("Riya absent hai aur Aman bhi");
    expect(appendSpoken("Riya absent hai", "Riya absent hai")).toBe("Riya absent hai");
    expect(appendSpoken("Done.", "   ")).toBe("Done.");
  });
});

type Result = { isFinal: boolean; 0: { transcript: string } };
class FakeRecognition {
  static last: FakeRecognition | null = null;
  static count = 0;
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((e: { resultIndex: number; results: Result[] }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor() {
    FakeRecognition.last = this;
    FakeRecognition.count += 1;
  }
  start() {}
  stop() {}
  abort() { this.onend?.(); }
  emit(results: [string, boolean][]) {
    this.onresult?.({ resultIndex: 0, results: results.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })) });
  }
}

let root: Root;
let host: HTMLDivElement;
let heard: string[];
let api: ReturnType<typeof useSpeech>;

function Probe() {
  const speech = useSpeech((text) => heard.push(text));
  useEffect(() => {
    api = speech;
  });
  return <output>{useHeardText(speech.heard)}</output>;
}

beforeEach(() => {
  heard = [];
  FakeRecognition.last = null;
  FakeRecognition.count = 0;
  (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognition;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe("useSpeech", () => {
  it("hands over Android's cumulative results once, and ignores results that arrive after stop", () => {
    act(() => api.start("hi-IN"));
    const r = FakeRecognition.last!;
    expect(r.continuous).toBe(true);
    act(() => r.emit([["aaj", true], ["aaj Riya", true], ["aaj Riya absent", false]]));
    expect(host.textContent).toBe("aaj Riya absent");
    act(() => api.stop());
    expect(heard).toEqual(["aaj Riya absent"]);
    expect(api.listening).toBe(false);
    // Chrome's late final after stop, then the end of the session.
    act(() => r.emit([["aaj Riya absent hai", true]]));
    act(() => r.onend?.());
    expect(heard).toEqual(["aaj Riya absent"]);
  });

  it("keeps listening across Chrome's silence cut-off and commits each stretch once", () => {
    act(() => api.start("en-IN"));
    const first = FakeRecognition.last!;
    act(() => first.emit([["Riya came late", true]]));
    act(() => first.onerror?.({ error: "no-speech" }));
    act(() => first.onend?.());
    expect(heard).toEqual(["Riya came late"]);
    expect(FakeRecognition.count).toBe(2);
    expect(api.listening).toBe(true);
    const second = FakeRecognition.last!;
    act(() => second.emit([["and left early", true]]));
    act(() => api.stop());
    expect(heard).toEqual(["Riya came late", "and left early"]);
  });

  it("stops and explains when the microphone is refused", () => {
    act(() => api.start("en-IN"));
    const r = FakeRecognition.last!;
    act(() => r.onerror?.({ error: "not-allowed" }));
    act(() => r.onend?.());
    expect(api.listening).toBe(false);
    expect(api.error).toMatch(/microphone/i);
    expect(FakeRecognition.count).toBe(1);
  });

  it("shows each partial result at once without re-rendering the screen that owns the microphone", () => {
    let screenRenders = 0;
    function Live({ store }: { store: ReturnType<typeof useSpeech>["heard"] }) {
      return <p id="live">{useHeardText(store)}</p>;
    }
    function Screen() {
      const speech = useSpeech(() => {});
      // An effect with no deps runs once per commit of this screen, so it counts its renders.
      useEffect(() => {
        screenRenders += 1;
        api = speech;
      });
      return <Live store={speech.heard} />;
    }
    act(() => root.render(<Screen />));
    act(() => api.start("hi-IN"));
    const before = screenRenders;
    const r = FakeRecognition.last!;
    for (const words of ["aaj", "aaj Riya", "aaj Riya ne homework", "aaj Riya ne homework nahi kiya"]) {
      act(() => r.emit([[words, false]]));
      expect(host.querySelector("#live")?.textContent).toBe(words);
    }
    expect(screenRenders).toBe(before);
  });
});
