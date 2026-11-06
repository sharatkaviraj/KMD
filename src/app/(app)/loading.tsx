import { Ic } from "@/vx/icons";
import { VxPage, Section } from "@/vx/ui/page";
import { Skel } from "@/vx/ui/primitives";

/**
 * P11 state `loading` (design `Auth` · loading): shown while any signed-in
 * screen resolves.
 *
 * Grey blocks in the design's shape — a title, four number cards, two lists —
 * under a line that says it is loading. The words are in both languages
 * because the staff profile has not been read yet.
 */
export default function Loading() {
  const rows = ["62%", "48%", "70%", "55%"];
  return (
    <VxPage label="Loading · लोड हो रहा है">
      <div role="status" aria-live="polite" aria-busy="true">
        <div className="glass vx-top only-d" style={{ height: 64, display: "flex", alignItems: "center", padding: "0 28px", borderBottom: "1px solid var(--bd)" }}>
          <Skel w={180} h={22} />
        </div>
        <Section>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 14, background: "var(--s2)", fontSize: 13, color: "var(--mut)" }}>
            <Ic n="refresh" size={18} className="spin" />
            <span>Loading… · लोड हो रहा है…</span>
          </div>
          {/* After 8 s, say why (UX review 6 Nov 2026): grey blocks alone looked like a broken app. CSS-only, so this stays a server file. */}
          <span className="vx-slow-note" style={{ fontSize: 14, color: "var(--mut)" }}>
            Still loading. The internet or the server is slow; please wait. · अभी लोड हो रहा है। इंटरनेट या सर्वर धीमा है, थोड़ा रुकें।
          </span>
          <Skel w={300} h={28} style={{ maxWidth: "80%" }} />
          <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12 }}>
            {[0, 1, 2, 3].map((k) => (
              <div key={k} className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                <Skel w="55%" h={11} />
                <Skel w="75%" h={22} />
                <Skel w="45%" h={10} />
              </div>
            ))}
          </div>
          <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 16 }}>
            {[0, 1].map((c) => (
              <div key={c} className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                <Skel w="40%" h={14} />
                {rows.map((w, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Skel w={36} h={36} r={18} style={{ flex: "none" }} />
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
                      <Skel w={w} h={12} />
                      <Skel w="40%" h={10} />
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </VxPage>
  );
}
