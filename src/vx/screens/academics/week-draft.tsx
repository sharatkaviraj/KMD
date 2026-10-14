"use client";

import { useState } from "react";

import { sendWeeklySummaryAction } from "@/app/(app)/academics/coordinator-actions";
import { COST_PER_MESSAGE } from "@/modules/whatsapp/vx/domain/reminders";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { Sheet } from "@/vx/ui/overlays";

import { useAct, WaBubble } from "./client";
import { attentionChips, fillTemplate, weeklySummaryLines, type AttentionFacts, type WeekFacts } from "./domain";
import { nameInitials } from "./ui";

/*
 * AcadHome `week`: the weekly summary for the principal, as the design draws
 * it — the draft (short or detailed, a line of her own, names on or off),
 * who improved and who needs help, the attendance trend and the marks, and a
 * bar to save it as a PDF or send it. What the screen shows is what is sent.
 */

type Row = { id: string; name: string; sub: string };

export function WeekDraft({
  facts,
  me,
  principals,
  range,
  trend,
  days,
  improved,
  help,
  marks,
  lastSent,
  template,
  canSend,
}: {
  facts: WeekFacts;
  me: string;
  principals: string[];
  range: string;
  trend: { label: string; pct: number | null }[];
  days: { label: string; pct: number | null }[];
  improved: Row[];
  help: (Row & { chip: AttentionFacts })[];
  marks: { name: string; pct: number; due: string | null; locked: number; done: number; inProgress: number; notStarted: number };
  lastSent: string | null;
  template: { hi: string; en: string } | null;
  canSend: boolean;
}) {
  const { tx } = useVx();
  const { run, pending } = useAct();
  const [long, setLong] = useState(false);
  const [extra, setExtra] = useState("");
  const [names, setNames] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const lines = weeklySummaryLines(facts, { long, extra });
  const to = principals.length ? principals.join(", ") : tx({ en: "the principal", hi: "प्रधानाचार्य" });
  const masked = (r: Row) => (names ? r.name : tx({ en: `A child · ${r.sub.split(" · ")[0]}`, hi: `एक बच्चा · ${r.sub.split(" · ")[0]}` }));

  // On a phone the bar sits on the shell's bottom navigation (76px + 22px padding + 1px rule).
  /* the trend line: eight weekly averages, oldest first */
  const values = trend.map((t) => t.pct).filter((v): v is number => v !== null);
  const lo = values.length ? Math.floor(Math.min(...values) - 1) : 85;
  const hi = values.length ? Math.ceil(Math.max(...values) + 0.5) : 100;
  const px = (i: number) => 8 + i * (284 / Math.max(1, trend.length - 1));
  const py = (v: number) => 84 - ((v - lo) / Math.max(0.5, hi - lo)) * 76;
  const pts = trend.flatMap((t, i) => (t.pct === null ? [] : [[px(i), py(t.pct)] as const]));
  let len = 0;
  for (let i = 1; i < pts.length; i += 1) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const now = facts.attendancePct;
  const delta = now !== null && facts.attendanceBefore !== null ? Math.round((now - facts.attendanceBefore) * 10) / 10 : null;
  let month = "";
  const labels = trend.map((t) => {
    const [d, m] = t.label.split(" ");
    const out = m !== month ? t.label : d;
    month = m;
    return out;
  });

  const total = marks.locked + marks.done + marks.inProgress + marks.notStarted;
  const parts = [
    { key: "locked", label: tx({ en: "Locked", hi: "लॉक" }), n: marks.locked, c: "var(--c1)" },
    { key: "done", label: tx({ en: "Done", hi: "पूरे" }), n: marks.done, c: "var(--c2)" },
    { key: "progress", label: tx({ en: "In progress", hi: "चल रहे" }), n: marks.inProgress, c: "var(--c3)" },
    { key: "none", label: tx({ en: "Not started", hi: "शुरू नहीं" }), n: marks.notStarted, c: "var(--bad)" },
  ];

  const summaryLine = lines.map((l) => l.en).join(" ");
  const preview = template && principals[0] ? { hi: fillTemplate(template.hi, [principals[0], summaryLine, me]), en: fillTemplate(template.en, [principals[0], summaryLine, me]) } : { hi: lines.map((l) => l.hi ?? l.en).join("\n"), en: summaryLine };
  const n = Math.max(1, principals.length);
  const send = () => run(() => sendWeeklySummaryAction({ long, extra }), (r) => r.ok && setConfirm(false));

  return (
    <div className="pad acad-week" style={{ padding: "20px 28px 0", display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{`.acad-week .acad-bot{position:sticky;bottom:0;margin:16px -28px 0;padding:12px 28px}@container vx (max-width:899px){.acad-week .acad-bot{bottom:var(--vx-bottom-h, calc(76px + env(safe-area-inset-bottom)));margin:16px -16px 0;padding:10px 16px 12px}.acad-week .acad-bot .btn{height:52px;width:100%}}@media print{.acad-week .acad-bot{display:none}}`}</style>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <article className="card" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1, minWidth: 210, display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx({ en: `To ${to} (Admin) · from ${me}`, hi: `${to} (एडमिन) को · ${me} की ओर से` })}</span>
                <span className="serif" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.15 }}>{tx({ en: `This week · ${range}`, hi: `यह सप्ताह · ${range}` })}</span>
              </span>
              <div className="seg" role="group" aria-label={tx({ en: "Length", hi: "लंबाई" })} style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))", width: 200 }}>
                <span className="thumb" aria-hidden="true" style={{ width: "calc((100% - 6px) / 2)", transform: `translateX(${long ? 100 : 0}%)` }} />
                <button type="button" className={long ? "tap" : "tap on"} aria-pressed={!long} onClick={() => setLong(false)}>{tx({ en: "Short", hi: "छोटा" })}</button>
                <button type="button" className={long ? "tap on" : "tap"} aria-pressed={long} onClick={() => setLong(true)}>{tx({ en: "Detailed", hi: "विस्तृत" })}</button>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 15, lineHeight: 1.65 }}>
              {lines.map((line, i) => (
                <p key={`${long}-${i}`} style={{ margin: 0, animation: `xIn .35s var(--ease) ${i * 70}ms both` }}>{tx(line)}</p>
              ))}
            </div>
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--mut)" }}>
              <Ic n="zap" size={15} style={{ color: "var(--acc)" }} />
              {tx({ en: "Written by the app from this week’s attendance, marks and notes", hi: "इस सप्ताह की हाज़िरी, अंकों और नोट से ऐप ने लिखा" })}
            </span>
            <label className="field">
              <span>{tx({ en: "Add a line from you (optional)", hi: "अपनी ओर से एक पंक्ति (वैकल्पिक)" })}</span>
              <textarea className="inp" value={extra} maxLength={300} onChange={(e) => setExtra(e.target.value)} placeholder={tx({ en: "For example: Please speak to Class 9 parents at the PTM", hi: "जैसे: PTM में कक्षा 9 के अभिभावकों से बात करें" })} style={{ minHeight: 70, height: "auto", padding: "12px 14px" }} />
            </label>
            <button type="button" role="switch" aria-checked={names} onClick={() => setNames((v) => !v)} className="tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0", border: 0, background: "transparent", color: "var(--fg)", textAlign: "left" }}>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontWeight: 600 }}>{tx({ en: "Show children’s names", hi: "बच्चों के नाम दिखाएँ" })}</span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx({ en: "Turn off before sharing with a wider group", hi: "बड़े समूह में साझा करने से पहले बंद करें" })}</span>
              </span>
              <span className={`sw${names ? " on" : ""}`}>
                <span />
              </span>
            </button>
          </article>
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 16, alignItems: "start" }}>
            <PeopleCard title={tx({ en: "Improved this week", hi: "इस सप्ताह सुधार" })} tone="ok" empty={tx({ en: "Nobody marked improving this week.", hi: "इस सप्ताह किसी को सुधार में दर्ज नहीं किया।" })} rows={improved.map((r) => ({ id: r.id, name: masked(r), ini: names ? nameInitials(r.name) : "•", sub: r.sub }))} />
            <PeopleCard
              title={tx({ en: "Need help", hi: "मदद चाहिए" })}
              tone="bad"
              empty={tx({ en: "Nobody on the list.", hi: "सूची खाली है।" })}
              rows={help.map((r) => {
                const chip = attentionChips(r.chip)[0];
                return { id: r.id, name: masked(r), ini: names ? nameInitials(r.name) : "•", sub: chip ? `${r.sub} · ${tx(chip.text)}` : r.sub };
              })}
            />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <section className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{tx({ en: "Attendance trend", hi: "हाज़िरी का रुझान" })}</span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx({ en: `Weekly average · last ${trend.length} weeks`, hi: `साप्ताहिक औसत · पिछले ${trend.length} सप्ताह` })}</span>
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <span className="num" style={{ fontSize: 24, fontWeight: 700 }}>{now === null ? "—" : `${now}%`}</span>
                {delta !== null ? (
                  <span className="pill" style={{ background: delta >= 0 ? "var(--oks)" : "var(--bads)", color: delta >= 0 ? "var(--ok)" : "var(--bad)" }}>
                    {tx({ en: `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)} vs last week`, hi: `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)} पिछले सप्ताह से` })}
                  </span>
                ) : null}
              </span>
            </div>
            <svg viewBox="0 0 300 96" style={{ width: "100%", height: "auto", overflow: "visible" }} role="img" aria-label={tx({ en: "Weekly attendance, last eight weeks", hi: "पिछले आठ सप्ताह की हाज़िरी" })}>
              <line x1={0} x2={300} y1={84} y2={84} style={{ stroke: "var(--bd)", strokeDasharray: "4 4" }} />
              {pts.length > 1 ? (
                <>
                  <polygon points={`${pts[0][0].toFixed(1)},96 ${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} ${pts[pts.length - 1][0].toFixed(1)},96`} style={{ fill: "rgba(var(--heat),.12)", animation: "xFade .8s .4s ease both" }} />
                  <polyline points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} style={{ fill: "none", stroke: "var(--acc)", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round", ["--len" as string]: len.toFixed(1), strokeDasharray: len.toFixed(1), animation: "xDraw 1.1s var(--ease) both" }} />
                </>
              ) : null}
              {pts.map(([x, y], i) => {
                const lastDot = i === pts.length - 1;
                return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r={lastDot ? 5 : 3} style={{ fill: lastDot ? "var(--acc)" : "var(--card)", stroke: "var(--acc)", strokeWidth: 2, transformBox: "fill-box", transformOrigin: "center", animation: `xPopIn .4s var(--spring) ${300 + i * 90}ms both` }} />;
              })}
            </svg>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--mut)" }}>
              {labels.map((l, i) => (
                <span key={i}>{l}</span>
              ))}
            </div>
            <span className="sech" style={{ paddingTop: 10, borderTop: "1px solid var(--bd)" }}>{tx({ en: "This week by day", hi: "इस सप्ताह हर दिन" })}</span>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(4, days.length)},minmax(0,1fr))`, gap: 10 }}>
              {days.map((d, i) => {
                const h = d.pct === null ? 0 : Math.max(4, Math.min(100, Math.round(((d.pct - 85) / 15) * 100)));
                return (
                  <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>{d.pct === null ? "—" : `${Math.round(d.pct * 10) / 10}%`}</span>
                    <span style={{ display: "flex", alignItems: "flex-end", width: "100%", maxWidth: 48, height: 56, background: "var(--s2)", borderRadius: 8, overflow: "hidden" }}>
                      <span style={{ width: "100%", height: `${h}%`, background: i === days.length - 1 ? "var(--acc)" : "var(--c2)", transformOrigin: "bottom", animation: `xGrowY .7s var(--ease) ${i * 80}ms both` }} />
                    </span>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{d.label}</span>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{tx({ en: `${marks.name} marks`, hi: `${marks.name} अंक` })}</span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx({ en: `${total} class-subjects${marks.due ? ` · deadline ${marks.due}` : ""}`, hi: `${total} कक्षा-विषय${marks.due ? ` · अंतिम तिथि ${marks.due}` : ""}` })}</span>
              </span>
              <span className="num" style={{ fontSize: 24, fontWeight: 700 }}>{marks.pct}%</span>
            </div>
            <div style={{ height: 12, borderRadius: 4, background: "var(--s3)", overflow: "hidden", display: "flex" }}>
              {parts.map((p) => (
                <span key={p.key} style={{ width: `${total ? (p.n / total) * 100 : 0}%`, height: "100%", background: p.c, transformOrigin: "left", animation: "xGrowX .7s var(--ease) both" }} />
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: "var(--mut)" }}>
              {parts.map((p) => (
                <span key={p.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: p.c }} />
                  {p.label}{" "}
                  <b className="num" style={{ color: "var(--fg)" }}>{p.n}</b>
                </span>
              ))}
            </div>
          </section>
        </div>
      </div>
      <div className="glass acad-bot" style={{ zIndex: 4, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, borderTop: "1px solid var(--bd)" }}>
        <span className="hide-m" style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--mut)" }}>{tx({ en: `Goes to ${to}${lastSent ? ` · last sent ${lastSent}` : ""}`, hi: `${to} को जाएगा${lastSent ? ` · पिछली बार ${lastSent}` : ""}` })}</span>
        <button type="button" className="tap btn sec" onClick={() => window.print()}>
          <Ic n="download" size={18} />
          {tx({ en: "Share as PDF", hi: "PDF के रूप में" })}
        </button>
        {canSend ? (
          <button type="button" className="tap btn pri" onClick={() => setConfirm(true)} disabled={principals.length === 0}>
            <Ic n="send" size={18} />
            {tx({ en: "Send to admin on WhatsApp", hi: "एडमिन को WhatsApp पर भेजें" })}
          </button>
        ) : null}
      </div>
      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title={tx({ en: "Send the summary to the admin?", hi: "सारांश एडमिन को भेजें?" })}
        sub={`${to} · ${tx({ en: "Admin", hi: "एडमिन" })}`}
        footer={
          <>
            <button type="button" className="tap btn sec" style={{ flex: 1 }} onClick={() => setConfirm(false)}>{tx({ en: "Cancel", hi: "रद्द करें" })}</button>
            <button type="button" className="tap btn pri" style={{ flex: 1.6 }} disabled={pending} onClick={send}>
              <Ic n="send" size={18} />
              {tx({ en: "Send on WhatsApp", hi: "WhatsApp पर भेजें" })}
            </button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <WaBubble to={principals[0] ?? to} many={n > 1} preview={preview} />
          <div className="card" style={{ padding: "0 14px", boxShadow: "none", display: "flex", flexDirection: "column" }}>
            {[
              [tx({ en: "To", hi: "किसे" }), tx({ en: `${n} ${n === 1 ? "person" : "people"} · Admin`, hi: `${n} व्यक्ति · एडमिन` })],
              [tx({ en: "Cost", hi: "खर्च" }), `₹${(n * COST_PER_MESSAGE).toFixed(2)} · ${n} × ₹${COST_PER_MESSAGE.toFixed(2)}`],
              [tx({ en: "Sent through", hi: "कैसे" }), "AiSensy · WhatsApp"],
            ].map(([k, v], i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", fontSize: 13, borderTop: i ? "1px solid var(--bd)" : undefined }}>
                <span style={{ color: "var(--mut)" }}>{k}</span>
                <span className="num" style={{ fontWeight: 700, textAlign: "right" }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, padding: "12px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, background: "var(--infos)", color: "var(--info)" }}>
            <Ic n="info" size={18} style={{ flex: "none", marginTop: 1 }} />
            <span>{tx({ en: "The message carries the same lines as the draft. You can undo for a few seconds.", hi: "संदेश में वही पंक्तियाँ जाती हैं जो मसौदे में हैं। कुछ सेकंड तक वापस ले सकते हैं।" })}</span>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function PeopleCard({ title, tone, rows, empty }: { title: string; tone: "ok" | "bad"; rows: { id: string; name: string; ini: string; sub: string }[]; empty: string }) {
  const bg = tone === "ok" ? "var(--oks)" : "var(--bads)";
  const fg = tone === "ok" ? "var(--ok)" : "var(--bad)";
  return (
    <section className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column" }}>
      <span style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, color: fg }}>{title}</span>
      {rows.length === 0 ? <span style={{ fontSize: 13, color: "var(--mut)", padding: "9px 0" }}>{empty}</span> : null}
      {rows.map((r, i) => (
        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: i ? "1px solid var(--bd)" : undefined, animation: `xIn .3s var(--ease) ${i * 40}ms both` }}>
          <span aria-hidden="true" style={{ flex: "none", width: 32, height: 32, borderRadius: 16, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{r.ini}</span>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span className="clip" style={{ fontWeight: 600 }}>{r.name}</span>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{r.sub}</span>
          </span>
        </div>
      ))}
    </section>
  );
}
