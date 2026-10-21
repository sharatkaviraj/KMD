import Link from "next/link";
import { m } from "@/messages";
import { ms, photoMessages } from "@/messages/setup";
import { dayLabel } from "@/platform/dates";
import type { Language } from "@/platform/i18n/language";
import { lead, p, under } from "@/vx/text";
import { Card, CardHead, ListRow, Pill } from "@/vx/ui/primitives";
import { Ic } from "@/vx/icons";
import type { TaskState, TaskSummary } from "../domain/tasks";
import { AssignmentLauncher } from "./assignment-sheet";

/*
 * Needs you's teacher work, drawn as one more card in the queue's own kit. The
 * queue above it is what needs the office now; this is the work it has handed
 * out, so it sits below and never above the page's title. Approvals first,
 * because they are the part waiting on the reader.
 */

const ORDER: TaskState[] = ["to-approve", "waiting", "to-assign", "complete"];
const LABEL = { "to-assign": ms.taskToAssign, waiting: m.taskWaiting, "to-approve": m.taskApprove, complete: m.taskComplete, revoked: ms.taskRevoke } as const;
const TONE = { "to-approve": "warn", waiting: "info", "to-assign": "mut", complete: "ok", revoked: "mut" } as const;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// A teacher reads their own list: their work first, then what the office is checking.
const TEACHER_ORDER: TaskState[] = ["waiting", "to-approve", "complete"];
// The teacher's own words for her list (smoke 20 Oct: "Waiting on teachers" read as if it
// were about other people, and "To approve" as if she had to approve something).
const TEACHER_LABEL = {
  waiting: p("To do", "करना है"),
  "to-approve": p("Sent · the office is checking", "भेज दिया · ऑफ़िस देख रहा है"),
  complete: p("Done", "पूरा"),
  "to-assign": p("To do", "करना है"),
  revoked: p("Withdrawn by the office", "ऑफ़िस ने वापस लिया"),
} as const;

export function TeacherWork({ rows, language, compact, reviewPhotos = false, office = true }: { rows: TaskSummary[] | null; language: Language; compact: boolean; reviewPhotos?: boolean; office?: boolean }) {
  const say = (pair: { hi: string; en: string }) => lead(pair, language);
  // Work words and the school's own date, not a bare "2026-10-19" or "6 · SCI" (B13).
  const titleOf = (t: TaskSummary) =>
    t.kind === "attendance" && ISO_DAY.test(t.title) ? `${say(m.taskAttendance)} · ${say(dayLabel(t.title))}` : t.kind === "marks" ? `${say(m.taskMarks)} · ${t.title}` : t.title;
  const dueOf = (due: string | null) => (due && ISO_DAY.test(due) ? `${say(ms.taskDue)} ${say(dayLabel(due))}` : due);
  const groups = (office ? ORDER : TEACHER_ORDER).map(state => ({ state, items: (rows ?? []).filter(r => r.state === state) })).filter(g => g.items.length > 0);
  const labelOf = (state: TaskState) => (office ? say(LABEL[state]) : lead(TEACHER_LABEL[state], language));
  const subOf = (state: TaskState) => (office ? null : under(TEACHER_LABEL[state], language));
  const counts = groups.filter(g => g.state !== "complete").map(g => `${labelOf(g.state)} ${g.items.length}`).join(" · ");
  const hidden = compact && groups.some(g => g.items.length > 3);
  // Without a heading the first group's rule would sit on the card's own edge.
  const rule = (i: number) => (office || i > 0 ? "1px solid var(--bd)" : 0);
  const quiet = { margin: 0, padding: office ? "0 16px 14px" : "14px 16px", fontSize: 14 } as const;
  return (
    <Card pad={false} as="section" aria-label={say(office ? ms.teacherWork : m.teacherTasks)} style={{ overflow: "hidden" }}>
      {office ? (
        <div style={{ padding: "14px 16px 12px" }}>
          {/* The desk carries Assign work in its top bar; the phone has no bar, so it lives here. */}
          <CardHead title={say(ms.teacherWork)} sub={counts || undefined} action={<span className="only-m"><AssignmentLauncher language={language} /></span>} />
        </div>
      ) : null}
      {rows === null ? (
        <p role="alert" style={{ ...quiet, color: "var(--bad)" }}>{say(ms.taskUnavailable)}</p>
      ) : groups.length === 0 ? (
        <p style={{ ...quiet, color: "var(--mut)" }}>{office ? say(ms.teacherWorkNone) : lead(p("Nothing from the office right now. Work the office sends you shows here.", "अभी ऑफ़िस से कोई काम नहीं। ऑफ़िस जो काम भेजेगा, वह यहाँ दिखेगा।"), language)}</p>
      ) : (
        groups.map(({ state, items }, i) => (
          <div key={state}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px 6px", borderTop: rule(i) }}>
              <Pill tone={TONE[state]}>{labelOf(state)}</Pill>
              {subOf(state) ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{subOf(state)}</span> : null}
              <span className="num" style={{ fontSize: 13, color: "var(--mut)" }}>{items.length}</span>
              {office && state === "to-approve" ? (
                <Link href="/collection/review" className="tap" style={{ marginLeft: "auto", fontSize: 13, fontWeight: 600, color: "var(--acc)" }}>{say(m.taskApprove)}</Link>
              ) : null}
            </div>
            {(compact ? items.slice(0, 3) : items).map(t => (
              <ListRow
                key={t.id}
                href={t.href}
                title={titleOf(t)}
                sub={[office ? t.teacherName : null, t.expected > 0 ? `${t.answered}/${t.expected}` : null, dueOf(t.dueDate)].filter(Boolean).join(" · ")}
                trail={t.rejected ? <Pill tone="bad">{`${say(ms.taskRejected)} ${t.rejected}`}</Pill> : <Ic n="chevRight" size={18} />}
                style={{ minHeight: 52, padding: "8px 16px" }}
              />
            ))}
          </div>
        ))
      )}
      {hidden ? (
        <Link href="/inbox?tasks=all" className="tap" style={{ display: "block", padding: "12px 16px", borderTop: "1px solid var(--bd)", fontSize: 14, fontWeight: 600, color: "var(--acc)" }}>{say(m.taskViewAll)}</Link>
      ) : null}
      {reviewPhotos ? (
        <div className="only-m">
          <ListRow href="/collection/review" lead={<Ic n="camera" size={18} />} title={say(photoMessages.review)} trail={<Ic n="chevRight" size={18} />} />
        </div>
      ) : null}
    </Card>
  );
}
