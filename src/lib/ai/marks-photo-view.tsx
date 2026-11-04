import "server-only";

import { notFound } from "next/navigation";
import { z } from "zod";

import { builtinAiPilot } from "@/lib/ai/config";
import { marksPhotoContext } from "@/lib/ai/marks-context";
import { LazyMarksPhotoPanel } from "@/lib/ai/ui/lazy-marks-photo-panel";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { lead, p } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn } from "@/vx/ui/primitives";

export async function MarksPhotoView({ staff, paperId }: { staff: CurrentStaff; paperId?: string }) {
  if (!builtinAiPilot() || !paperId || !z.uuid().safeParse(paperId).success) notFound();
  const ctx = await marksPhotoContext(staff, paperId);
  if (!ctx) notFound();
  const title = lead(p("Marks from photo", "फ़ोटो से अंक"), staff.language);
  const back = "/teach/marks?paper=" + paperId;
  const backLink = <Btn variant="ghost" href={back}>{lead(p("Back to marks", "अंकों पर वापस"), staff.language)}</Btn>;
  return <VxPage>
    <TopBar title={title} crumb={ctx.paper.class_label + " · " + ctx.paper.subject_code} mBack={back} actions={backLink} />
    <main><Section>
      <LazyMarksPhotoPanel paperId={paperId} backHref={back} max={ctx.rule.max} step={ctx.rule.step} />
    </Section></main>
  </VxPage>;
}
