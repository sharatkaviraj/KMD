"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { fixQualityAction, skipQualityAction, unskipQualityAction } from "@/app/(app)/student-tools/actions";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { useToast } from "@/vx/ui/overlays";
import { Btn } from "@/vx/ui/primitives";

import { PeopleStyles } from "@/vx/screens/admissions/ui";
import { QUALITY_ISSUES, type QualityIssue } from "@/vx/screens/student-tools/logic";

export type QualityItem = { studentId: string; name: string; classLabel: string; issue: QualityIssue; detail: string | null; otherId: string | null };

const GROUP: Record<QualityIssue, { icon: IconName; bg: string; fg: string; title: Pair; sub: Pair }> = {
  father_phone: { icon: "phone", bg: "var(--bads)", fg: "var(--bad)", title: p("Father’s phone missing", "पिता का फ़ोन नहीं"), sub: p("Needed for receipts and reminders", "रसीद और रिमाइंडर के लिए ज़रूरी") },
  duplicate: { icon: "copy", bg: "var(--warns)", fg: "var(--warnfg)", title: p("Possible duplicates", "शायद दो बार दर्ज"), sub: p("Same name and father — check if it is one child", "नाम और पिता एक — देखें कहीं एक ही बच्चा तो नहीं") },
  dob: { icon: "calendar", bg: "var(--warns)", fg: "var(--warnfg)", title: p("Birth date missing", "जन्म तिथि नहीं"), sub: p("Needed for the TC and the age check", "टीसी और उम्र जाँच के लिए ज़रूरी") },
  age: { icon: "alert", bg: "var(--warns)", fg: "var(--warnfg)", title: p("Age does not fit the class", "उम्र कक्षा से मेल नहीं खाती"), sub: p("Usually a typing mistake in the birth date", "अक्सर जन्म तिथि में टाइपिंग की ग़लती") },
  mother_name: { icon: "user", bg: "var(--infos)", fg: "var(--info)", title: p("Mother’s name missing", "माता का नाम नहीं"), sub: p("Printed on the TC and report card", "टीसी और रिपोर्ट कार्ड पर छपता है") },
  address: { icon: "mapPin", bg: "var(--s3)", fg: "var(--fg)", title: p("Address missing", "पता नहीं"), sub: p("Needed for the TC", "टीसी के लिए ज़रूरी") },
};
const ORDER: QualityIssue[] = ["father_phone", "duplicate", "dob", "age", "mother_name", "address"];
const PLACEHOLDER: Partial<Record<QualityIssue, Pair>> = {
  father_phone: p("10-digit phone", "10 अंकों का फ़ोन"),
  dob: p("DD-MM-YYYY", "DD-MM-YYYY"),
  age: p("Correct birth date DD-MM-YYYY", "सही जन्म तिथि DD-MM-YYYY"),
  mother_name: p("Mother’s name", "माता का नाम"),
  address: p("Address", "पता"),
};

/** Student tools state `quality`: what is missing or wrong, fixed one by one. */
export function QualityList({ items, total, score }: { items: QualityItem[]; total: number; score: number }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const present = ORDER.filter((k) => QUALITY_ISSUES.includes(k) && items.some((i) => i.issue === k));
  const [open, setOpen] = useState<Set<QualityIssue>>(new Set(present.slice(0, 1)));
  const [values, setValues] = useState<Record<string, string>>({});
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [fixed, setFixed] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const live = items.filter((i) => !gone.has(`${i.studentId}|${i.issue}`));
  const hide = (key: string, on: boolean) =>
    setGone((g) => {
      const n = new Set(g);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });
  const pct = items.length ? Math.round((fixed / items.length) * 100) : 100;

  async function fix(item: QualityItem) {
    const key = `${item.studentId}|${item.issue}`;
    setBusy(key);
    const res = await fixQualityAction({ studentId: item.studentId, issue: item.issue, value: values[key] ?? "" });
    setBusy(null);
    if (!res.ok) {
      toast.show({ text: res.message, tone: "bad" });
      return;
    }
    hide(key, true);
    setFixed((n) => n + 1);
    toast.show({ text: tx(p(`Fixed for ${item.name}.`, `${item.name} का सुधार हुआ।`)), tone: "ok" });
    router.refresh();
  }

  async function skip(item: QualityItem) {
    const key = `${item.studentId}|${item.issue}`;
    hide(key, true);
    const res = await skipQualityAction({ studentId: item.studentId, issue: item.issue, days: 30 });
    if (!res.ok) {
      hide(key, false);
      toast.show({ text: res.message, tone: "bad" });
      return;
    }
    toast.show({
      text: tx(p("Skipped for 30 days.", "30 दिन के लिए छोड़ा।")),
      tone: "info",
      undoLabel: tx(p("Undo", "वापस")),
      undo: async () => {
        const back = await unskipQualityAction({ studentId: item.studentId, issue: item.issue });
        if (back.ok) hide(key, false);
      },
    });
  }

  const toggle = (k: QualityIssue) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div className="pad" style={{ padding: "22px 28px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
      <PeopleStyles />
      <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(p(`${fixed} of ${items.length} fixed`, `${items.length} में से ${fixed} ठीक`))}</span>
          <span className="num" style={{ fontSize: 14, fontWeight: 700, color: "var(--ok)" }}>{pct}%</span>
        </div>
        <div style={{ height: 10, borderRadius: 5, background: "var(--s3)", overflow: "hidden" }}>
          <div style={{ height: 10, width: `${pct}%`, borderRadius: 5, background: "var(--ok)", transition: "width .5s var(--ease)" }} />
        </div>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>
          {tx(p(`${live.length} left · ${score}% of ${total} records are complete. Skipped items come back in 30 days.`, `${live.length} बाकी · ${total} में से ${score}% रिकॉर्ड पूरे। छोड़ी चीज़ें 30 दिन बाद लौटेंगी।`))}
        </span>
      </div>

      {present.length === 0 ? (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", background: "var(--oks)", color: "var(--ok)", fontSize: 14, fontWeight: 600 }}>
          <Ic n="checkCircle" />
          {tx(p("All clean — no record needs fixing right now.", "सब ठीक — अभी किसी रिकॉर्ड में सुधार नहीं चाहिए।"))}
        </div>
      ) : null}

      {present.map((k, gi) => {
        const g = GROUP[k];
        const rows = live.filter((i) => i.issue === k);
        const isOpen = open.has(k);
        return (
          <div key={k} className="card" style={{ overflow: "hidden", animation: `xIn .32s var(--ease) ${gi * 40}ms both` }}>
            <button type="button" className="tap row" aria-expanded={isOpen} onClick={() => toggle(k)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "14px 16px", border: 0, background: "transparent", color: "var(--fg)", textAlign: "left" }}>
              <span aria-hidden="true" style={{ flex: "none", width: 40, height: 40, borderRadius: 12, background: g.bg, color: g.fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic n={g.icon} />
              </span>
              <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700 }}>
                  {tx(g.title)}
                  <span className="pill num" style={{ background: g.bg, color: g.fg }}>{rows.length}</span>
                </span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(g.sub)}</span>
              </span>
              <Ic n="chevDown" style={{ color: "var(--sub)", transform: `rotate(${isOpen ? 180 : 0}deg)`, transition: "transform .3s var(--spring)" }} />
            </button>
            {isOpen ? (
              <div className="fadein" style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--bd)" }}>
                {rows.slice(0, 60).map((item, i) => {
                  const key = `${item.studentId}|${item.issue}`;
                  const fixable = item.issue !== "duplicate";
                  return (
                    <div key={key} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 16px", borderTop: i ? "1px solid var(--bd)" : 0 }}>
                      <span style={{ display: "flex", flexDirection: "column", flex: "1 1 190px", minWidth: 0 }}>
                        <a href={`/admissions/${item.studentId}`} className="clip" style={{ fontSize: 14, fontWeight: 600, color: "var(--fg)" }}>{item.name}</a>
                        <span style={{ fontSize: 12, color: "var(--mut)" }}>
                          {item.classLabel}
                          {item.issue === "duplicate" && item.detail ? ` · ${tx(p("also in", "यह भी"))} ${item.detail}` : item.issue === "age" && item.detail ? ` · ${item.detail}` : ""}
                        </span>
                      </span>
                      {fixable ? (
                        <>
                          <input
                            className="inp"
                            style={{ flex: "1 1 150px", width: "auto", height: 40 }}
                            value={values[key] ?? ""}
                            placeholder={tx(PLACEHOLDER[item.issue] ?? p(""))}
                            aria-label={`${tx(g.title)} · ${item.name}`}
                            inputMode={item.issue === "father_phone" || item.issue === "dob" || item.issue === "age" ? "numeric" : undefined}
                            onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                          />
                          <Btn variant="sec" disabled={busy === key || !(values[key] ?? "").trim()} onClick={() => fix(item)} style={{ height: 40 }}>{tx(p("Save", "सहेजें"))}</Btn>
                        </>
                      ) : (
                        <>
                          <Btn variant="sec" href={`/admissions/${item.studentId}`} style={{ height: 40 }}>{tx(p("Open this one", "यह खोलें"))}</Btn>
                          {item.otherId ? <Btn variant="sec" href={`/admissions/${item.otherId}`} style={{ height: 40 }}>{tx(p("Open the other", "दूसरा खोलें"))}</Btn> : null}
                        </>
                      )}
                      <Btn variant="ghost" onClick={() => skip(item)} style={{ height: 40, color: "var(--mut)" }}>{tx(p("Skip", "छोड़ें"))}</Btn>
                    </div>
                  );
                })}
                {rows.length > 60 ? <span style={{ fontSize: 12, color: "var(--mut)", padding: "10px 16px", borderTop: "1px solid var(--bd)" }}>{tx(p(`${rows.length - 60} more after these`, `इनके बाद ${rows.length - 60} और`))}</span> : null}
                {rows.length === 0 ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", background: "var(--oks)", color: "var(--ok)", fontSize: 14, fontWeight: 600 }}>
                    <Ic n="checkCircle" />
                    {tx(p("All done in this group", "इस समूह में सब ठीक"))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
