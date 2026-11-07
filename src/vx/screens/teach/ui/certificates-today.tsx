import Link from "@/ui/link";
import { listCertificateRequests } from "@/modules/certificates/data/requests";
import { requestStage, type CertificateRequestRow, type RequestKind, type RequestStage } from "@/modules/certificates/domain/request-view";
import type { Language } from "@/platform/i18n/language";
import { dateLabelP } from "@/vx/format";
import { Ic, type IconName } from "@/vx/icons";
import { lead, under, type Pair } from "@/vx/text";
import { Pill } from "@/vx/ui/primitives";
import { getViewer } from "@/vx/view-as";
import { KIND_LABELS } from "@/vx/screens/school-office/text";
import { R, STAGE } from "@/vx/screens/school-office/request-text";

/*
 * Today's card of the certificates a teacher asked for (D-542). It is drawn
 * on the server and streams in after the rest of Today, so it adds no
 * JavaScript to the screen every teacher opens first and a slow read never
 * holds that screen up. Each row opens the child's page, where the signed
 * copy is downloaded or sent to the parent. Nothing at all until she has
 * asked for one, and never while an admin previews another role.
 */

const KIND_ICONS: Record<RequestKind, IconName> = { study: "book", character: "award", dob: "cake" };
const TILE: Record<RequestStage, { background: string; color: string }> = {
  waiting: { background: "var(--warns)", color: "var(--warnfg)" },
  ready: { background: "var(--oks)", color: "var(--ok)" },
  declined: { background: "var(--bads)", color: "var(--bad)" },
  gone: { background: "var(--s2)", color: "var(--mut)" },
};
const SHOWN = 5;
// What she can act on first: a signed copy to send, then what is still with the office.
const RANK: Record<RequestStage, number> = { ready: 0, waiting: 1, declined: 2, gone: 3 };

export async function MyCertificateRequestsToday({ sessionLabel, language }: { sessionLabel: string; language: Language }) {
  const { previewing } = await getViewer();
  if (previewing) return null;
  let rows: CertificateRequestRow[];
  try {
    rows = await listCertificateRequests("mine", sessionLabel);
  } catch {
    return null;
  }
  if (!rows.length) return null;
  const say = (pair: Pair) => lead(pair, language);
  const listed = rows.map((row) => ({ row, stage: requestStage(row) })).sort((a, b) => RANK[a.stage] - RANK[b.stage]);
  const ready = listed.filter((item) => item.stage === "ready").length;
  const second = under(R.mine, language);

  return (
    <section className="card tc-card" aria-label={say(R.mine)} style={{ order: ready ? 2 : 3 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="tc-ib" aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 12, ...(ready ? TILE.ready : { background: "var(--accs)", color: "var(--accfg)" }) }}><Ic n="award" size={20} /></span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span className="tc-p" style={{ fontWeight: 700 }}>{say(R.mine)}</span>
          {second ? <span className="tc-s" lang="hi">{second}</span> : null}
        </span>
        {ready ? <Pill tone="ok">{ready} · {say(STAGE.ready.label)}</Pill> : null}
      </div>
      {listed.slice(0, SHOWN).map(({ row, stage }, index) => {
        const status = stage === "waiting" ? `${say(STAGE.waiting.label)} · ${say(R.asked)} ${say(dateLabelP(row.requestedAt))}`
          : stage === "ready" ? say(R.openReady)
          : stage === "declined" ? [say(STAGE.declined.label), row.declineReason].filter(Boolean).join(": ")
          : say(STAGE.gone.label);
        return (
          <Link key={row.id} href={`/teach/class?student=${row.studentId}`} className="tap tc-sj" style={{ minHeight: 64, gap: 12, animation: `xIn .32s var(--ease) ${index * 45}ms both` }}>
            <span aria-hidden="true" style={{ flex: "none", width: 40, height: 40, borderRadius: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", ...TILE[stage] }}>
              <Ic n={stage === "ready" ? "checkCircle" : KIND_ICONS[row.kind]} size={19} />
            </span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <strong style={{ fontSize: 15, overflowWrap: "anywhere" }}>{row.studentName}</strong>
              <span className="tc-s">{say(KIND_LABELS[row.kind])} · {row.classLabel}</span>
              {/* Baseline, not centre: when the status wraps, the waiting dot stays on its first line. */}
              <span style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 13, fontWeight: stage === "ready" ? 700 : 500, color: stage === "ready" ? "var(--ok)" : stage === "declined" ? "var(--bad)" : "var(--mut)", overflowWrap: "anywhere" }}>
                {stage === "waiting" ? <span aria-hidden="true" style={{ flex: "none", width: 7, height: 7, borderRadius: "50%", background: "currentColor", animation: "xPulse 1.6s ease infinite" }} /> : null}
                {status}
              </span>
            </span>
            <Ic n="chevRight" />
          </Link>
        );
      })}
      {rows.length > SHOWN ? <span className="tc-s">{say(R.moreOnChildPage(rows.length - SHOWN))}</span> : null}
    </section>
  );
}
