"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { endSmokeRunAction, openSmokeRunAction, revokeSmokePassAction, setSmokeFindingStatusAction } from "@/app/(app)/smoke/actions";
import type { PoolSeat, RunSummary } from "@/modules/smoke/data/smoke-repo";
import type { FindingRow } from "@/modules/smoke/domain/smoke";
import { FINDING_STATUSES } from "@/modules/smoke/domain/smoke";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card, CardHead, EmptyState, Pill } from "@/vx/ui/primitives";
import { useToast } from "@/vx/ui/overlays";

type Issued = { runId: string; title: string; schoolDay: string | null; clockStart: string | null; passes: { email: string; label: string; role: string; persona: string | null; token: string }[] };

const STATE_TONE = { live: "ok", expired: "mut", revoked: "bad", run_closed: "mut" } as const;
const STATE_LABEL = {
  live: p("live", "चालू"),
  expired: p("expired", "समय समाप्त"),
  revoked: p("revoked", "रद्द"),
  run_closed: p("run closed", "रन बंद"),
} as const;
const SEV_TONE: Record<string, "bad" | "warn" | "mut"> = { P1: "bad", P2: "warn", P3: "mut" };

/**
 * The Smoke Lab console (design: the admin desk's cards, no new chrome).
 * Open a run → each chosen seat gets a pass shown once → hand the agent kit to
 * the agents → watch passes being used and findings arriving → triage.
 */
export function SmokeLab({ pool, runs, selectedRunId, findings, today, rules }: { pool: PoolSeat[]; runs: RunSummary[]; selectedRunId: string | null; findings: FindingRow[]; today: string; rules: string[] }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const free = pool.filter((s) => !s.livePassRun);
  const [title, setTitle] = useState(`School day ${today}`);
  const [scenario, setScenario] = useState<"school_day" | "free_explore">("school_day");
  const [schoolDay, setSchoolDay] = useState(today);
  const [clockStart, setClockStart] = useState("07:30");
  const [hours, setHours] = useState(8);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(free.map((s) => s.email)));
  const [personas, setPersonas] = useState<Record<string, string>>({});
  const [issued, setIssued] = useState<Issued | null>(null);
  const [statusFilter, setStatusFilter] = useState("open");
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const selected = runs.find((r) => r.id === selectedRunId) ?? null;
  const shown = useMemo(() => findings.filter((f) => (statusFilter === "open" ? ["new", "confirmed", "regressed"].includes(f.status) : statusFilter === "all" ? true : f.status === statusFilter)), [findings, statusFilter]);

  const open = () =>
    start(async () => {
      const seats = [...chosen].map((email) => ({ email, persona: personas[email]?.trim() || null }));
      const res = await openSmokeRunAction({ title, scenario, schoolDay: schoolDay || null, clockStart: clockStart || null, hours, seats });
      if (!res.ok) {
        toast.show({ text: `${tx(p("Could not open the run", "रन नहीं खुल सका"))}: ${res.error}`, tone: "bad" });
        return;
      }
      setIssued({ runId: res.run.runId, title, schoolDay: schoolDay || null, clockStart: clockStart || null, passes: res.run.passes });
      router.refresh();
    });

  const kit = (run: Issued) =>
    JSON.stringify(
      {
        origin,
        runId: run.runId,
        title: run.title,
        schoolDay: run.schoolDay,
        clockStart: run.clockStart,
        rules,
        guide: "docs/smoke/README.md",
        agents: run.passes.map((pass) => ({ label: pass.label, role: pass.role, email: pass.email, persona: pass.persona, pass: pass.token, enter: `${origin}/lab/enter?pass=${pass.token}`, brief: `${origin}/api/lab/brief`, header: `Authorization: Bearer ${pass.token}` })),
      },
      null,
      2,
    );

  const download = (run: Issued) => {
    const url = URL.createObjectURL(new Blob([kit(run)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `smoke-kit-${run.runId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ text: tx(p("Copied", "कॉपी हुआ")) });
    } catch {
      toast.show({ text: tx(p("Could not copy", "कॉपी नहीं हुआ")), tone: "bad" });
    }
  };

  const act = (fn: () => Promise<{ ok: boolean }>, done: string) =>
    start(async () => {
      const res = await fn();
      toast.show(res.ok ? { text: done } : { text: tx(p("Not saved – retry", "सहेजा नहीं – फिर कोशिश करें")), tone: "bad" });
      router.refresh();
    });

  return (
    <VxPage label="Smoke Lab">
      <TopBar crumb={tx(p("Administration · Test database", "प्रशासन · टेस्ट डेटाबेस"))} title={tx(p("Smoke Lab", "स्मोक लैब"))} />
      <div className="pad" style={{ padding: "16px 28px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
        <Card>
          <CardHead title={tx(p("How it works", "यह कैसे काम करता है"))} sub={tx(p("Test database only. Passes expire within 24 hours and can be revoked at once.", "सिर्फ़ टेस्ट डेटाबेस। पास 24 घंटे में खत्म होते हैं और तुरंत रद्द हो सकते हैं।"))} />
          <ol style={{ margin: "8px 0 0", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
            <li>{tx(p("Open a run and choose which test accounts take part.", "एक रन खोलें और टेस्ट अकाउंट चुनें।"))}</li>
            <li>{tx(p("Each account gets a pass, shown once: download the agent kit and give each agent its pass.", "हर अकाउंट को एक पास मिलता है, सिर्फ़ एक बार दिखेगा: एजेंट किट डाउनलोड करें।"))}</li>
            <li>{tx(p("Agents sign in with /lab/enter, read their brief, run the school day and file findings.", "एजेंट /lab/enter से साइन इन करते हैं, ब्रीफ़ पढ़ते हैं और फाइंडिंग दर्ज करते हैं।"))}</li>
            <li>{tx(p("Triage findings here; export a run as Markdown for the fixes. Close the run when done.", "यहाँ फाइंडिंग जाँचें; Markdown निकालें। काम पूरा होने पर रन बंद करें।"))}</li>
          </ol>
          <details style={{ marginTop: 8, fontSize: 13 }}>
            <summary>{tx(p("Rules every agent follows", "हर एजेंट के नियम"))}</summary>
            <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>{rules.map((r) => <li key={r}>{r}</li>)}</ul>
          </details>
        </Card>

        {issued ? (
          <Card style={{ borderColor: "var(--warnm)" }}>
            <CardHead title={tx(p(`Passes for “${issued.title}”`, `“${issued.title}” के पास`))} sub={tx(p("Shown only now. Copy or download them before leaving this page.", "सिर्फ़ अभी दिख रहे हैं। पेज छोड़ने से पहले कॉपी या डाउनलोड करें।"))} action={<Btn variant="pri" icon="download" onClick={() => download(issued)}>{tx(p("Download agent kit", "एजेंट किट डाउनलोड"))}</Btn>} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {issued.passes.map((pass) => (
                <div key={pass.email} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--bd)" }}>
                  <span style={{ flex: "1 1 200px", minWidth: 0 }}>
                    <strong>{pass.label}</strong>
                    <span style={{ display: "block", fontSize: 12, color: "var(--mut)", overflowWrap: "anywhere" }}>{pass.persona ?? pass.role}</span>
                  </span>
                  <Btn variant="sec" icon="copy" onClick={() => void copy(`${origin}/lab/enter?pass=${pass.token}`)}>{tx(p("Copy sign-in link", "साइन-इन लिंक कॉपी"))}</Btn>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <Btn variant="ghost" onClick={() => setIssued(null)}>{tx(p("I have saved them", "मैंने सहेज लिए"))}</Btn>
            </div>
          </Card>
        ) : null}

        <Card>
          <CardHead title={tx(p("Open a run", "रन खोलें"))} sub={tx(p(`${free.length} of ${pool.length} test accounts are free`, `${pool.length} में से ${free.length} टेस्ट अकाउंट खाली हैं`))} />
          {pool.length === 0 ? (
            <EmptyState icon="users" title={tx(p("No test accounts yet", "अभी कोई टेस्ट अकाउंट नहीं"))} body={tx(p("Run npm run smoke:pool on a computer with the project, then reload.", "प्रोजेक्ट वाले कंप्यूटर पर npm run smoke:pool चलाएँ, फिर रीलोड करें।"))} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                <label className="field"><span>{tx(p("Title", "शीर्षक"))}</span><input className="inp" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
                <label className="field">
                  <span>{tx(p("Scenario", "परिदृश्य"))}</span>
                  <select className="inp" value={scenario} onChange={(e) => setScenario(e.target.value as "school_day" | "free_explore")}>
                    <option value="school_day">{tx(p("A whole school day", "पूरा स्कूल दिन"))}</option>
                    <option value="free_explore">{tx(p("Free exploration", "खुली खोज"))}</option>
                  </select>
                </label>
                <label className="field"><span>{tx(p("School day", "स्कूल का दिन"))}</span><input className="inp" type="date" value={schoolDay} onChange={(e) => setSchoolDay(e.target.value)} /></label>
                <label className="field"><span>{tx(p("Clock starts at", "घड़ी शुरू"))}</span><input className="inp" type="time" value={clockStart} onChange={(e) => setClockStart(e.target.value)} /></label>
                <label className="field"><span>{tx(p("Hours (1–24)", "घंटे (1–24)"))}</span><input className="inp" type="number" min={1} max={24} value={hours} onChange={(e) => setHours(Number(e.target.value))} /></label>
              </div>
              <div role="group" aria-label={tx(p("Test accounts", "टेस्ट अकाउंट"))} style={{ display: "flex", flexDirection: "column" }}>
                {pool.map((s) => {
                  const busy = Boolean(s.livePassRun);
                  return (
                    <div key={s.email} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--bd)", opacity: busy ? 0.55 : 1 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 220px", minWidth: 0 }}>
                        <input type="checkbox" checked={chosen.has(s.email)} disabled={busy} onChange={(e) => setChosen((cur) => { const next = new Set(cur); if (e.target.checked) next.add(s.email); else next.delete(s.email); return next; })} />
                        <span style={{ minWidth: 0 }}>
                          <strong>{s.label}</strong>
                          <span style={{ display: "block", fontSize: 12, color: "var(--mut)", overflowWrap: "anywhere" }}>{s.email}{s.linkedExisting ? ` · ${tx(p("real class and timetable", "असली कक्षा और समय-सारणी"))}` : ""}</span>
                        </span>
                      </label>
                      {busy ? <Pill tone="warn">{tx(p("In another run", "दूसरे रन में"))}</Pill> : (
                        <label style={{ flex: "1 1 200px" }}>
                          <span className="sr">{tx(p("Persona for this agent", "इस एजेंट की भूमिका"))}</span>
                          <input className="inp" placeholder={tx(p("Persona, e.g. new teacher, slow phone", "भूमिका, जैसे नई शिक्षिका"))} value={personas[s.email] ?? ""} maxLength={120} onChange={(e) => setPersonas((cur) => ({ ...cur, [s.email]: e.target.value }))} />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
              <div>
                <Btn variant="pri" icon="send" disabled={pending || chosen.size === 0 || title.trim().length < 3} onClick={open}>{tx(p(`Open run with ${chosen.size} account(s)`, `${chosen.size} अकाउंट के साथ रन खोलें`))}</Btn>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <CardHead title={tx(p("Runs", "रन"))} />
          {runs.length === 0 ? <EmptyState icon="inbox" title={tx(p("No runs yet", "अभी कोई रन नहीं"))} /> : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {runs.map((r) => (
                <div key={r.id} style={{ padding: "10px 0", borderTop: "1px solid var(--bd)", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                    <Link href={`/smoke?run=${r.id}`} style={{ fontWeight: 700, color: r.id === selectedRunId ? "var(--acc)" : "inherit" }}>{r.title}</Link>
                    <Pill tone={r.status === "open" ? "ok" : "mut"}>{r.status}</Pill>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{r.schoolDay ?? ""} {r.clockStart ?? ""} · {tx(p(`expires ${new Date(r.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`, `समाप्ति ${new Date(r.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`))}</span>
                    <span style={{ fontSize: 12 }}>{tx(p(`${r.findings.open} open finding(s), ${r.findings.p1} P1`, `${r.findings.open} खुली फाइंडिंग, ${r.findings.p1} P1`))}</span>
                    {r.status === "open" ? (
                      <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                        <Btn variant="sec" disabled={pending} onClick={() => act(() => endSmokeRunAction(r.id, "closed"), tx(p("Run closed", "रन बंद")))}>{tx(p("Close run", "रन बंद करें"))}</Btn>
                        <Btn variant="danger" disabled={pending} onClick={() => act(() => endSmokeRunAction(r.id, "revoked"), tx(p("Run revoked", "रन रद्द")))}>{tx(p("Revoke now", "अभी रद्द करें"))}</Btn>
                      </span>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {r.passes.map((pass) => (
                      <span key={pass.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "4px 8px", border: "1px solid var(--bd)", borderRadius: 10 }}>
                        <Pill tone={STATE_TONE[pass.state]}>{tx(STATE_LABEL[pass.state])}</Pill>
                        {pass.label} · {tx(p(`${pass.uses} use(s)`, `${pass.uses} बार`))}
                        {pass.state === "live" ? <button type="button" className="tap" aria-label={tx(p(`Revoke ${pass.label}`, `${pass.label} का पास रद्द करें`))} disabled={pending} onClick={() => act(() => revokeSmokePassAction(pass.id), tx(p("Pass revoked", "पास रद्द")))} style={{ border: 0, background: "transparent", color: "var(--bad)", cursor: "pointer" }}>×</button> : null}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {selected ? (
          <Card>
            <CardHead
              title={tx(p(`Findings · ${selected.title}`, `फाइंडिंग · ${selected.title}`))}
              sub={tx(p(`${findings.length} filed`, `${findings.length} दर्ज`))}
              action={<Btn variant="sec" icon="download" href={`/smoke/runs/${selected.id}/export`} target="_blank">{tx(p("Export Markdown", "Markdown निकालें"))}</Btn>}
            />
            <label className="field" style={{ maxWidth: 240, marginTop: 8 }}>
              <span>{tx(p("Show", "दिखाएँ"))}</span>
              <select className="inp" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="open">{tx(p("Open (new, confirmed, regressed)", "खुली"))}</option>
                <option value="all">{tx(p("All", "सभी"))}</option>
                {FINDING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            {shown.length === 0 ? <EmptyState icon="ticks" title={tx(p("Nothing here", "यहाँ कुछ नहीं"))} /> : (
              <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
                {shown.map((f) => (
                  <details key={f.id} style={{ padding: "10px 0", borderTop: "1px solid var(--bd)" }}>
                    <summary style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <Pill tone={SEV_TONE[f.severity] ?? "mut"}>{f.severity}</Pill>
                      <span style={{ fontWeight: 600, flex: "1 1 240px", minWidth: 0, overflowWrap: "anywhere" }}>{f.title}</span>
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>{f.kind} · {f.role ?? "—"}{f.repeats > 1 ? ` · ×${f.repeats}` : ""} · {f.status}</span>
                    </summary>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 0 0", fontSize: 13 }}>
                      {f.screen ? <span><strong>{tx(p("Screen", "स्क्रीन"))}:</strong> <code>{f.screen}</code></span> : null}
                      {f.reporter ? <span><strong>{tx(p("Reported by", "किसने"))}:</strong> {f.reporter}</span> : null}
                      {f.steps ? <span style={{ whiteSpace: "pre-wrap" }}><strong>{tx(p("Steps", "कदम"))}:</strong> {f.steps}</span> : null}
                      {f.expected ? <span><strong>{tx(p("Expected", "अपेक्षित"))}:</strong> {f.expected}</span> : null}
                      {f.actual ? <span><strong>{tx(p("Actual", "वास्तविक"))}:</strong> {f.actual}</span> : null}
                      {f.evidence ? <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><strong>{tx(p("Evidence", "सबूत"))}:</strong> {f.evidence}</span> : null}
                      <label className="field" style={{ maxWidth: 240 }}>
                        <span>{tx(p("Status", "स्थिति"))}</span>
                        <select className="inp" value={f.status} disabled={pending} onChange={(e) => act(() => setSmokeFindingStatusAction(f.id, e.target.value, null), tx(p("Status saved", "स्थिति सहेजी")))}>
                          {FINDING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </Card>
        ) : null}
      </div>
    </VxPage>
  );
}
