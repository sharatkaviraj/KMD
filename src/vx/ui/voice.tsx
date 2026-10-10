"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Ic } from "@/vx/icons";

/*
 * Speak a note (PLAN A.11). The Web Speech API, `hi-IN` or `en-IN`, which
 * Chrome on Android supports. Where it is missing the widget says so and the
 * teacher uses the microphone on the phone keyboard instead — the text box is
 * always there. Only the words are stored, never audio.
 */

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noSubscribe = () => () => {};

export function useSpeech(onText: (finalText: string) => void) {
  const supported = useSyncExternalStore(
    noSubscribe,
    () => Boolean(recognitionCtor()),
    () => false,
  );
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onText);
  useEffect(() => {
    cb.current = onText;
  });

  useEffect(() => () => rec.current?.abort(), []);

  const start = (lang: "hi-IN" | "en-IN") => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError("Speaking is not available in this browser. Use the mic on your keyboard.");
      return;
    }
    setError(null);
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const res = e.results[i];
        if (res.isFinal) cb.current(res[0].transcript.trim());
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onerror = (e) => {
      setError(e.error === "not-allowed" ? "Allow the microphone to speak a note." : "Could not hear that. Try again or type.");
      setListening(false);
    };
    r.onend = () => {
      setListening(false);
      setInterim("");
    };
    rec.current = r;
    r.start();
    setListening(true);
  };

  const stop = () => {
    rec.current?.stop();
    setListening(false);
  };

  return { supported, listening, interim, error, start, stop };
}

/** Animated bars while listening (xWave). */
export function Waveform({ active = true, bars = 18 }: { active?: boolean; bars?: number }) {
  return (
    <span aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 3, height: 36 }}>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          style={{
            width: 4,
            height: 36,
            borderRadius: 2,
            background: "var(--acc)",
            transformOrigin: "center",
            transform: active ? undefined : "scaleY(.25)",
            animation: active ? `xWave .9s ease-in-out ${(i % 6) * 0.11}s infinite` : "none",
            opacity: 0.55 + ((i * 37) % 45) / 100,
          }}
        />
      ))}
    </span>
  );
}

/**
 * A text box with a big microphone. Spoken words are appended to the text.
 */
export function VoiceNote({
  value,
  onChange,
  placeholder = "Type or speak the note…",
  lang = "hi-IN",
  onLangChange,
  rows = 5,
  name,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  lang?: "hi-IN" | "en-IN";
  onLangChange?: (l: "hi-IN" | "en-IN") => void;
  rows?: number;
  name?: string;
}) {
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  });
  const speech = useSpeech((text) => {
    const cur = valueRef.current;
    onChange(cur ? `${cur.replace(/\s+$/, "")} ${text}` : text);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ position: "relative" }}>
        <textarea
          className="inp"
          name={name}
          rows={rows}
          value={speech.listening && speech.interim ? `${value}${value ? " " : ""}${speech.interim}` : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label="Note"
          style={{ paddingRight: 64 }}
        />
        <button
          type="button"
          className="tap"
          aria-label={speech.listening ? "Stop listening" : "Speak the note"}
          aria-pressed={speech.listening}
          onClick={() => (speech.listening ? speech.stop() : speech.start(lang))}
          style={{ position: "absolute", right: 10, bottom: 10, width: 48, height: 48, borderRadius: 24, border: 0, background: speech.listening ? "var(--bad)" : "var(--pri)", color: "var(--prifg)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          {speech.listening ? (
            <>
              <span aria-hidden="true" style={{ position: "absolute", inset: 0, borderRadius: 24, background: "var(--bad)", animation: "xRipple 1.6s ease-out infinite" }} />
              <span style={{ position: "relative", width: 16, height: 16, borderRadius: 4, background: "var(--onsolid)" }} />
            </>
          ) : (
            <Ic n="mic" size={22} />
          )}
        </button>
      </div>
      {speech.listening ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--accfg)", fontSize: 13, fontWeight: 600 }}>
          <Waveform />
          Listening… speak in {lang === "hi-IN" ? "Hindi" : "English"}
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: "var(--mut)" }}>
        {onLangChange ? (
          <>
            <span>Speak in</span>
            {(["hi-IN", "en-IN"] as const).map((l) => (
              <button key={l} type="button" className={`tap chip${lang === l ? " on" : ""}`} aria-pressed={lang === l} onClick={() => onLangChange(l)} style={{ height: 30 }}>
                {l === "hi-IN" ? "हिंदी" : "English"}
              </button>
            ))}
          </>
        ) : null}
        {speech.error ? <span role="alert" style={{ color: "var(--warnfg)" }}>{speech.error}</span> : !speech.supported ? <span>Tip: use the mic on your phone keyboard to speak.</span> : null}
      </div>
    </div>
  );
}
