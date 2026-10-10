"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { Field, Input, Select, Textarea } from "@/vx/ui/controls";
import { Card } from "@/vx/ui/primitives";

import { savePlanAction } from "@/app/(app)/academics/coordinator-actions";

import { useAct } from "./client";

type Step = { key: string; id: string | null; text: string; ownerId: string; due: string; done: boolean };

let seq = 0;
const key = () => `s${++seq}`;

/**
 * The support plan editor (AcadProgress `plan`): a goal, steps each with an
 * owner and a when, saved as a draft or started. Read-only without
 * `academics:manage`.
 */
export function PlanEditor({
  studentId,
  studentName,
  backHref,
  staff,
  initial,
  suggestions,
  editable,
}: {
  studentId: string;
  studentName: string;
  backHref: string;
  staff: { id: string; name: string }[];
  initial: { goal: string; status: string | null; steps: { id: string; text: string; ownerId: string | null; due: string | null; done: boolean }[] };
  suggestions: string[];
  editable: boolean;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const { run, pending } = useAct();
  const [goal, setGoal] = useState(initial.goal);
  const [steps, setSteps] = useState<Step[]>(() =>
    initial.steps.length
      ? initial.steps.map((s) => ({ key: key(), id: s.id, text: s.text, ownerId: s.ownerId ?? "", due: s.due ?? "", done: s.done }))
      : suggestions.slice(0, 3).map((text) => ({ key: key(), id: null, text, ownerId: staff[0]?.id ?? "", due: "", done: false })),
  );
  const update = (k: string, patch: Partial<Step>) => setSteps((all) => all.map((s) => (s.key === k ? { ...s, ...patch } : s)));
  const save = (start: boolean) =>
    run(
      () => savePlanAction({ studentId, goal, start, steps: steps.map((s) => ({ id: s.id, text: s.text, ownerId: s.ownerId || null, due: s.due, done: s.done })) }),
      (r) => {
        if (r.ok && start) router.push(backHref);
      },
    );
  const active = initial.status === "active";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label={tx({ en: `Goal for ${studentName}`, hi: `${studentName} के लिए लक्ष्य` })} hint={tx({ en: "One sentence a parent would understand.", hi: "एक वाक्य जो अभिभावक समझ सकें।" })}>
          <Textarea rows={2} maxLength={300} value={goal} disabled={!editable} onChange={(e) => setGoal(e.target.value)} placeholder={tx({ en: "e.g. Pass Maths in Unit Test 2 and come to school every day", hi: "जैसे यूनिट टेस्ट 2 में गणित पास करना और रोज़ स्कूल आना" })} />
        </Field>
      </Card>

      <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{tx({ en: "Steps", hi: "कदम" })}</h3>
          {editable ? (
            <button type="button" className="tap btn ghost" onClick={() => setSteps((all) => [...all, { key: key(), id: null, text: "", ownerId: staff[0]?.id ?? "", due: "", done: false }])} disabled={steps.length >= 12}>
              <Ic n="plus" size={18} />
              {tx({ en: "Add step", hi: "कदम जोड़ें" })}
            </button>
          ) : null}
        </div>
        {steps.length === 0 ? <p style={{ margin: 0, color: "var(--mut)" }}>{tx({ en: "No steps yet.", hi: "अभी कोई कदम नहीं।" })}</p> : null}
        {steps.map((s, i) => (
          <div key={s.key} className="fadein" style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1fr)", gap: 10, paddingTop: i ? 12 : 0, borderTop: i ? "1px solid var(--bd)" : undefined }}>
            <span className="num" style={{ width: 26, height: 26, borderRadius: 13, background: s.done ? "var(--oks)" : "var(--s3)", color: s.done ? "var(--ok)" : "var(--fg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
              {s.done ? <Ic n="check" size={14} /> : i + 1}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <Input value={s.text} maxLength={160} disabled={!editable} onChange={(e) => update(s.key, { text: e.target.value })} placeholder={tx({ en: "What will happen", hi: "क्या होगा" })} aria-label={tx({ en: `Step ${i + 1}`, hi: `कदम ${i + 1}` })} />
              <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) auto", gap: 8 }}>
                <Select value={s.ownerId} disabled={!editable} onChange={(e) => update(s.key, { ownerId: e.target.value })} aria-label={tx({ en: "Who", hi: "कौन" })}>
                  <option value="">{tx({ en: "Who…", hi: "कौन…" })}</option>
                  {staff.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
                <Input value={s.due} maxLength={40} disabled={!editable} onChange={(e) => update(s.key, { due: e.target.value })} placeholder={tx({ en: "When (e.g. Every Tue, by 20 Oct)", hi: "कब (जैसे हर मंगल)" })} aria-label={tx({ en: "When", hi: "कब" })} />
                {editable ? (
                  <button type="button" className="tap icon-btn" aria-label={tx({ en: "Remove step", hi: "कदम हटाएँ" })} onClick={() => setSteps((all) => all.filter((x) => x.key !== s.key))}>
                    <Ic n="trash" size={18} />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </Card>

      {editable ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" className="tap btn sec" disabled={pending} onClick={() => save(false)}>
            <Ic n="file" size={18} />
            {tx({ en: "Save draft", hi: "ड्राफ़्ट सहेजें" })}
          </button>
          <button type="button" className="tap btn pri" disabled={pending || !goal.trim() || steps.every((s) => !s.text.trim())} onClick={() => save(true)}>
            {pending ? <Ic n="refresh" size={16} className="spin" /> : <Ic n="zap" size={18} />}
            {active ? tx({ en: "Save plan", hi: "योजना सहेजें" }) : tx({ en: "Start plan", hi: "योजना शुरू करें" })}
          </button>
        </div>
      ) : (
        <p style={{ margin: 0, color: "var(--mut)", fontSize: 14 }}>{tx({ en: "Only coordinators and the office can change a support plan.", hi: "सहायता योजना संयोजक और कार्यालय ही बदल सकते हैं।" })}</p>
      )}
    </div>
  );
}
