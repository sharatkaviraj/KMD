"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

import { cue } from "@/ui/feedback/cue";
import { canSpeak, speakLines, stopSpeaking } from "@/ui/feedback/speak";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";

const SAY = {
  listen: p("Listen", "सुनें"),
  stop: p("Stop", "रोकें"),
  noVoice: p(
    "This phone has no voice for these words. Add Hindi under the phone's text-to-speech settings.",
    "इस फ़ोन में इन शब्दों की आवाज़ नहीं है। फ़ोन की ‘टेक्स्ट-टू-स्पीच’ सेटिंग में हिंदी जोड़ें।",
  ),
};

const noSubscribe = () => () => {};

/**
 * "Listen / सुनें" (D-497): reads the lines aloud with the phone's own voice,
 * in the language they are written in, and says which line is being read
 * (`onLine`) so a help sheet can light up that step. Only ever started by a
 * tap; closing the sheet stops it. Hidden where the browser cannot speak.
 */
export function ListenButton({
  lines,
  onLine,
  className = "tap btn sec",
  style,
}: {
  lines: string[];
  onLine?: (index: number | null) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const { tx } = useVx();
  const able = useSyncExternalStore(noSubscribe, canSpeak, () => false);
  const [speaking, setSpeaking] = useState(false);
  const [noVoice, setNoVoice] = useState(false);
  const mine = useRef(false);
  const lineRef = useRef(onLine);
  useEffect(() => {
    lineRef.current = onLine;
  });

  useEffect(
    () => () => {
      if (mine.current) stopSpeaking();
    },
    [],
  );

  if (!able) return null;

  const stop = () => {
    mine.current = false;
    stopSpeaking();
    setSpeaking(false);
    lineRef.current?.(null);
  };

  const start = async () => {
    cue("tap");
    setNoVoice(false);
    mine.current = true;
    setSpeaking(true);
    const ok = await speakLines(lines, {
      onLine: (i) => lineRef.current?.(i),
      onEnd: () => {
        mine.current = false;
        setSpeaking(false);
        lineRef.current?.(null);
      },
    });
    if (!ok) {
      mine.current = false;
      setSpeaking(false);
      setNoVoice(true);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
      <button
        type="button"
        className={className}
        aria-pressed={speaking}
        onClick={() => (speaking ? stop() : void start())}
        style={{ gap: 8, ...style }}
      >
        <Ic n={speaking ? "volumeOff" : "volume"} className={speaking ? "vx-listening" : undefined} />
        {tx(speaking ? SAY.stop : SAY.listen)}
      </button>
      {noVoice ? (
        <span role="status" style={{ fontSize: 13, color: "var(--mut)" }}>
          {tx(SAY.noVoice)}
        </span>
      ) : null}
    </div>
  );
}
