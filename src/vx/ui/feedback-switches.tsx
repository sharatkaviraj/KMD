"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import { canVibrate, cue } from "@/ui/feedback/cue";
import { canSpeak, speakLine } from "@/ui/feedback/speak";
import { useFeedbackPrefs } from "@/ui/feedback/use-feedback-prefs";
import type { IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";

const SAY = {
  sound: p("Sounds", "आवाज़"),
  soundSub: p("A short chime when something is saved or goes wrong · this device", "कुछ सहेजने या गड़बड़ होने पर छोटी-सी आवाज़ · इसी डिवाइस पर"),
  vibrate: p("Vibration", "कंपन"),
  vibrateSub: p("A short buzz under your thumb · this phone", "अंगूठे के नीचे हल्का कंपन · इसी फ़ोन पर"),
  speak: p("Read aloud", "बोलकर बताएँ"),
  speakSub: p("Hear each ‘Saved’ message spoken · this device", "हर ‘सहेजा गया’ संदेश सुनाई दे · इसी डिवाइस पर"),
  speakOn: p("Read aloud is on.", "अब संदेश बोलकर बताए जाएँगे।"),
};

export type FeedbackRow = { key: string; icon: IconName; title: Pair; sub: Pair; on: boolean; flip: () => void };

const noSubscribe = () => () => {};

/**
 * Sounds, Vibration and Read aloud (D-497): the person's own switches for
 * the app's cues, kept on this device. Each screen draws the rows in its own
 * switch style (`row`), so Menu, Settings and the teacher's profile keep their
 * looks. Turning one on plays it once, so the person knows what it is.
 * Vibration is offered only where the phone can (never an iPhone), Read aloud
 * only where the browser can speak.
 */
export function FeedbackSwitches({ row }: { row: (r: FeedbackRow) => ReactNode }) {
  const { tx } = useVx();
  const [prefs, set] = useFeedbackPrefs();
  const vibrates = useSyncExternalStore(noSubscribe, canVibrate, () => false);
  const speaks = useSyncExternalStore(noSubscribe, canSpeak, () => false);

  const rows: FeedbackRow[] = [
    {
      key: "fb-sound",
      icon: prefs.sound ? "volume" : "volumeOff",
      title: SAY.sound,
      sub: SAY.soundSub,
      on: prefs.sound,
      flip: () => {
        const on = !prefs.sound;
        set({ sound: on });
        if (on) cue("success", { force: true });
      },
    },
  ];
  if (vibrates) {
    rows.push({
      key: "fb-vibrate",
      icon: "vibrate",
      title: SAY.vibrate,
      sub: SAY.vibrateSub,
      on: prefs.vibrate,
      flip: () => {
        const on = !prefs.vibrate;
        set({ vibrate: on });
        if (on) cue("success", { force: true });
      },
    });
  }
  if (speaks) {
    rows.push({
      key: "fb-speak",
      icon: "message",
      title: SAY.speak,
      sub: SAY.speakSub,
      on: prefs.speak,
      flip: () => {
        const on = !prefs.speak;
        set({ speak: on });
        if (on) speakLine(tx(SAY.speakOn));
      },
    });
  }
  return <>{rows.map((r) => row(r))}</>;
}
