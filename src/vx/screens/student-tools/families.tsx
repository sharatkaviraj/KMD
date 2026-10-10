"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { mergeFamilyAction, splitFamilyAction } from "@/app/(app)/student-tools/actions";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { Seg, SearchBox } from "@/vx/ui/controls";
import { Confirm, Sheet, useToast } from "@/vx/ui/overlays";
import { Banner } from "@/vx/ui/page";
import { Avatar, Btn, Card, EmptyState, Pill } from "@/vx/ui/primitives";

import { maskPhone } from "@/vx/screens/admissions/logic";
import { PeopleStyles } from "@/vx/screens/admissions/ui";

export type FamKid = { id: string; name: string; classLabel: string };
export type LinkedFamilyView = { groupId: string; father: string; phone: string | null; kids: FamKid[] };
export type SuggestedFamilyView = { key: string; father: string; phone: string | null; kids: FamKid[] };

/** Student tools states `families` and `merge` (`?merge=<key>`). */
export function FamiliesView({ sessionLabel, linked, suggested, mergeKey }: { sessionLabel: string; linked: LinkedFamilyView[]; suggested: SuggestedFamilyView[]; mergeKey: string | null }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<"suggested" | "linked">(suggested.length > 0 ? "suggested" : "linked");
  const [q, setQ] = useState("");
  const [merging, setMerging] = useState<SuggestedFamilyView | null>(suggested.find((s) => s.key === mergeKey) ?? null);
  const [picked, setPicked] = useState<Set<string>>(new Set(merging?.kids.map((k) => k.id) ?? []));
  const [splitting, setSplitting] = useState<{ fam: LinkedFamilyView; kid: FamKid } | null>(null);
  const [busy, setBusy] = useState(false);

  const match = (f: { father: string; phone: string | null; kids: FamKid[] }) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return f.father.toLowerCase().includes(s) || (f.phone ?? "").includes(s) || f.kids.some((k) => k.name.toLowerCase().includes(s));
  };

  function openMerge(s: SuggestedFamilyView) {
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

  const list = tab === "suggested" ? suggested.filter(match) : linked.filter(match);
  return (
    <div className="pp-wrap" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PeopleStyles />
      <Banner tone="info">{tx(p("Linked brothers and sisters decide the third-child fee rule. Linking or unlinking recalculates their fees.", "जुड़े भाई-बहन तीसरे बच्चे का नियम तय करते हैं। जोड़ने/हटाने से फीस फिर से बनती है।"))}</Banner>
      <Seg
        label={tx(p("Show", "दिखाएँ"))}
        value={tab}
        onChange={setTab}
        options={[
          { value: "suggested", label: `${tx(p("Maybe one family", "शायद एक परिवार"))} ${suggested.length}` },
          { value: "linked", label: `${tx(p("Linked", "जुड़े हुए"))} ${linked.length}` },
        ]}
      />
      <SearchBox value={q} onChange={setQ} placeholder={tx(p("Father, child or phone", "पिता, बच्चा या फ़ोन"))} />
      {list.length === 0 ? (
        <Card><EmptyState icon="users" title={tab === "suggested" ? tx(p("No families to check", "जाँचने को कोई परिवार नहीं")) : tx(p("No linked families", "कोई जुड़ा परिवार नहीं"))} /></Card>
      ) : (
        <div className="pp-cols" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))" }}>
          {list.slice(0, 60).map((f) => (
            <Card key={"groupId" in f ? f.groupId : f.key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar text={f.father} size={36} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <strong className="clip">{f.father}</strong>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{f.phone ? maskPhone(f.phone) : "—"}</span>
                </span>
                <Pill tone={tab === "suggested" ? "warn" : "ok"}>{f.kids.length}</Pill>
              </div>
              {f.kids.map((k) => (
                <div key={k.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                  <span style={{ flex: 1, minWidth: 0 }} className="clip">{k.name} <span style={{ color: "var(--mut)" }}>· {k.classLabel}</span></span>
                  {"groupId" in f ? (
                    <Btn variant="ghost" ariaLabel={tx(p(`Take ${k.name} out`, `${k.name} को अलग करें`))} onClick={() => setSplitting({ fam: f as LinkedFamilyView, kid: k })}>{tx(p("Split", "अलग"))}</Btn>
                  ) : null}
                </div>
              ))}
              {tab === "suggested" ? <Btn variant="sec" icon="link" onClick={() => openMerge(f as SuggestedFamilyView)}>{tx(p("Check and link", "जाँचें और जोड़ें"))}</Btn> : null}
            </Card>
          ))}
        </div>
      )}

      <Sheet
        open={merging !== null}
        onClose={() => setMerging(null)}
        icon="link"
        title={tx(p("Link as one family?", "एक परिवार के रूप में जोड़ें?"))}
        sub={merging ? `${merging.father}${merging.phone ? ` · ${maskPhone(merging.phone)}` : ""}` : undefined}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setMerging(null)}>{tx(p("Not one family", "एक परिवार नहीं"))}</Btn>
            <Btn variant="pri" icon="link" disabled={busy || picked.size < 2} onClick={merge}>{tx(p(`Link ${picked.size} children`, `${picked.size} बच्चे जोड़ें`))}</Btn>
          </>
        }
      >
        <p style={{ margin: "0 0 8px", color: "var(--mut)" }}>{tx(p("Untick a child who is not from this family.", "जो बच्चा इस परिवार का नहीं, उसका निशान हटाएँ।"))}</p>
        {merging?.kids.map((k) => (
          <label key={k.id} className="tap" style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44 }}>
            <input
              type="checkbox"
              checked={picked.has(k.id)}
              style={{ width: 20, height: 20 }}
              onChange={(e) =>
                setPicked((s) => {
                  const n = new Set(s);
                  if (e.target.checked) n.add(k.id);
                  else n.delete(k.id);
                  return n;
                })
              }
            />
            <span>{k.name} <span style={{ color: "var(--mut)" }}>· {k.classLabel}</span></span>
          </label>
        ))}
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
