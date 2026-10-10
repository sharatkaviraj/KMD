"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { pickSessionAction } from "@/app/(app)/preferences/session/actions";
import { clearViewAsAction, setViewAsAction } from "@/vx/shell/view-as-actions";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { RadioCard } from "@/vx/ui/controls";
import { useToast } from "@/vx/ui/overlays";
import { Card, CardHead, Pill } from "@/vx/ui/primitives";

export type SessionOption = { label: string; current: boolean; status: string };
export type RoleOption = { menu: string; label: Pair; home: string };

/**
 * P11 state `session`: which academic year to look at, and — for the
 * administrator only — which role's screens to see the app as (read-only).
 */
export function SessionPicker({ sessions, viewing, roles, previewing }: { sessions: SessionOption[]; viewing: string; roles: RoleOption[] | null; previewing: string | null }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [picked, setPicked] = useState(viewing);
  const [busy, setBusy] = useState(false);

  async function pick(label: string) {
    if (label === picked || busy) return;
    const before = picked;
    setPicked(label);
    setBusy(true);
    const res = await pickSessionAction(label);
    setBusy(false);
    if (!res.ok) {
      setPicked(before);
      toast.show({ text: res.message, tone: "bad" });
      return;
    }
    toast.show({ text: tx(p(`Now showing ${res.sessionLabel}.`, `अब ${res.sessionLabel} दिख रहा है।`)), tone: "ok" });
    router.refresh();
  }

  async function seeAs(menu: string | null) {
    setBusy(true);
    try {
      const href = menu ? await setViewAsAction(menu) : await clearViewAsAction();
      router.push(href);
      router.refresh();
    } catch (error) {
      toast.show({ text: error instanceof Error ? error.message : "Could not switch.", tone: "bad" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 620, width: "100%" }}>
      <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <CardHead title={tx(p("Academic session", "शैक्षणिक सत्र"))} sub={tx(p("Changes what you see, on this device only. School data is not changed.", "सिर्फ़ इस डिवाइस पर दिखने वाला बदलता है। स्कूल का डेटा नहीं बदलता।"))} />
        {sessions.map((s) => (
          <RadioCard
            key={s.label}
            name="session"
            checked={picked === s.label}
            onSelect={() => void pick(s.label)}
            title={s.label}
            sub={s.current ? tx(p("The school's current session", "विद्यालय का चालू सत्र")) : s.status === "closed" ? tx(p("Closed — for looking back", "बंद — पुराना देखने के लिए")) : undefined}
            trail={s.current ? <Pill tone="ok">{tx(p("Current", "चालू"))}</Pill> : /TEST/i.test(s.label) ? <Pill tone="warn">{tx(p("Practice", "अभ्यास"))}</Pill> : null}
          />
        ))}
      </Card>

      {roles ? (
        <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <CardHead title={tx(p("See the app as", "ऐप ऐसे देखें"))} sub={tx(p("Look at another role's screens. Nothing can be changed while you look.", "दूसरी भूमिका की स्क्रीन देखें। देखते समय कुछ बदला नहीं जा सकता।"))} />
          <RadioCard name="role" checked={previewing === null} onSelect={() => void seeAs(null)} title={tx(p("Myself (Admin)", "मैं (प्रशासक)"))} />
          {roles.map((r) => (
            <RadioCard key={r.menu} name="role" checked={previewing === r.menu} onSelect={() => void seeAs(r.menu)} title={tx(r.label)} sub={r.home} />
          ))}
        </Card>
      ) : null}
    </div>
  );
}
