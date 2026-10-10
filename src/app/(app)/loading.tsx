import { VxPage, Section } from "@/vx/ui/page";
import { PageSkeleton, Skel } from "@/vx/ui/primitives";

/**
 * P11 state `loading`: shown while any signed-in screen resolves.
 *
 * Language-free on purpose — grey blocks in the shape of a vx page (title bar,
 * KPI row, list). The one label is for a screen reader, in both languages,
 * because the staff profile has not been read yet.
 */
export default function Loading() {
  return (
    <VxPage label="Loading · लोड हो रहा है">
      <div role="status" aria-live="polite" aria-busy="true">
        <span className="sr">Loading · लोड हो रहा है</span>
        <div className="glass vx-top" style={{ height: 64, display: "flex", alignItems: "center", padding: "0 28px", borderBottom: "1px solid var(--bd)" }}>
          <Skel w={180} h={22} />
        </div>
        <Section>
          <PageSkeleton kpis={4} rows={6} />
        </Section>
      </div>
    </VxPage>
  );
}
