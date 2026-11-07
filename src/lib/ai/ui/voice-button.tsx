"use client";

import { useEffect, useRef, useState } from "react";

import { AI_MAX_FILE_BYTES, AI_MAX_VOICE_SECONDS } from "@/lib/ai/media-limits";
import { cue } from "@/ui/feedback/cue";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";

const formats = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"];

export function VoiceButton({ onClip }: { onClip: (clip: Blob) => void }) {
  const { tx } = useVx();
  const [state, setState] = useState<"idle" | "starting" | "recording" | "failed">("idle");
  const [elapsed, setElapsed] = useState(0);
  const held = useRef(false);
  const alive = useRef(false);
  const request = useRef(0);
  const cancelled = useRef(false);
  const capture = useRef<{ recorder: MediaRecorder; stream: MediaStream; timer: ReturnType<typeof setTimeout> } | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      held.current = false;
      const current = capture.current;
      if (current) {
        clearTimeout(current.timer);
        current.recorder.onstop = null;
        current.recorder.onerror = null;
        if (current.recorder.state !== "inactive") current.recorder.stop();
        current.stream.getTracks().forEach((track) => track.stop());
        capture.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (state !== "recording") return undefined;
    const began = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - began) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [state]);

  /** Recording started or finished: the app's mic cues (D-497), on the person's own switches. */
  function buzz(kind: "listen" | "stop") {
    cue(kind);
  }

  function stop() {
    held.current = false;
    if (capture.current?.recorder.state === "recording") capture.current.recorder.stop();
  }

  function cancel() {
    cancelled.current = true;
    stop();
  }

  async function start() {
    if (held.current || capture.current) return;
    held.current = true;
    cancelled.current = false;
    const thisRequest = ++request.current;
    setState("starting");
    let stream: MediaStream | undefined;
    try {
      const mimeType = typeof MediaRecorder !== "undefined" && formats.find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType || !navigator.mediaDevices?.getUserMedia) throw new Error("Recording not available");
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current || thisRequest !== request.current || !held.current) {
        stream.getTracks().forEach((track) => track.stop());
        if (alive.current && thisRequest === request.current) setState("idle");
        return;
      }
      const audio = stream;
      const recorder = new MediaRecorder(audio, { mimeType, audioBitsPerSecond: 64_000 });
      const chunks: Blob[] = [];
      let failed = false;
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { failed = true; stop(); };
      recorder.onstop = () => {
        if (capture.current?.recorder === recorder) {
          clearTimeout(capture.current.timer);
          capture.current = null;
        }
        audio.getTracks().forEach((track) => track.stop());
        held.current = false;
        if (!alive.current) return;
        if (cancelled.current) { setState("idle"); return; }
        const clip = new Blob(chunks, { type: (recorder.mimeType || mimeType).split(";")[0] });
        if (!failed && clip.size > 0 && clip.size <= AI_MAX_FILE_BYTES) {
          setState("idle");
          buzz("stop");
          onClip(clip);
        } else setState("failed");
      };
      recorder.start();
      capture.current = { recorder, stream: audio, timer: setTimeout(stop, AI_MAX_VOICE_SECONDS * 1_000) };
      setElapsed(0);
      setState("recording");
      buzz("listen");
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      if (alive.current && thisRequest === request.current) {
        held.current = false;
        setState("failed");
      }
    }
  }

  const recording = state === "recording";
  const clock = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
  return <div className="space-y-2">
    <button type="button" className="tap btn pri big" style={{
      width: "100%", height: 76, borderRadius: 22, fontSize: 17, gap: 10,
      background: recording ? "var(--bad)" : undefined,
      touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none",
      transition: "background-color .15s ease, transform .15s ease", transform: recording ? "scale(0.98)" : undefined,
    }}
      aria-pressed={state === "recording"}
      onPointerDown={(e) => { if (e.isPrimary && e.button === 0) { e.currentTarget.setPointerCapture(e.pointerId); void start(); } }}
      onPointerUp={stop} onPointerCancel={cancel} onLostPointerCapture={() => { if (held.current) cancel(); }}
      onKeyDown={(e) => { if ([" ", "Enter"].includes(e.key)) { e.preventDefault(); if (!e.repeat) void start(); } }}
      onKeyUp={(e) => { if ([" ", "Enter"].includes(e.key)) { e.preventDefault(); stop(); } }}
      onBlur={() => { if (held.current) cancel(); }}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => { if (e.detail === 0) { if (held.current) stop(); else void start(); } }}>
      <Ic n="mic" size={26} />
      {recording ? `${tx(p("Release to send", "भेजने के लिए छोड़ें"))} · ${clock(elapsed)}` : tx(p("Hold to speak", "बोलने के लिए दबाएँ"))}
    </button>
    <p role="status" className="text-sm" style={{ textAlign: "center", color: "var(--mut)", minHeight: 20 }}>{state === "starting" ? tx(p("Opening microphone…", "माइक खुल रहा है…")) :
      recording ? tx(p(`Recording · up to ${clock(AI_MAX_VOICE_SECONDS)}`, `रिकॉर्ड हो रहा है · अधिकतम ${clock(AI_MAX_VOICE_SECONDS)}`)) :
      state === "failed" ? tx(p("Could not record. Check microphone access and try again.", "रिकॉर्ड नहीं हुआ। माइक की अनुमति जाँचकर फिर कोशिश करें।")) : null}</p>
  </div>;
}
