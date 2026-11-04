"use client";

import { useEffect, useRef, useState } from "react";

import { AI_MAX_FILE_BYTES, AI_MAX_VOICE_SECONDS } from "@/lib/ai/media-limits";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";

const formats = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"];

export function VoiceButton({ onClip }: { onClip: (clip: Blob) => void }) {
  const { tx } = useVx();
  const [state, setState] = useState<"idle" | "starting" | "recording" | "failed">("idle");
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
          onClip(clip);
        } else setState("failed");
      };
      recorder.start();
      capture.current = { recorder, stream: audio, timer: setTimeout(stop, AI_MAX_VOICE_SECONDS * 1_000) };
      setState("recording");
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      if (alive.current && thisRequest === request.current) {
        held.current = false;
        setState("failed");
      }
    }
  }

  return <div className="space-y-2">
    <button type="button" className="tap btn pri big" style={{ touchAction: "none", userSelect: "none", WebkitTouchCallout: "none" }}
      aria-pressed={state === "recording"}
      onPointerDown={(e) => { if (e.isPrimary && e.button === 0) { e.currentTarget.setPointerCapture(e.pointerId); void start(); } }}
      onPointerUp={stop} onPointerCancel={cancel} onLostPointerCapture={() => { if (held.current) cancel(); }}
      onKeyDown={(e) => { if ([" ", "Enter"].includes(e.key)) { e.preventDefault(); if (!e.repeat) void start(); } }}
      onKeyUp={(e) => { if ([" ", "Enter"].includes(e.key)) { e.preventDefault(); stop(); } }}
      onBlur={() => { if (held.current) cancel(); }}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => { if (e.detail === 0) { if (held.current) stop(); else void start(); } }}>
      <Ic n="mic" />
      {tx(p("Hold to speak", "बोलने के लिए दबाएँ"))}
    </button>
    <p role="status">{state === "starting" ? tx(p("Opening microphone…", "माइक खुल रहा है…")) :
      state === "recording" ? tx(p("Recording · release to stop", "रिकॉर्ड हो रहा है · रोकने के लिए छोड़ें")) :
      state === "failed" ? tx(p("Could not record. Check microphone access and try again.", "रिकॉर्ड नहीं हुआ। माइक की अनुमति जाँचकर फिर कोशिश करें।")) : null}</p>
  </div>;
}
