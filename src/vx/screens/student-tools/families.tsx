"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { mergeFamilyAction, splitFamilyAction } from "@/app/(app)/student-tools/actions";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p } from "@/vx/text";
import { Confirm, Sheet, useToast } from "@/vx/ui/overlays";
import { Btn } from "@/vx/ui/primitives";

import { firstName, maskPhone } from "@/vx/screens/admissions/logic";
import { Av, PeopleStyles } from "@/vx/screens/admissions/ui";

export type FamKid = { id: string; name: string; classLabel: string };
export type LinkedFamilyView = { groupId: string; father: string; phone: string | null; village?: string | null; kids: FamKid[] };
export type SuggestedFamilyView = { key: string; father: string; phone: string | null; village?: string | null; kids: FamKid[] };

type Row = { kind: "linked"; f: LinkedFamilyView } | { kind: "suggested"; f: SuggestedFamilyView };

/** Student tools states `families` and `merge` (`?merge=<key>`). */
export function FamiliesView({ sessionLabel, linked, suggested, mergeKey }: { sessionLabel: string; linked: LinkedFamilyView[]; suggested: SuggestedFamilyView[]; mergeKey: string | null }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [show, setShow] = useState<"all" | "linked" | "suggested">("all");
  const [q, setQ] = useState("");
  const [merging, setMerging] = useState<SuggestedFamilyView | null>(suggested.find((s) => s.key === mergeKey) ?? null);
  const [picked, setPicked] = useState<Set<string>>(new Set(merging?.kids.map((k) => k.id) ?? []));
  const [splitMode, setSplitMode] = useState(false);
  const [splitting, setSplitting] = useState<{ fam: LinkedFamilyView; kid: FamKid } | null>(null);
  const [busy, setBusy] = useState(false);

  const match = (f: { father: string; phone: string | null; kids: FamKid[] }) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return f.father.toLowerCase().includes(s) || (f.phone ?? "").includes(s) || f.kids.some((k) => k.name.toLowerCase().includes(s));
  };

  function openMerge(s: SuggestedFamilyView | undefined) {
    if (!s) {
      toast.show({ text: tx(p("No families look like one family right now.", "अभी कोई परिवार एक जैसा नहीं दिखता।")), tone: "info" });
      return;
    }
    setMerging(s);
    setPicked(new Set(s.kids.map((k) => k.id)));
  }

  async function merge() {
    if (!merging) return;
    setBusy(true);
    const ids = merging.kids.map((k) => k.id).filter((id) => picked.has(id));
    const res = await mergeFamilyAction({ studentIds: ids, sessionLabel, father: merging.father });
    setBusy(false);
    if (!res.ok) {
      toast.show({ text: res.message, tone: "bad" });
      return;
    }
    setMerging(null);
    toast.show({ text: tx(p(`Linked ${ids.length} children as one family.`, `${ids.length} बच्चे एक परिवार में जुड़े।`)), tone: "ok" });
    router.replace("/student-tools?view=families");
    router.refresh();
  }

  async function split() {
    if (!splitting) return;
    setBusy(true);
    const res = await splitFamilyAction({ studentId: splitting.kid.id, familyGroupId: splitting.fam.groupId, sessionLabel, name: splitting.kid.name });
    setBusy(false);
    setSplitting(null);
    if (!res.ok) {
      toast.show({ text: res.message, tone: "bad" });
      return;
    }
    toast.show({ text: tx(p(`${splitting.kid.name} taken out of the family.`, `${splitting.kid.name} परिवार से अलग किया।`)), tone: "ok" });
    router.refresh();
  }

  const rows: Row[] = [
    ...(show !== "linked" ? suggested.filter(match).map((f) => ({ kind: "suggested" as const, f })) : []),
    ...(show !== "suggested" ? linked.filter(match).map((f) => ({ kind: "linked" as const, f })) : []),
  ];
  const line = (f: { phone: string | null; village?: string | null }) => [f.phone ? maskPhone(f.phone) : null, f.village].filter(Boolean).join(" · ") || "—";
  const pill = (on: boolean) => ({ height: 30, padding: "0 12px", fontSize: 13, border: 0, cursor: "pointer", outline: on ? "2px solid var(--acc)" : undefined, outlineOffset: 1 });

  return (
    <div className="pad" style={{ padding: "22px 28px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
      <PeopleStyles />
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <label style={{ flex: 1, minWidth: 220, display: "flex", alignItems: "center", gap: 8, height: 44, padding: "0 14px", borderRadius: 14, border: "1px solid var(--bds)", background: "var(--card)", color: "var(--mut)" }}>
          <Ic n="search" />
          <span className="sr">{tx(p("Search families", "परिवार खोजें"))}</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx(p("Father, child or phone", "पिता, बच्चा या फ़ोन"))} style={{ flex: 1, minWidth: 0, height: 40, border: 0, outline: "none", background: "transparent", fontSize: 15, color: "var(--fg)" }} />
        </label>
        <Btn variant="sec" icon="link" onClick={() => openMerge(suggested[0])}>{tx(p("Merge two families", "दो परिवार जोड़ें"))}</Btn>
        <Btn variant={splitMode ? "pri" : "sec"} icon="swap" onClick={() => { setSplitMode(!splitMode); if (!splitMode) setShow("linked"); }}>{tx(p("Split a child", "बच्चा अलग करें"))}</Btn>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="tap pill num" aria-pressed={show === "all"} onClick={() => setShow("all")} style={{ ...pill(show === "all"), background: "var(--s2)", color: "var(--mut)" }}>{linked.length + suggested.length} {tx(p("families", "परिवार"))}</button>
        <button type="button" className="tap pill num" aria-pressed={show === "linked"} onClick={() => setShow("linked")} style={{ ...pill(show === "linked"), background: "var(--accs)", color: "var(--accfg)" }}>{linked.length} {tx(p("linked as brothers or sisters", "भाई-बहन के रूप में जुड़े"))}</button>
        <button type="button" className="tap pill num" aria-pressed={show === "suggested"} onClick={() => setShow("suggested")} style={{ ...pill(show === "suggested"), background: "var(--warns)", color: "var(--warnfg)" }}>{suggested.length} {tx(p("may be one family", "शायद एक परिवार"))}</button>
      </div>
      {splitMode ? (
        <div className="fadein" style={{ display: "flex", gap: 10, padding: "12px 14px", borderRadius: 14, background: "var(--infos)", color: "var(--info)", fontSize: 13, lineHeight: 1.5 }}>
          <Ic n="info" style={{ marginTop: 2 }} />
          <span>{tx(p("Tap the child who should move out of a linked family. The 3rd-child rule is worked out again for the children left.", "जुड़े परिवार से जिस बच्चे को अलग करना है उसे दबाएँ। बचे बच्चों के लिए तीसरे बच्चे का नियम फिर से लगेगा।"))}</span>
        </div>
      ) : null}
      <div className="card" style={{ overflow: "hidden" }}>
        {rows.slice(0, 80).map((r, i) => {
          const f = r.f;
          return (
            <div key={r.kind === "linked" ? r.f.groupId : r.f.key} className="st-frow" style={{ borderTop: i ? "1px solid var(--bd)" : 0, animation: `xIn .32s var(--ease) ${Math.min(i, 14) * 26}ms both` }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <Av name={f.father} size={36} font={13} />
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{f.father}</span>
                  <span className="num clip" style={{ fontSize: 12, color: "var(--mut)" }}>{line(f)}</span>
                </span>
              </span>
              <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {f.kids.map((k) =>
                  r.kind === "linked" && splitMode ? (
                    <button key={k.id} type="button" className="tap pill" onClick={() => setSplitting({ fam: r.f, kid: k })} aria-label={tx(p(`Take ${k.name} out of this family`, `${k.name} को इस परिवार से अलग करें`))} style={{ border: "1px solid var(--bad)", background: "var(--bads)", color: "var(--bad)", cursor: "pointer" }}>
                      {firstName(k.name)} · {k.classLabel}
                      <Ic n="x" size={12} />
                    </button>
                  ) : (
                    <span key={k.id} className="pill" style={{ background: "var(--s2)", color: "var(--fg)" }}>{firstName(k.name)} · {k.classLabel}</span>
                  ),
                )}
              </span>
              {r.kind === "linked" ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{f.kids.length >= 3 ? tx(p("Linked · 3rd-child rule applies", "जुड़े · तीसरे बच्चे का नियम")) : tx(p("Linked as one family", "एक परिवार के रूप में जुड़े"))}</span>
                  <span className="pill" style={{ background: "var(--oks)", color: "var(--ok)" }}><Ic n="check" size={12} /></span>
                </span>
              ) : (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("Not linked yet", "अभी जुड़े नहीं"))}</span>
                  <Btn variant="soft" icon="link" style={{ height: 34, padding: "0 12px", fontSize: 13 }} onClick={() => openMerge(r.f)}>{tx(p("Check", "जाँचें"))}</Btn>
                </span>
              )}
            </div>
          );
        })}
        {rows.length === 0 ? (
          <div style={{ padding: 26, textAlign: "center", fontSize: 12, color: "var(--mut)" }}>
            {q.trim() ? tx(p(`No family matches “${q}”. Try the child’s name or a phone number.`, `“${q}” से कोई परिवार नहीं मिला। बच्चे का नाम या फ़ोन आज़माएँ।`)) : tx(p("No families to show.", "दिखाने को कोई परिवार नहीं।"))}
          </div>
        ) : null}
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--bd)", fontSize: 12, color: "var(--mut)" }}>
          {tx(p(`Showing ${Math.min(rows.length, 80)} of ${rows.length}. Linked brothers and sisters decide the 3rd-child fee rule; linking or splitting works their fees out again.`, `${rows.length} में से ${Math.min(rows.length, 80)}। जुड़े भाई-बहन तीसरे बच्चे का नियम तय करते हैं; जोड़ने या अलग करने से फीस फिर से बनती है।`))}
        </div>
      </div>

      <Sheet
        open={merging !== null}
        onClose={() => setMerging(null)}
        title={tx(p("Merge two families", "दो परिवार जोड़ें"))}
        sub={tx(p("Pick the records that are really one family", "वे रिकॉर्ड चुनें जो सच में एक परिवार हैं"))}
        footer={
          <>
            <Btn variant="sec" style={{ flex: 1 }} onClick={() => setMerging(null)}>{tx(p("Cancel", "रद्द करें"))}</Btn>
            <Btn variant="pri" style={{ flex: 1.4, opacity: picked.size < 2 ? 0.5 : 1 }} disabled={busy || picked.size < 2} onClick={merge}>{tx(p("Merge families", "परिवार जोड़ें"))}</Btn>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
          {merging?.kids.map((k, i) => {
            const on = picked.has(k.id);
            return (
              <button
                key={k.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                className="tap"
                onClick={() =>
                  setPicked((s) => {
                    const n = new Set(s);
                    if (n.has(k.id)) n.delete(k.id);
                    else n.add(k.id);
                    return n;
                  })
                }
                style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 52, padding: "10px 14px", borderRadius: 14, border: `1px solid ${on ? "var(--acc)" : "var(--bd)"}`, background: on ? "var(--accs)" : "var(--card)", boxShadow: on ? "inset 0 0 0 1px var(--acc)" : "none", color: "var(--fg)", textAlign: "left", width: "100%", animation: `xIn .3s var(--ease) ${i * 30}ms both` }}
              >
                <span aria-hidden="true" style={{ flex: "none", width: 22, height: 22, borderRadius: 7, border: `2px solid ${on ? "var(--acc)" : "var(--bds)"}`, background: on ? "var(--acc)" : "transparent", color: "var(--onsolid)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {on ? <Ic n="check" size={14} stroke={3} /> : null}
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
                  <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{merging.father} · {firstName(k.name)}</span>
                  <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{[line(merging), k.classLabel].filter((x) => x && x !== "—").join(" · ")}</span>
                </span>
                {merging.phone ? <span className="pill" style={{ background: "var(--warns)", color: "var(--warnfg)" }}>{tx(p("Same phone", "एक ही फ़ोन"))}</span> : null}
              </button>
            );
          })}
          {merging && picked.size >= 2 ? (
            <div className="fadein" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px", borderRadius: 14, background: "var(--oks)", color: "var(--ok)", fontSize: 13, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700 }}>
                {tx(p("After merging", "जोड़ने के बाद"))}: {merging.father} · {merging.kids.filter((k) => picked.has(k.id)).map((k) => `${firstName(k.name)} (${k.classLabel})`).join(", ")}
              </span>
              <span>{tx(p("The 3rd-child rule is worked out again from Fee setup. Receipts and pending fees stay with each child.", "तीसरे बच्चे का नियम फीस सेटअप से फिर लगेगा। रसीदें और बकाया हर बच्चे के साथ रहते हैं।"))}</span>
            </div>
          ) : null}
        </div>
      </Sheet>

      <Confirm
        open={splitting !== null}
        onClose={() => setSplitting(null)}
        onConfirm={split}
        busy={busy}
        danger
        icon="users"
        title={tx(p(`Take ${splitting?.kid.name ?? ""} out of this family?`, `${splitting?.kid.name ?? ""} को इस परिवार से अलग करें?`))}
        body={tx(p("Sibling fee rules are worked out again for the children left.", "बचे बच्चों के लिए भाई-बहन फीस नियम फिर से लगेंगे।"))}
        confirmLabel={tx(p("Split", "अलग करें"))}
      />
    </div>
  );
}
