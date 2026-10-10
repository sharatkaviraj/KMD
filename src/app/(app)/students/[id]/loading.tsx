import { Section, VxPage } from "@/vx/ui/page";
import { Skel } from "@/vx/ui/primitives";

/**
 * Student 360's own skeleton, in the card's shape: avatar ring, name, the
 * action row, the tab chips and three tiles. Every row on the students list
 * prefetches this boundary as it scrolls into view, so a tap shows it at
 * once, already where the child's name will land, instead of the generic list
 * skeleton the whole app falls back to.
 */
export default function Loading() {
  return (
    <VxPage label="Loading · लोड हो रहा है">
      <div role="status" aria-live="polite" aria-busy="true">
        <span className="sr">Loading · लोड हो रहा है</span>
        <div className="glass vx-top" style={{ height: 64, display: "flex", alignItems: "center", padding: "0 28px", borderBottom: "1px solid var(--bd)" }}>
          <Skel w={200} h={22} />
        </div>
        <Section gap={16}>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <Skel w={80} h={80} r={40} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              <Skel w="min(320px, 70%)" h={30} />
              <Skel w="min(260px, 55%)" h={14} />
              <Skel w={140} h={22} r={11} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Skel w={150} h={40} r={20} />
            <Skel w={90} h={40} r={20} />
            <Skel w={110} h={40} r={20} />
          </div>
          <div style={{ display: "flex", gap: 8, overflow: "hidden" }}>
            {[84, 64, 96, 70, 70, 90].map((w, i) => (
              <Skel key={i} w={w} h={34} r={17} />
            ))}
          </div>
          <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 12 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                <Skel w="50%" h={12} />
                <Skel w="70%" h={26} />
              </div>
            ))}
          </div>
          <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {[0, 1, 2, 3].map((i) => (
              <Skel key={i} h={18} />
            ))}
          </div>
        </Section>
      </div>
    </VxPage>
  );
}
