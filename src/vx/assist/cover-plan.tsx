"use client";

import type { CoverPlanPayload } from "@/modules/assist/domain/drafts";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";

const TIP = p("Tip", "सुझाव");

export function CoverPlanBody({ plan }: { plan: CoverPlanPayload }) {
  const { tx } = useVx();
  return (
    <>
      {plan.title ? <b>{plan.title}</b> : null}
      <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
        {plan.steps.map((s, i) => (
          <li key={i}>
            <span className="num" style={{ fontWeight: 700 }}>{s.minutes} min</span> · {s.text}
          </li>
        ))}
      </ol>
      {plan.tip ? (
        <span style={{ fontSize: "0.93em", color: "var(--mut)" }}>
          <b>{tx(TIP)}:</b> {plan.tip}
        </span>
      ) : null}
    </>
  );
}

export function coverPlanText(plan: CoverPlanPayload, tipWord: string): string {
  return [plan.title, ...plan.steps.map((s, i) => `${i + 1}. ${s.minutes} min · ${s.text}`), plan.tip ? `${tipWord}: ${plan.tip}` : ""].filter(Boolean).join("\n");
}
