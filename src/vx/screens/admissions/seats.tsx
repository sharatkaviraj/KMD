"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { saveSeatsAction } from "@/app/(app)/admissions/actions";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { Input } from "@/vx/ui/controls";
import { useToast } from "@/vx/ui/overlays";
import { Banner, Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card } from "@/vx/ui/primitives";

export type SeatClass = { id: string; label: string; onRoll: number; seats: number | null };

/** One number per class. Blank means no limit is shown on Admissions. */
export function SeatsScreen({ sessionLabel, classes }: { sessionLabel: string; classes: SeatClass[] }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(classes.map((c) => [c.id, c.seats === null ? "" : String(c.seats)])));

  const original = (c: SeatClass) => (c.seats === null ? "" : String(c.seats));
  const changed = classes.filter((c) => draft[c.id].trim() !== original(c));
  const bad = changed.filter((c) => {
    const v = draft[c.id].trim();
    return v !== "" && !(/^\d{1,3}$/.test(v) && Number(v) <= 500);
  });
  const totalSeats = classes.reduce((n, c) => n + (draft[c.id].trim() && /^\d+$/.test(draft[c.id].trim()) ? Number(draft[c.id]) : 0), 0);
  const totalLeft = classes.reduce((n, c) => {
    const v = draft[c.id].trim();
    return v && /^\d+$/.test(v) ? n + Math.max(0, Number(v) - c.onRoll) : n;
  }, 0);

  const save = () =>
    start(async () => {
      const result = await saveSeatsAction({ seats: changed.map((c) => ({ classId: c.id, seats: draft[c.id].trim() === "" ? null : Number(draft[c.id]) })) });
      toast.show({ text: result.ok ? tx(p(`Saved seats for ${result.saved} ${result.saved === 1 ? "class" : "classes"}`, `${result.saved} कक्षाओं की सीटें सहेजी गईं`)) : result.error, tone: result.ok ? "ok" : "bad" });
      if (result.ok) router.refresh();
    });

  return (
    <VxPage>
      <TopBar
        crumb={`${tx(p("Admissions", "दाख़िले"))} · ${tx(p("Session", "सत्र"))} ${sessionLabel}`}
        title={tx(p("Seats per class", "हर कक्षा की सीटें"))}
        mSub={`${tx(p("Session", "सत्र"))} ${sessionLabel}`}
        mBack="/admissions"
        actions={<Btn variant="ghost" icon="chevLeft" href="/admissions">{tx(p("Back to admissions", "दाख़िलों पर वापस"))}</Btn>}
      />
      <main>
        <Section>
          <Banner tone="info">
            {tx(p("How many children each class can take this session. Admissions shows the seats left from these. Leave a class blank for no limit.", "इस सत्र में हर कक्षा में कितने बच्चे आ सकते हैं। दाख़िले में खाली सीटें इसी से दिखती हैं। कोई सीमा न हो तो खाली छोड़ें।"))}
          </Banner>
          <Card pad={false} style={{ overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 80px 110px 80px", gap: 8, padding: "10px 16px", fontSize: 12, fontWeight: 700, color: "var(--mut)", borderBottom: "1px solid var(--bd)" }}>
              <span>{tx(p("Class", "कक्षा"))}</span>
              <span style={{ textAlign: "right" }}>{tx(p("On roll", "नामांकित"))}</span>
              <span style={{ textAlign: "right" }}>{tx(p("Seats", "सीटें"))}</span>
              <span style={{ textAlign: "right" }}>{tx(p("Left", "खाली"))}</span>
            </div>
            {classes.map((c) => {
              const v = draft[c.id].trim();
              const n = /^\d+$/.test(v) ? Number(v) : null;
              const left = n === null ? null : n - c.onRoll;
              const isBad = bad.includes(c);
              return (
                <div key={c.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 80px 110px 80px", gap: 8, alignItems: "center", padding: "8px 16px", borderTop: "1px solid var(--bd)" }}>
                  <span style={{ fontWeight: 600 }}>{c.label}</span>
                  <span className="num" style={{ textAlign: "right" }}>{c.onRoll}</span>
                  <Input
                    inputMode="numeric"
                    aria-label={`${c.label} ${tx(p("seats", "सीटें"))}`}
                    value={draft[c.id]}
                    placeholder="—"
                    onChange={(e) => setDraft((d) => ({ ...d, [c.id]: e.target.value.replace(/[^\d]/g, "").slice(0, 3) }))}
                    style={{ textAlign: "right", height: 36, borderColor: isBad ? "var(--bad)" : v !== original(c) ? "var(--acc)" : undefined }}
                  />
                  <span className="num" style={{ textAlign: "right", color: left !== null && left < 0 ? "var(--bad)" : left === 0 ? "var(--warnfg)" : undefined }}>{left === null ? "—" : left}</span>
                </div>
              );
            })}
          </Card>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ flex: 1, color: "var(--mut)", fontSize: 13 }}>
              {tx(p(`${totalSeats} seats · ${totalLeft} left`, `${totalSeats} सीटें · ${totalLeft} खाली`))}
              {bad.length ? ` · ${tx(p("Seats must be 0 to 500.", "सीटें 0 से 500 तक हों।"))}` : ""}
            </span>
            <Btn variant="pri" icon="check" disabled={pending || changed.length === 0 || bad.length > 0} onClick={save}>
              {changed.length ? tx(p(`Save ${changed.length} ${changed.length === 1 ? "change" : "changes"}`, `${changed.length} बदलाव सहेजें`)) : tx(p("No changes", "कोई बदलाव नहीं"))}
            </Btn>
          </div>
        </Section>
      </main>
    </VxPage>
  );
}
