"use client";

import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";

import { useAssistTask } from "./client";
import { useAssistOffers } from "./context";
import { AssistButton, AssistProblemLine, AssistSuggestion } from "./parts";
import { CoverPlanBody, coverPlanText, decideReadyDraft, useReadyDrafts } from "./ready";

const SAY = {
  plan: p("Suggest what to do in this period", "इस पीरियड में क्या कराएँ — सुझाव"),
  title: p("A plan for the period", "पीरियड की योजना"),
  ready: p("Ready for you: a plan for the period", "आपके लिए तैयार: पीरियड की योजना"),
  tip: p("Tip", "सुझाव"),
};

/** "09:40" → minutes since midnight; `null` for anything else. */
function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * On a cover duty (D-324, D-418): a calm, ready activity for a class the
 * teacher did not prepare for, using only the board and notebooks. When the
 * app has already written it (`assist-prepare`, or the moment the cover was
 * saved), it is simply there; otherwise one tap asks for it. Nothing is saved;
 * it is something to read on the way to the classroom.
 */
export function CoverAssist({ coverId, classLabels, subject, starts, ends }: { coverId?: string; classLabels: string; subject: string | null; starts: string; ends: string }) {
  const { tx, language } = useVx();
  const offer = useAssistOffers("cover");
  const plan = useAssistTask("cover.plan");
  const { drafts } = useReadyDrafts();
  if (!offer) return null;

  const prepared = coverId ? drafts.find((d) => d.kind === "cover_plan" && d.ref === coverId) : undefined;
  if (prepared && prepared.kind === "cover_plan" && plan.state.kind === "idle") {
    return (
      <AssistSuggestion
        title={SAY.ready}
        privacy={false}
        readOnly
        takeaway={{ text: coverPlanText(prepared.payload, tx(SAY.tip)), title: classLabels, onTaken: () => undefined }}
        onUse={() => decideReadyDraft(prepared, "kept")}
        onDiscard={() => decideReadyDraft(prepared, "discarded")}
      >
        <CoverPlanBody plan={prepared.payload} />
      </AssistSuggestion>
    );
  }

  const from = minutesOf(starts);
  const to = minutesOf(ends);
  const minutes = from !== null && to !== null && to > from ? Math.min(120, Math.max(10, to - from)) : 40;
  const run = () => void plan.run({ classLabel: classLabels.slice(0, 80), subject: subject ? subject.slice(0, 80) : null, minutes, language });
  const ready = plan.state.kind === "ready" ? plan.state.value : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!ready ? <AssistButton label={SAY.plan} onClick={run} busy={plan.state.kind === "working"} style={{ alignSelf: "flex-start" }} /> : null}
      {plan.state.kind === "problem" ? <AssistProblemLine problem={plan.state.problem} onClose={plan.reset} /> : null}
      {ready ? (
        <AssistSuggestion
          title={SAY.title}
          busy={plan.state.kind === "working"}
          privacy={false}
          readOnly
          takeaway={{ text: coverPlanText(ready, tx(SAY.tip)), title: classLabels, onTaken: plan.keep }}
          onUse={() => plan.decide("kept")}
          onAgain={run}
          onDiscard={() => plan.decide("discarded")}
        >
          <CoverPlanBody plan={ready} />
        </AssistSuggestion>
      ) : null}
    </div>
  );
}
