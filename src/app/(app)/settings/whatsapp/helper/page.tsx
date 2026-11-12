import Link from "@/ui/link";
import type { CSSProperties, ReactNode } from "react";

import { inrPerUsd } from "@/modules/assist/data/panel";
import { readLessonBook, type LessonBook } from "@/modules/whatsapp/data/helper-lessons";
import { readHelperWeek, type HelperWeek } from "@/modules/whatsapp/data/helper-week";
import { ANSWER_CHARS, QUESTION_CHARS, type Lesson } from "@/modules/whatsapp/domain/helper-lessons";
import { durationParts, weekBounds, type WeekChoice } from "@/modules/whatsapp/domain/helper-week";
import { agoText, durationText, hw, targetLabels, teachNote, topicLabels } from "@/messages/helper-week";
import { requirePermission } from "@/platform/auth/current-staff";
import { viewingTestSession } from "@/platform/auth/staff-scope";
import { formatInr } from "@/platform/helpers/currency";
import type { Language, Localized } from "@/platform/i18n/language";
import { Ic, type IconName } from "@/vx/icons";
import { lead, under } from "@/vx/text";
import { Grid, Section, TopBar, VxPage } from "@/vx/ui/page";
import { PendingBtn } from "@/vx/ui/pending-btn";
import { Card, CardHead, EmptyState, IconTile, Kpi, Pill } from "@/vx/ui/primitives";

import { leaveToPeopleAction, removeLessonAction, teachLessonAction } from "./actions";
import { AnswerBox } from "./answer-box";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = { title: "Veer Patta AI" };

const PAGE = "/settings/whatsapp/helper";
const NOTE_ICON: Record<string, IconName> = { ok: "checkCircle", warn: "alert", bad: "alert", info: "info" };
const list: CSSProperties = { listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column" };
const rowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "12px 0", borderTop: "1px solid var(--bd)" };
const istDate = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

function Sub({ text, language }: { text: Localized; language: Language }) {
  const second = under(text, language);
  return (
    <p style={{ margin: 0, fontSize: 13.5, color: "var(--mut)", lineHeight: 1.5 }}>
      {lead(text, language)}
      {second ? <span style={{ display: "block", fontSize: 12.5 }}>{second}</span> : null}
    </p>
  );
}

function minutesSince(at: string | null, now: Date): number {
  const then = at ? Date.parse(at) : Number.NaN;
  return Number.isFinite(then) ? Math.max(0, (now.getTime() - then) / 60_000) : 0;
}

/* ------------------------------------------------------------- the week */

function WeekView({ week, which, bounds, lessons, practice, language, now }: { week: HelperWeek | null; which: WeekChoice; bounds: { from: Date; to: Date }; lessons: Lesson[]; practice: boolean; language: Language; now: Date }) {
  const say = (text: Localized) => lead(text, language);
  const range = `${istDate.format(bounds.from)} – ${istDate.format(new Date(bounds.to.getTime() - 1))}`;
  const waitingLessons = lessons.filter((lesson) => lesson.status === "waiting");
  const chips = (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      {(["this", "last"] as const).map((choice) => (
        <Link
          key={choice}
          href={choice === "this" ? PAGE : `${PAGE}?week=last`}
          className={`tap chip${which === choice ? " on" : ""}`}
          aria-current={which === choice ? "page" : undefined}
          style={{ textDecoration: "none" }}
        >
          {say(choice === "this" ? hw.thisWeek : hw.lastWeek)}
        </Link>
      ))}
      <span style={{ fontSize: 13, color: "var(--mut)" }}>{range}</span>
    </div>
  );

  if (!week) {
    return (
      <>
        {chips}
        <Card>
          <Sub text={hw.unreadable} language={language} />
        </Card>
      </>
    );
  }
  const r = week.report;
  const nameOf = (id: string | null) => (id === null ? say(hw.officeAnyone) : (week.names[id] ?? say(hw.otherStaff)));
  const empty = r.questions === 0 && r.notSent === 0 && r.targets.length === 0 && r.waiting.count === 0 && r.ratings.helped + r.ratings.notHelped === 0;
  const percent = r.questions > 0 ? Math.round((r.byItself / r.questions) * 100) : null;
  const topMax = Math.max(1, ...r.topics.map((row) => row.count));
  const needs: Array<{ icon: IconName; tone: "warn" | "bad" | "info"; text: Localized; help?: Localized; action?: ReactNode }> = [];
  if (waitingLessons.length > 0) {
    needs.push({
      icon: "sparkle",
      tone: "info",
      text: hw.couldNot(waitingLessons.length),
      help: hw.couldNotHelp,
      action: (
        <Link href={`${PAGE}?tab=teach#teach`} className="tap btn pri" style={{ textDecoration: "none" }}>
          <Ic n="edit" size={18} />
          {say(hw.teachButton)}
        </Link>
      ),
    });
  }
  if (r.waiting.count > 0) {
    needs.push({
      icon: "clock",
      tone: "warn",
      text: hw.waitingNow(r.waiting.count),
      help: hw.waitingOldest(durationText(durationParts(minutesSince(r.waiting.oldestAt, now)))),
      action: (
        <Link href="/messages?view=replies" className="tap btn sec" style={{ textDecoration: "none" }}>
          <Ic n="inbox" size={18} />
          {say(hw.openMessages)}
        </Link>
      ),
    });
  }
  if (r.ratings.notHelped > 0) needs.push({ icon: "alert", tone: "bad", text: hw.notHelped(r.ratings.notHelped) });
  if (r.fellBack > 0) needs.push({ icon: "help", tone: "warn", text: hw.fellBack(r.fellBack) });
  if (r.notSent > 0) needs.push({ icon: "alert", tone: "bad", text: hw.notSent(r.notSent) });

  return (
    <>
      {chips}
      {empty && needs.length === 0 ? (
        <Card>
          <EmptyState icon="message" title={say(hw.noneYet)} body={say(hw.noneYetHelp)} />
        </Card>
      ) : (
        <>
          <Grid cols={4}>
            <Kpi label={say(hw.questions)} value={r.questions} icon="message" delay={0} />
            <Kpi label={say(hw.byItself)} value={r.byItself} sub={say(hw.byItselfSub(percent))} icon="sparkle" tone="var(--ok)" delay={60} />
            <Kpi label={say(hw.handedOff)} value={r.handedOff} icon="users" delay={120} />
            <Kpi label={say(hw.replyIn)} value={r.medianSeconds === null ? "—" : say(hw.seconds(r.medianSeconds))} sub={say(hw.replyInSub)} icon="clock" delay={180} />
          </Grid>

          <Card>
            <CardHead title={say(hw.needsTitle)} badge={needs.length > 0 ? <Pill tone="warn">{needs.length}</Pill> : <Pill tone="ok" icon="check">{say(hw.needsNone)}</Pill>} />
            {needs.length > 0 ? (
              <ul style={list}>
                {needs.map((need, index) => (
                  <li key={index} style={rowStyle}>
                    <IconTile icon={need.icon} tone={need.tone} size={44} />
                    <span style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 15, fontWeight: 650 }}>{say(need.text)}</span>
                      {need.help ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{say(need.help)}</span> : null}
                    </span>
                    {need.action}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 16 }}>
            <Card>
              <CardHead title={say(hw.topicsTitle)} />
              {r.topics.length === 0 ? (
                <div style={{ marginTop: 10 }}>
                  <Sub text={hw.noneYet} language={language} />
                </div>
              ) : (
                <ul style={{ ...list, gap: 10, marginTop: 14 }}>
                  {r.topics.map((row, index) => (
                    <li key={row.topic} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14 }}>
                        <span style={{ fontWeight: 600 }}>{say(topicLabels[row.topic] ?? { hi: row.topic, en: row.topic })}</span>
                        <span className="num" style={{ fontWeight: 700 }}>{row.count}</span>
                      </span>
                      <span aria-hidden="true" style={{ display: "block", height: 10, borderRadius: 5, background: "var(--s3)", overflow: "hidden" }}>
                        <span
                          style={{
                            display: "block",
                            height: "100%",
                            width: `${Math.max(4, Math.round((row.count / topMax) * 100))}%`,
                            borderRadius: 5,
                            background: index === 0 ? "var(--acc)" : "var(--pri)",
                            transformOrigin: "left",
                            animation: `xGrowX .6s var(--ease) ${index * 60}ms both`,
                          }}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {r.fromSchoolAnswers > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <Pill tone="ok" icon="sparkle">{say(hw.fromSchool(r.fromSchoolAnswers))}</Pill>
                </div>
              ) : null}
            </Card>

            <Card>
              <CardHead title={say(hw.peopleTitle)} />
              <div style={{ marginTop: 8 }}>
                <Sub text={hw.peopleHelp} language={language} />
              </div>
              {r.people.length === 0 ? (
                <div style={{ marginTop: 10 }}>
                  <Sub text={hw.peopleNone} language={language} />
                </div>
              ) : (
                <ul style={list}>
                  {r.people.map((row) => (
                    <li key={row.staffId} style={rowStyle}>
                      <span style={{ flex: "1 1 160px", minWidth: 0, fontSize: 15, fontWeight: 650, overflowWrap: "anywhere" }}>{nameOf(row.staffId)}</span>
                      <Pill tone="mut">{say(hw.answeredCount(row.answered))}</Pill>
                      {row.medianMinutes !== null ? <Pill tone={row.medianMinutes <= 60 ? "ok" : row.medianMinutes <= 240 ? "warn" : "bad"} icon="clock">{say(hw.inTime(durationText(durationParts(row.medianMinutes))))}</Pill> : null}
                    </li>
                  ))}
                </ul>
              )}
              {r.targets.length > 0 ? (
                <>
                  <div style={{ marginTop: 14, fontSize: 14, fontWeight: 700 }}>{say(hw.forTitle)}</div>
                  <ul style={{ ...list, marginTop: 4 }}>
                    {r.targets.map((row) => (
                      <li key={row.target} style={{ ...rowStyle, padding: "9px 0" }}>
                        <span style={{ flex: "1 1 140px", minWidth: 0, fontSize: 14, fontWeight: 600 }}>{say(targetLabels[row.target] ?? { hi: row.target, en: row.target })}</span>
                        <span style={{ fontSize: 13, color: "var(--mut)" }}>{say(hw.forRow(row.count, row.answered))}</span>
                        {row.medianMinutes !== null ? <Pill tone="mut" icon="clock">{say(hw.inTime(durationText(durationParts(row.medianMinutes))))}</Pill> : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </Card>
          </div>

          <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 16 }}>
            <Card>
              <CardHead title={say(hw.waitingTitle)} badge={r.waiting.count > 0 ? <Pill tone="warn">{r.waiting.count}</Pill> : undefined} />
              {r.waiting.byPerson.length === 0 ? (
                <div style={{ marginTop: 10 }}>
                  <Sub text={hw.waitingNone} language={language} />
                </div>
              ) : (
                <ul style={list}>
                  {r.waiting.byPerson.map((row) => (
                    <li key={row.staffId ?? "office"} style={rowStyle}>
                      <span style={{ flex: "1 1 160px", minWidth: 0, fontSize: 15, fontWeight: 650, overflowWrap: "anywhere" }}>{nameOf(row.staffId)}</span>
                      <span style={{ fontSize: 13, color: "var(--mut)" }}>{say(hw.waitingRow(row.count, durationText(durationParts(minutesSince(row.oldestAt, now)))))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHead title={say(hw.ratingsTitle)} />
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 12 }}>
                <Sub text={hw.ratingsHelp} language={language} />
                {r.ratings.helped + r.ratings.notHelped === 0 ? (
                  <Sub text={hw.ratingsNone} language={language} />
                ) : (
                  <span style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <Pill tone="ok">{say(hw.helped(r.ratings.helped))}</Pill>
                    <Pill tone={r.ratings.notHelped > 0 ? "bad" : "mut"}>{say(hw.notHelpedShort(r.ratings.notHelped))}</Pill>
                  </span>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, paddingTop: 10, borderTop: "1px solid var(--bd)", fontSize: 14 }}>
                  <span style={{ color: "var(--mut)" }}>{say(hw.costTitle)}</span>
                  <span style={{ fontWeight: 650 }}>{say(hw.costLine(formatInr(r.costUsd * inrPerUsd(), { showPaise: true })))}</span>
                </div>
              </div>
            </Card>
          </div>
        </>
      )}
      {practice ? null : <Sub text={hw.realNote} language={language} />}
    </>
  );
}

/* ------------------------------------------------------ teach it once */

function TeachForm({ lesson, language, open }: { lesson: Lesson; language: Language; open?: boolean }) {
  const say = (text: Localized) => lead(text, language);
  return (
    <form action={teachLessonAction} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: open ? 10 : 0 }}>
      <input type="hidden" name="id" value={lesson.id} />
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13.5, fontWeight: 650 }}>
        {say(hw.questionLabel)}
        <input className="inp" name="question" defaultValue={lesson.question} minLength={QUESTION_CHARS.min} maxLength={QUESTION_CHARS.max} required />
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13.5, fontWeight: 650 }}>{say(hw.answerLabel)}</span>
        <AnswerBox initial={lesson.answer ?? ""} placeholder={say(hw.answerPlaceholder)} max={ANSWER_CHARS.max} countLabel={say(hw.chars(ANSWER_CHARS.max))} />
        <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{say(hw.answerHint)}</span>
      </div>
      <div>
        <PendingBtn label={say(hw.save)} pendingLabel={say(hw.saving)} icon="check" variant="pri" big />
      </div>
    </form>
  );
}

function SmallAction({ action, id, label, pending, icon, confirm }: { action: (formData: FormData) => Promise<void>; id: string; label: string; pending: string; icon: IconName; confirm?: string }) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <PendingBtn label={label} pendingLabel={pending} icon={icon} variant="ghost" confirm={confirm} />
    </form>
  );
}

function TeachView({ book, language, canChange, now, note }: { book: LessonBook | null; language: Language; canChange: boolean; now: Date; note: ReactNode }) {
  const say = (text: Localized) => lead(text, language);
  if (!book) {
    return (
      <div id="teach" style={{ display: "flex", flexDirection: "column", gap: 12, scrollMarginTop: 76 }}>
        {note}
        <Card>
          <Sub text={hw.unreadable} language={language} />
        </Card>
      </div>
    );
  }
  const demand = (lesson: Lesson) => lesson.askedCount + lesson.usedCount;
  const waiting = book.lessons.filter((lesson) => lesson.status === "waiting").sort((a, b) => demand(b) - demand(a) || Date.parse(b.lastAskedAt) - Date.parse(a.lastAskedAt));
  const answered = book.lessons.filter((lesson) => lesson.status === "answered").sort((a, b) => demand(b) - demand(a));
  const people = book.lessons.filter((lesson) => lesson.status === "by_people").sort((a, b) => demand(b) - demand(a));
  const ago = (at: string | null) => agoText(durationParts(minutesSince(at, now)));
  const topic = (lesson: Lesson) => (lesson.topic && topicLabels[lesson.topic] ? <Pill tone="mut">{say(topicLabels[lesson.topic])}</Pill> : null);

  return (
    <div id="teach" style={{ display: "flex", flexDirection: "column", gap: 16, scrollMarginTop: 76 }}>
      {note}
      <Card style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <IconTile icon="sparkle" tone="acc" size={48} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <Sub text={hw.teachIntro} language={language} />
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ok)", fontWeight: 600 }}>
            <Ic n="shield" size={16} />
            {say(hw.teachSafe)}
          </span>
          {canChange ? null : <Sub text={hw.lookOnly} language={language} />}
        </div>
      </Card>

      <Card>
        <CardHead title={say(hw.waitingTitleList)} badge={waiting.length > 0 ? <Pill tone="warn">{waiting.length}</Pill> : undefined} />
        {waiting.length === 0 ? (
          <EmptyState icon="checkCircle" title={say(hw.waitingListNone)} body={say(hw.waitingListNoneHelp)} />
        ) : (
          <ul style={{ ...list, gap: 14 }}>
            {waiting.map((lesson, index) => (
              <li key={lesson.id} className="rise" style={{ border: "1px solid var(--bd)", borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 10, animationDelay: `${Math.min(index, 6) * 50}ms` }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span aria-hidden="true" style={{ flex: "none", width: 36, height: 36, borderRadius: 12, background: "var(--warns)", color: "var(--warnfg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Ic n="help" size={20} />
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <strong style={{ fontSize: 16, lineHeight: 1.35, overflowWrap: "anywhere" }}>{lesson.question}</strong>
                    <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--mut)" }}>
                      {say(hw.asked(lesson.askedCount, ago(lesson.lastAskedAt)))}
                      {topic(lesson)}
                    </span>
                  </div>
                </div>
                {canChange ? (
                  <>
                    <TeachForm lesson={lesson} language={language} />
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, borderTop: "1px solid var(--bd)", paddingTop: 8 }}>
                      <SmallAction action={leaveToPeopleAction} id={lesson.id} label={say(hw.byPeopleButton)} pending={say(hw.saving)} icon="users" />
                      <SmallAction action={removeLessonAction} id={lesson.id} label={say(hw.remove)} pending={say(hw.removing)} icon="trash" confirm={say(hw.removeConfirm)} />
                    </div>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHead title={say(hw.answeredTitle)} badge={answered.length > 0 ? <Pill tone="ok" icon="sparkle">{answered.length}</Pill> : undefined} />
        {answered.length === 0 ? (
          <div style={{ marginTop: 10 }}>
            <Sub text={hw.answeredNone} language={language} />
          </div>
        ) : (
          <ul style={list}>
            {answered.map((lesson) => (
              <li key={lesson.id} style={{ ...rowStyle, flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                <strong style={{ fontSize: 15, overflowWrap: "anywhere" }}>{lesson.question}</strong>
                <span style={{ fontSize: 14.5, lineHeight: 1.5, whiteSpace: "pre-line", overflowWrap: "anywhere", padding: "8px 12px", borderRadius: 12, background: "var(--oks)" }}>{lesson.answer}</span>
                <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--mut)" }}>
                  <Pill tone="ok">{say(hw.used(lesson.usedCount))}</Pill>
                  {say(hw.taughtBy(lesson.answeredBy ? (book.names[lesson.answeredBy] ?? null) : null, ago(lesson.answeredAt)))}
                  {topic(lesson)}
                </span>
                {canChange ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <details style={{ border: "1px solid var(--bd)", borderRadius: 14, padding: "8px 12px" }}>
                      <summary className="tap" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 14.5, fontWeight: 650, listStyle: "none", minHeight: 36 }}>
                        <Ic n="edit" size={18} />
                        {say(hw.change)}
                      </summary>
                      <TeachForm lesson={lesson} language={language} open />
                    </details>
                    <div>
                      <SmallAction action={leaveToPeopleAction} id={lesson.id} label={say(hw.byPeopleInstead)} pending={say(hw.saving)} icon="users" />
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHead title={say(hw.byPeopleTitle)} badge={people.length > 0 ? <Pill tone="mut" icon="users">{people.length}</Pill> : undefined} />
        <div style={{ marginTop: 8 }}>
          <Sub text={hw.byPeopleHelp} language={language} />
        </div>
        {people.length > 0 ? (
          <ul style={list}>
            {people.map((lesson) => (
              <li key={lesson.id} style={{ ...rowStyle, flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                <strong style={{ fontSize: 15, overflowWrap: "anywhere" }}>{lesson.question}</strong>
                <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--mut)" }}>
                  {say(hw.asked(lesson.askedCount, ago(lesson.lastAskedAt)))}
                  {topic(lesson)}
                </span>
                {canChange ? (
                  <details style={{ border: "1px solid var(--bd)", borderRadius: 14, padding: "8px 12px" }}>
                    <summary className="tap" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 14.5, fontWeight: 650, listStyle: "none", minHeight: 36 }}>
                      <Ic n="sparkle" size={18} />
                      {say(hw.teachInstead)}
                    </summary>
                    <TeachForm lesson={lesson} language={language} open />
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}

/**
 * Settings → WhatsApp → Veer Patta AI (D-589, D-590): the helper's week for
 * the owner and admins, and "teach it once", the list of general questions
 * it could not answer, where an admin writes the school's answer once.
 *
 * The page follows the year pill: a test session shows the practice family's
 * messages and practice answers, the real year real families'. Staff are
 * named only in their own kind of view (8 Nov 2026). Admin only to change;
 * `settings:manage` to look.
 */
export default async function VeerPattaAiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("settings:manage", PAGE);
  const language = staff.language;
  const say = (text: Localized) => lead(text, language);
  const canChange = staff.role === "admin";
  const raw = await searchParams;
  const params = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const tab = params.tab === "teach" ? "teach" : "week";
  const which: WeekChoice = params.week === "last" ? "last" : "this";
  const practice = staff.isTestAccount === true || (await viewingTestSession());
  const now = new Date();
  const bounds = weekBounds(now, which);
  const [book, week] = await Promise.all([readLessonBook(practice), tab === "week" ? readHelperWeek(practice, bounds) : Promise.resolve(null)]);
  const waiting = book?.lessons.filter((lesson) => lesson.status === "waiting").length ?? 0;

  const note = typeof params.note === "string" ? teachNote(params.note, params) : null;
  const banner = note ? (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 14,
        background: `var(--${note.tone === "ok" ? "oks" : note.tone === "bad" ? "bads" : note.tone === "warn" ? "warns" : "infos"})`,
        color: `var(--${note.tone === "ok" ? "ok" : note.tone === "bad" ? "bad" : note.tone === "warn" ? "warnfg" : "info"})`,
        fontSize: 14.5,
        fontWeight: 600,
        animation: "xToast .35s var(--ease) both",
      }}
    >
      <Ic n={NOTE_ICON[note.tone] ?? "info"} size={20} style={{ marginTop: 1 }} />
      <span>{say(note.text)}</span>
    </div>
  ) : null;

  return (
    <VxPage>
      <TopBar crumb={say(hw.crumb)} title={say(hw.title)} mSub={say(hw.sub)} mBack="/settings/whatsapp" />
      <main>
        <Section style={{ maxWidth: 980 }}>
          <Card style={{ display: "flex", alignItems: "center", gap: 14, animation: "xIn .32s var(--ease) both" }}>
            <IconTile icon="sparkle" tone="acc" size={52} />
            <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
              <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 800 }}>
                Veer Patta AI
                <Pill tone={practice ? "info" : "ok"} icon={practice ? "flask" : "users"}>{practice ? "TEST-2026-27" : "2026-27"}</Pill>
              </span>
              <Sub text={practice ? hw.practiceNote : hw.sub} language={language} />
            </span>
          </Card>

          <nav aria-label={say(hw.title)} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Link href={PAGE} className={`tap btn ${tab === "week" ? "pri" : "sec"}`} aria-current={tab === "week" ? "page" : undefined} style={{ textDecoration: "none" }}>
              <Ic n="chart" size={18} />
              {say(hw.tabWeek)}
            </Link>
            <Link href={`${PAGE}?tab=teach`} className={`tap btn ${tab === "teach" ? "pri" : "sec"}`} aria-current={tab === "teach" ? "page" : undefined} style={{ textDecoration: "none" }}>
              <Ic n="sparkle" size={18} />
              {say(hw.tabTeach(waiting))}
            </Link>
          </nav>

          {tab === "week" ? (
            <WeekView week={week} which={which} bounds={bounds} lessons={book?.lessons ?? []} practice={practice} language={language} now={now} />
          ) : (
            <TeachView book={book} language={language} canChange={canChange} now={now} note={banner} />
          )}
        </Section>
      </main>
    </VxPage>
  );
}
