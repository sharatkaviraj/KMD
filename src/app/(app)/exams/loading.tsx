import { Ic } from "@/vx/icons";
import { Section, VxPage } from "@/vx/ui/page";
import { Skel } from "@/vx/ui/primitives";

/**
 * Exams & marks while the tracker, report cards or preview resolve: the
 * board's own shape — a title, the exam card, a class × subject grid of a
 * fixed size — so the page does not jump when it arrives, and a bounded
 * number of blocks however many classes the school has. The words are in
 * both languages, as the app-wide loading screen's are, because the staff
 * profile has not been read yet.
 */
export default function ExamsLoading() {
  const cols = [0, 1, 2, 3, 4, 5];
  const rows = [0, 1, 2, 3, 4, 5];
  return (
    <VxPage label="Loading · लोड हो रहा है">
      <div role="status" aria-live="polite" aria-busy="true">
        <div className="glass vx-top only-d" style={{ height: 64, display: "flex", alignItems: "center", padding: "0 28px", borderBottom: "1px solid var(--bd)" }}>
          <Skel w={220} h={22} />
        </div>
        <Section>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 14, background: "var(--s2)", fontSize: 13, color: "var(--mut)" }}>
            <Ic n="refresh" size={18} className="spin" />
            <span>Loading marks… · अंक लोड हो रहे हैं…</span>
          </div>
          <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 16 }}>
            <Skel w={64} h={64} r={32} style={{ flex: "none" }} />
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <Skel w="45%" h={18} />
              <Skel w="30%" h={11} />
            </span>
          </div>
          <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, overflow: "hidden" }}>
            {rows.map((r) => (
              <div key={r} style={{ display: "grid", gridTemplateColumns: `88px repeat(${cols.length}, minmax(0,1fr))`, gap: 8, alignItems: "center" }}>
                <Skel w="80%" h={12} />
                {cols.map((c) => (
                  <Skel key={c} h={28} r={8} />
                ))}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </VxPage>
  );
}
