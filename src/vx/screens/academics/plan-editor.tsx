"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";

import { savePlanAction } from "@/app/(app)/academics/coordinator-actions";

import { useAct } from "./client";

type Step = { key: string; id: string | null; text: string; ownerId: string; due: string; done: boolean };

let seq = 0;
const key = () => `s${++seq}`;

/**
 * The support plan (AcadProgress `plan`), as the design draws it: a ring of
 * steps done, the goal, each step with a tick, who and when, the suggested
 * steps to add with a tap, and the message for the parents. Saved as a draft
 * or started; read-only without `academics:manage`. The parents' message is
 * sent by a person from their own WhatsApp (wa.me), never by the app.
 */
export function PlanEditor({
  studentId,
  studentName,
  classLabel,
  backHref,
  staff,
  initial,
  suggestions,
  editable,
  father,
  parentPhone,
}: {
  studentId: string;
  studentName: string;
  classLabel: string;
  backHref: string;
  staff: { id: string; name: string }[];
  initial: { goal: string; status: string | null; steps: { id: string; text: string; ownerId: string | null; due: string | null; done: boolean }[] };
  suggestions: string[];
  editable: boolean;
  father: string | null;
  parentPhone: string | null;
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
  const first = studentName.split(" ")[0];
  const done = steps.filter((s) => s.done).length;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
  const L = Math.max(0.5, (263.9 * pct) / 100);
  const todo = steps.filter((s) => !s.done && s.text.trim());
  const hi = `नमस्ते,\n${first} (${classLabel}) की पढ़ाई में मदद के लिए स्कूल ने एक योजना बनाई है:\n${todo.map((s) => `• ${s.text}${s.due ? ` (${s.due})` : ""}`).join("\n")}`;
  const en = `Hello, the school has made a plan to help ${first} (${classLabel}): ${todo.map((s) => `${s.text}${s.due ? ` (${s.due})` : ""}`).join("; ")}.${goal.trim() ? ` Goal: ${goal.trim()}.` : ""}`;
  const digits = (parentPhone ?? "").replace(/\D/g, "").slice(-10);
  const wa = digits.length === 10 && todo.length ? `https://wa.me/91${digits}?text=${encodeURIComponent(`${hi}\n\n${en}`)}` : null;
  const ownerName = (id: string) => staff.find((p) => p.id === id)?.name ?? tx({ en: "Who?", hi: "कौन?" });

  return (
    <div className="pad acad-plan" style={{ padding: "20px 28px 0", display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{`.acad-plan .acad-bot{position:sticky;bottom:0;margin:16px -28px 0;padding:12px 28px}@container vx (max-width:899px){.acad-plan .acad-bot{bottom:var(--vx-bottom-h, calc(76px + env(safe-area-inset-bottom)));margin:16px -16px 0;padding:10px 16px 12px}.acad-plan .acad-bot .btn{height:52px;flex:1}}.acad-plan .acad-chip{height:30px;padding:0 10px;font-size:12px}.acad-plan .acad-chip select,.acad-plan .acad-chip input{border:0;background:transparent;color:inherit;font:inherit;font-weight:600;outline:none;padding:0;max-width:150px;-webkit-appearance:none;appearance:none;cursor:pointer;field-sizing:content}.acad-plan .acad-step{field-sizing:content;resize:none;overflow:hidden}`}</style>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <section className="card" style={{ padding: "16px 18px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
            <span style={{ position: "relative", flex: "none", width: 84, height: 84 }}>
              <svg width={84} height={84} viewBox="0 0 100 100" aria-hidden="true">
                <circle cx={50} cy={50} r={42} fill="none" stroke="var(--s3)" strokeWidth={10} />
                <circle cx={50} cy={50} r={42} fill="none" stroke="var(--ok)" strokeWidth={10} strokeLinecap="round" strokeDasharray={`${L.toFixed(1)} 263.9`} style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%", transition: "stroke-dasharray .5s var(--ease)" }} />
              </svg>
              <span style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <span className="num" style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{pct}%</span>
                <span style={{ fontSize: 11, color: "var(--mut)" }}>{tx({ en: "done", hi: "पूरा" })}</span>
              </span>
            </span>
            <span style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <span className="serif" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.15 }}>{tx({ en: `Support plan · ${first}`, hi: `सहायता योजना · ${first}` })}</span>
                <span className="pill" style={{ background: active ? "var(--oks)" : "var(--warns)", color: active ? "var(--ok)" : "var(--warnfg)" }}>{active ? tx({ en: "Running", hi: "चल रही" }) : tx({ en: "Draft", hi: "कच्ची योजना" })}</span>
              </span>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(active ? { en: `${classLabel} · running`, hi: `${classLabel} · चल रही` } : { en: `${classLabel} · draft · suggested by the app from marks and notes`, hi: `${classLabel} · कच्ची योजना · अंकों और नोट से ऐप का सुझाव` })}</span>
              <span className="num" style={{ fontSize: 13, fontWeight: 600 }}>{tx({ en: `${done} of ${steps.length} steps done`, hi: `${steps.length} में से ${done} कदम पूरे` })}</span>
            </span>
          </section>

          <label className="field">
            <span>{tx({ en: "Goal for this plan", hi: "इस योजना का लक्ष्य" })}</span>
            <input className="inp" type="text" maxLength={300} value={goal} disabled={!editable} onChange={(e) => setGoal(e.target.value)} placeholder={tx({ en: "For example: Maths above 40% in Unit Test 2", hi: "जैसे: यूनिट टेस्ट 2 में गणित 40% से ऊपर" })} />
          </label>

          <section className="card" style={{ padding: "6px 16px", display: "flex", flexDirection: "column" }}>
            {steps.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center", padding: "26px 10px" }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{tx({ en: "No steps yet", hi: "अभी कोई कदम नहीं" })}</span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx({ en: "Tap a suggested step below to add it.", hi: "नीचे सुझाए कदम पर टैप करके जोड़ें।" })}</span>
              </div>
            ) : null}
            {steps.map((s, i) => (
              <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: i ? "1px solid var(--bd)" : undefined, animation: "xIn .3s var(--ease) both" }}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={s.done}
                  aria-label={tx(s.done ? { en: `Mark as not done: ${s.text}`, hi: `अधूरा करें: ${s.text}` } : { en: `Mark as done: ${s.text}`, hi: `पूरा करें: ${s.text}` })}
                  disabled={!editable}
                  className="tap"
                  onClick={() => update(s.key, { done: !s.done })}
                  style={{ flex: "none", width: 30, height: 30, borderRadius: 9, padding: 0, border: `2px solid ${s.done ? "var(--ok)" : "var(--bds)"}`, background: s.done ? "var(--ok)" : "transparent", color: "var(--onsolid)", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  {s.done ? (
                    <svg viewBox="0 0 24 24" style={{ width: 18, height: 18 }} aria-hidden="true">
                      <path d="M5 12.5l4.5 4.5L19 7.5" style={{ fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round", ["--len" as string]: 22, strokeDasharray: 22, animation: "xDraw .35s var(--ease) both" }} />
                    </svg>
                  ) : null}
                </button>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  <textarea
                    className="acad-step"
                    rows={1}
                    value={s.text}
                    maxLength={160}
                    disabled={!editable}
                    onChange={(e) => update(s.key, { text: e.target.value })}
                    placeholder={tx({ en: "What will happen", hi: "क्या होगा" })}
                    aria-label={tx({ en: `Step ${i + 1}`, hi: `कदम ${i + 1}` })}
                    style={{ border: 0, background: "transparent", color: "var(--fg)", font: "inherit", fontWeight: 600, lineHeight: 1.45, padding: 0, outline: "none", textDecoration: s.done ? "line-through" : "none", opacity: s.done ? 0.6 : 1, width: "100%" }}
                  />
                  <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <label className="tap chip acad-chip" title={tx({ en: "Who does it", hi: "कौन करेगा" })}>
                      <Ic n="user" size={14} />
                      <select value={s.ownerId} disabled={!editable} onChange={(e) => update(s.key, { ownerId: e.target.value })} aria-label={tx({ en: `Who does it · now ${ownerName(s.ownerId)}`, hi: `कौन करेगा · अभी ${ownerName(s.ownerId)}` })}>
                        <option value="">{tx({ en: "Who?", hi: "कौन?" })}</option>
                        {staff.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="tap chip acad-chip" title={tx({ en: "When", hi: "कब" })}>
                      <Ic n="calendar" size={14} />
                      <input value={s.due} maxLength={40} disabled={!editable} onChange={(e) => update(s.key, { due: e.target.value })} placeholder={tx({ en: "When?", hi: "कब?" })} aria-label={tx({ en: "When", hi: "कब" })} />
                    </label>
                  </span>
                </span>
                {editable ? (
                  <button type="button" className="tap btn ghost" aria-label={tx({ en: `Remove ${s.text}`, hi: `${s.text} हटाएँ` })} onClick={() => setSteps((all) => all.filter((x) => x.key !== s.key))} style={{ width: 40, padding: 0, color: "var(--mut)", flex: "none" }}>
                    <Ic n="x" size={18} />
                  </button>
                ) : null}
              </div>
            ))}
          </section>

          {editable ? (
            <section className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
              <span className="sech">{tx({ en: "Suggested steps · tap to add", hi: "सुझाए कदम · जोड़ने को टैप करें" })}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {suggestions.map((text) => {
                  const has = steps.some((s) => s.text.trim() === text);
                  return (
                    <button key={text} type="button" className={`tap chip${has ? " on" : ""}`} aria-pressed={has} onClick={() => (has ? undefined : setSteps((all) => [...all, { key: key(), id: null, text, ownerId: staff[0]?.id ?? "", due: "", done: false }]))}>
                      <Ic n={has ? "check" : "plus"} size={14} />
                      {text}
                    </button>
                  );
                })}
                <button type="button" className="tap chip" onClick={() => setSteps((all) => [...all, { key: key(), id: null, text: "", ownerId: staff[0]?.id ?? "", due: "", done: false }])} disabled={steps.length >= 12}>
                  <Ic n="plus" size={14} />
                  {tx({ en: "My own step", hi: "अपना कदम" })}
                </button>
              </div>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx({ en: "Tap the name or date on a step to change who does it and when.", hi: "कौन और कब बदलने को कदम पर नाम या तारीख़ टैप करें।" })}</span>
            </section>
          ) : (
            <p style={{ margin: 0, color: "var(--mut)", fontSize: 14 }}>{tx({ en: "Only coordinators and the office can change a support plan.", hi: "सहायता योजना संयोजक और कार्यालय ही बदल सकते हैं।" })}</p>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <section className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{tx({ en: "Tell parents", hi: "अभिभावकों को बताएँ" })}</span>
            <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--mut)" }}>
              {tx(father ? { en: `${father} (father) gets this on WhatsApp from your phone — you press Send.`, hi: `${father} (पिता) को यह आपके फ़ोन से WhatsApp पर जाएगा — भेजें आप दबाएँ।` } : { en: "The parents get this on WhatsApp from your phone — you press Send.", hi: "अभिभावकों को यह आपके फ़ोन से WhatsApp पर जाएगा — भेजें आप दबाएँ।" })}
            </span>
            <div style={{ padding: 10, borderRadius: 14, background: "var(--wabg)" }}>
              <div style={{ alignSelf: "flex-start", maxWidth: "94%", padding: "9px 12px 5px", borderRadius: "4px 14px 14px 14px", background: "var(--wab)", color: "var(--wafg)", lineHeight: 1.5, fontSize: 13, boxShadow: "0 1px 1px rgba(0,0,0,.08)" }}>
                <div style={{ whiteSpace: "pre-line" }}>{hi}</div>
                <div style={{ whiteSpace: "pre-line", marginTop: 6, opacity: 0.78 }}>{en}</div>
              </div>
            </div>
            {wa ? (
              <a className="tap btn sec" href={wa} target="_blank" rel="noreferrer">
                <Ic n="send" size={18} />
                {tx({ en: "Tell parents", hi: "अभिभावकों को बताएँ" })}
              </a>
            ) : (
              <span className="tap btn sec" aria-disabled="true" style={{ opacity: 0.5 }}>
                <Ic n="send" size={18} />
                {tx(digits.length === 10 ? { en: "Add a step first", hi: "पहले कदम जोड़ें" } : { en: "No parent phone on file", hi: "अभिभावक का फ़ोन नहीं" })}
              </span>
            )}
          </section>
        </div>
      </div>

      <div className="glass acad-bot" style={{ zIndex: 4, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, borderTop: "1px solid var(--bd)" }}>
        <span className="hide-m" style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--mut)" }}>
          <Ic n="checkCircle" size={16} style={{ color: initial.status ? "var(--ok)" : "var(--mut)" }} />
          {tx(active ? { en: "Running · changes are saved when you press Save", hi: "चल रही · सहेजें दबाने पर बदलाव सहेजे जाते हैं" } : initial.status ? { en: "Saved as draft", hi: "सहेजी गई, अभी शुरू नहीं" } : { en: "Not saved yet", hi: "अभी सहेजा नहीं" })}
        </span>
        {editable ? (
          <>
            {!active ? (
              <button type="button" className="tap btn sec" disabled={pending} onClick={() => save(false)}>
                <Ic n="file" size={18} />
                {tx({ en: "Save draft", hi: "बिना शुरू किए सहेजें" })}
              </button>
            ) : null}
            <button type="button" className="tap btn pri" disabled={pending || !goal.trim() || steps.every((s) => !s.text.trim())} onClick={() => save(true)}>
              {pending ? <Ic n="refresh" size={16} className="spin" /> : <Ic n="check" size={18} />}
              {active ? tx({ en: "Save plan", hi: "योजना सहेजें" }) : tx({ en: "Save and start plan", hi: "सहेजें और शुरू करें" })}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
