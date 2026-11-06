"use client";

import Link from "@/ui/link";

import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { VxPage } from "@/vx/ui/page";
import { TchTop } from "@/vx/screens/teach/ui/shared";

import type { Cell } from "./domain/entry";
import { MarksSheet } from "./marks-sheet";
import type { SaveOutcome, SavePayload } from "./save-types";
import type { SheetPaper, SheetStudent } from "./sheet-data";

/*
 * The marks sheet behind a no-login link. Same sheet; its saves go to the
 * link's own route, which resolves the token again on every request.
 */

const OFFLINE: SaveOutcome = {
  ok: false,
  reason: "failed",
  message: { en: "Not saved. Check your connection — what you typed is kept here.", hi: "सहेजा नहीं गया। इंटरनेट देखें — आपका भरा यहीं रखा है।" },
};

async function post(token: string, body: unknown): Promise<SaveOutcome> {
  try {
    const res = await fetch(`/t/marks/${encodeURIComponent(token)}/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 409) return OFFLINE;
    return (await res.json()) as SaveOutcome;
  } catch {
    return OFFLINE;
  }
}

export type LinkPaper = { paperId: string; classLabel: string; subjectCode: string; maxMarks: number; entered: number; total: number; status: "done" | "in_progress" | "not_started" | "empty" };

const V = (x: string) => `var(--${x})`;

/**
 * The marks link's first page: her papers in this exam as the Marks screen's
 * cards (design TchMarks `pick`), with no navigation past them.
 */
export function PublicPaperList({ token, school, staffName, examLabel, papers }: { token: string; school: string; staffName: string; examLabel: Pair; papers: LinkPaper[] }) {
  const { tx, sub } = useVx();
  const title = tx(p("Your marks", "आपके अंक"));
  return (
    <VxPage className="tc">
      <TchTop crumb={school} title={title} mTitle={title} mSub={`${staffName} · ${tx(examLabel)}`} />
      <main>
        <div className="tc-scr" style={{ maxWidth: 1040 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="tc-h1">{tx(examLabel)}</span>
            <span className="tc-tb" style={{ color: "var(--mut)" }}>{staffName} · {tx(p("Tap a paper. Everything saves by itself.", "पेपर दबाएँ। सब अपने आप सेव होता है।"))}</span>
            {/* Both ways stay, and they are one set of marks (owner, 6 Nov 2026). */}
            <span className="tc-ts" style={{ color: "var(--mut)" }}>{tx(p("Same marks as the school app: enter them here or in the app, whichever is easier.", "स्कूल ऐप वाले ही अंक: यहाँ भरें या ऐप में, जो आसान लगे।"))}</span>
          </div>
          {papers.length === 0 ? (
            <div className="card" style={{ padding: "36px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
              <span className="tc-av" style={{ width: 64, height: 64, background: "var(--s2)", color: "var(--mut)" }}><Ic n="clipboard" size={28} /></span>
              <span className="tc-h2">{tx(p("No papers for you in this exam", "इस परीक्षा में आपका कोई पेपर नहीं"))}</span>
            </div>
          ) : null}
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
            {papers.map((c, i) => {
              const k: [Pair, string, Pair, string, string, string] =
                c.status === "done" && c.entered < c.total
                  ? [p("View", "देखें"), "sec", p(`Sent · ${c.total - c.entered} blank`, `भेजे · ${c.total - c.entered} खाली`), V("warns"), V("warnfg"), V("warn")]
                  : c.status === "done"
                  ? [p("View", "देखें"), "sec", p("Sent ✓", "भेजे ✓"), V("oks"), V("ok"), V("ok")]
                  : c.status === "in_progress"
                    ? [p("Continue", "जारी रखें"), "pri", p("In progress", "चल रहा है"), V("accs"), V("accfg"), V("acc")]
                    : [p("Start", "शुरू करें"), "sec", p("Not started", "शुरू नहीं"), V("s3"), V("mut"), V("acc")];
              const t = p(`${c.classLabel} ${c.subjectCode}`, `${c.classLabel.replace(/^Class/, "कक्षा")} ${c.subjectCode}`);
              return (
                <div key={c.paperId} className="card tc-in" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, border: c.status === "in_progress" ? "2px solid var(--acc)" : "1px solid var(--bd)", animationDelay: `${Math.min(i, 14) * 30}ms` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className="tc-ibx" style={{ background: "var(--infos)", color: "var(--info)" }}><Ic n="clipboard" size={22} /></span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mut)" }}>{tx(examLabel)} · {tx(p(`out of ${c.maxMarks}`, `${c.maxMarks} में से`))}</span>
                      <span className="tc-h2">{tx(t)}</span>
                      {sub(t) ? <span className="tc-mi">{sub(t)}</span> : null}
                    </span>
                    <span className="pill" style={{ background: k[3], color: k[4] }}>{tx(k[2])}</span>
                  </div>
                  <div className="tc-mbar"><span style={{ width: `${c.total ? Math.round((c.entered / c.total) * 100) : 0}%`, background: k[5] }} /></div>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                    <span className="tc-tb num" style={{ flex: 1, minWidth: 140, fontWeight: 600 }}>{tx(p(`${c.entered} of ${c.total} entered`, `${c.total} में से ${c.entered} भरे`))}</span>
                    <Link href={`/t/marks/${token}?paper=${c.paperId}`} className={`tap btn ${k[1]} tc-mbg tc-mw`}>{tx(k[0])}<Ic n="arrowRight" /></Link>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="tc-note" style={{ background: "var(--infos)", color: "var(--info)" }}>
            <Ic n="info" style={{ marginTop: 2 }} />
            <span>{tx(p("This link is only for you. It opens straight to your marks sheet — no password needed.", "यह लिंक सिर्फ़ आपके लिए है। यह सीधे आपकी अंक शीट खोलता है — पासवर्ड नहीं चाहिए।"))}</span>
          </div>
        </div>
      </main>
    </VxPage>
  );
}

export function PublicMarksSheet({
  ownerId,
  sessionLabel,
  token,
  paper,
  students,
  saved,
  coordinatorName,
  crumb,
  view,
}: {
  ownerId: string;
  sessionLabel: string;
  token: string;
  paper: SheetPaper;
  students: SheetStudent[];
  saved: Record<string, Cell>;
  coordinatorName: string | null;
  crumb: string;
  view: "entry" | "keypad" | "check" | "submitted";
}) {
  return (
    <MarksSheet
      key={`${ownerId}/${sessionLabel}/${paper.id}`}
      ownerId={ownerId}
      sessionLabel={sessionLabel}
      paper={paper}
      students={students}
      saved={saved}
      coordinatorName={coordinatorName}
      onSave={(payload: SavePayload) => post(token, { action: "save", payload })}
      onWithdraw={(paperId: string, revision: number) => post(token, { action: "withdraw", paperId, revision })}
      // The link's owner is the teacher: `marks-link/<link>/<staff>`, as the link page builds it.
      viewerStaffId={ownerId.split("/").at(-1) ?? null}
      initialPhase={view === "check" ? "check" : view === "submitted" ? "sent" : "entry"}
      initialMode={view === "keypad" ? "pad" : "list"}
      crumb={crumb}
      backHref={`/t/marks/${token}`}
      doneHref={`/t/marks/${token}`}
    />
  );
}
