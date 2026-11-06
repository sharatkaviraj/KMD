"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties } from "react";

import { saveParentSwitchesAction } from "@/app/(app)/settings/actions";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Seg } from "@/vx/ui/controls";
import { useToast } from "@/vx/ui/overlays";

import type { AbsentAlertMode, ParentSwitches } from "./domain/parent-switches";

/*
 * Settings → Parent messages (owner, 6 Nov 2026). The admin decides, for each
 * kind of message One can queue for a family, whether teachers may queue it.
 * The register's absent-child WhatsApp also takes where its switch starts.
 * Changes save as they are made, like Preferences.
 */

const m12: CSSProperties = { fontSize: 12, color: "var(--mut)" };

const FLAGS: { key: "note" | "supportPlan" | "birthday"; icon: IconName; title: Pair; sub: Pair }[] = [
  { key: "note", icon: "notePen", title: p("“Tell parents” on a note", "नोट पर “अभिभावक को बताएँ”"), sub: p("A teacher may queue a WhatsApp to the family about a note.", "अध्यापक नोट के बारे में परिवार को व्हाट्सऐप कतार में रख सकते हैं।") },
  { key: "supportPlan", icon: "users", title: p("Share a support plan", "सहायता योजना भेजना"), sub: p("A support plan's steps may be queued for the parents.", "सहायता योजना के कदम अभिभावकों के लिए कतार में रखे जा सकते हैं।") },
  { key: "birthday", icon: "star", title: p("Birthday wishes", "जन्मदिन की शुभकामना"), sub: p("The class teacher may queue a birthday wish.", "कक्षा अध्यापक जन्मदिन की शुभकामना कतार में रख सकते हैं।") },
];

/** One line for the Settings list: what reaches parents right now. */
export function parentSwitchesSummary(s: ParentSwitches): Pair {
  const on = [s.absentAlert !== "off", s.note, s.supportPlan, s.birthday].filter(Boolean).length;
  if (on === 0) return p("All off · nothing is queued for parents", "सब बंद · अभिभावकों के लिए कुछ नहीं");
  const reg = s.absentAlert === "off" ? p("register off", "हाज़िरी बंद") : s.absentAlert === "ask_on" ? p("register starts on", "हाज़िरी में चालू से शुरू") : p("register starts off", "हाज़िरी में बंद से शुरू");
  return p(`${on} of 4 on · ${reg.en}`, `4 में से ${on} चालू · ${reg.hi}`);
}

export function ParentSwitchesPanel({ initial }: { initial: ParentSwitches }) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [s, setS] = useState<ParentSwitches>(initial);
  const [pending, start] = useTransition();

  const save = (next: ParentSwitches) => {
    const before = s;
    setS(next);
    start(async () => {
      const res = await saveParentSwitchesAction(next);
      toast.show({ text: tx(res.message), tone: res.ok ? "ok" : "bad" });
      if (res.ok) router.refresh();
      else setS(before);
    });
  };

  const regLine =
    s.absentAlert === "off"
      ? p("Off · teachers do not see the WhatsApp switch, and nothing is queued.", "बंद · अध्यापकों को व्हाट्सऐप का बटन नहीं दिखता, कुछ कतार में नहीं जाता।")
      : s.absentAlert === "ask_on"
        ? p("Teachers see the switch already ON for today's first save. They can turn it off.", "आज की पहली हाज़िरी पर बटन पहले से चालू रहता है। अध्यापक बंद कर सकते हैं।")
        : p("Teachers see the switch OFF. They turn it on only when they want parents told.", "बटन बंद रहता है। अध्यापक चाहें तभी चालू करते हैं।");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 780 }}>
      <span style={{ fontSize: 13, color: "var(--mut)" }}>
        {tx(p("Decide what teachers may queue for parents. Changes save straight away and apply to the next save on every phone. A queued message still waits for the office to send it.", "तय करें कि अध्यापक अभिभावकों के लिए क्या कतार में रख सकते हैं। बदलाव तुरंत सहेजे जाते हैं और हर फ़ोन पर अगली बार से लागू होते हैं। कतार का संदेश फिर भी कार्यालय ही भेजता है।"))}
      </span>
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 14px", padding: "14px 18px" }}>
          <span aria-hidden="true" style={{ flex: "none", width: 36, height: 36, borderRadius: 11, background: "var(--oks)", color: "var(--ok)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ic n="calCheck" size={18} />
          </span>
          <span style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(p("WhatsApp to parents of absent children", "अनुपस्थित बच्चों के माता-पिता को व्हाट्सऐप"))}</span>
            <span style={m12}>{tx(regLine)}</span>
          </span>
          <div className="mfull" style={{ width: 330 }}>
            <Seg<AbsentAlertMode>
              label={tx(p("WhatsApp to parents of absent children", "अनुपस्थित बच्चों के माता-पिता को व्हाट्सऐप"))}
              value={s.absentAlert}
              onChange={(v) => save({ ...s, absentAlert: v })}
              options={[
                { value: "off", label: tx(p("Off", "बंद")) },
                { value: "ask_off", label: tx(p("Starts off", "बंद से शुरू")) },
                { value: "ask_on", label: tx(p("Starts on", "चालू से शुरू")) },
              ]}
            />
          </div>
        </div>
        {FLAGS.map((f) => {
          const value = s[f.key];
          return (
            <button key={f.key} type="button" role="switch" aria-checked={value} aria-label={tx(f.title)} className="tap row" disabled={pending} onClick={() => save({ ...s, [f.key]: !value })} style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", padding: "13px 18px", border: 0, borderTop: "1px solid var(--bd)", background: "transparent", color: "var(--fg)", textAlign: "left" }}>
              <span aria-hidden="true" style={{ flex: "none", width: 36, height: 36, borderRadius: 11, background: "var(--s2)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic n={f.icon} size={18} />
              </span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(f.title)}</span>
                <span style={m12}>{tx(value ? f.sub : p("Off · teachers are not offered this.", "बंद · अध्यापकों को यह विकल्प नहीं दिखता।"))}</span>
              </span>
              <span className={`sw${value ? " on" : ""}`}><span /></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
