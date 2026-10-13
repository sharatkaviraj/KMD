import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { greeting } from "@/vx/format";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { EmptyState } from "@/vx/ui/primitives";

import { academicContext, attendanceOn, marksEntry, needsAttention, notesNeedingAction, staffTemplateBodies, teachersAway, upcomingEvents, weekFacts } from "./data";
import { isUuid, mondayOf } from "./domain";
import { AcadHomeView } from "./home-view";
import { sayer } from "./ui";

/*
 * AcadHome's server half: it reads the day (scoped to the reader's classes)
 * and hands plain props to `AcadHomeView`, which draws the design.
 */

type Props = { staff: CurrentStaff; view?: string; sheet?: string; marks?: string; what?: string; who?: string };

const HELLO: Record<string, string> = { "Good morning": "सुप्रभात", "Good afternoon": "नमस्कार", "Good evening": "शुभ संध्या" };

export async function AcadHome({ staff, view, sheet, marks, what, who }: Props) {
  const language = staff.language;
  const say = sayer(language);
  const ctx = await academicContext(staff);
  if (!ctx) {
    return (
      <VxPage>
        <TopBar title={say("Today", "आज")} />
        <Section>
          <EmptyState icon="calendar" title={say("No session is open", "कोई सत्र खुला नहीं है")} body={say("Set the active session in the fee settings first.", "पहले फीस सेटिंग में सक्रिय सत्र चुनें।")} />
        </Section>
      </VxPage>
    );
  }

  const mode = view === "menu" || view === "week" ? view : "home";
  const mayRemind = can(staff, "messages:send");
  const [today, entry, attention, notes, events, away, marksTemplate, week, summaryTemplate] = await Promise.all([
    attendanceOn(ctx, ctx.today),
    marksEntry(ctx),
    needsAttention(ctx),
    notesNeedingAction(ctx),
    upcomingEvents(ctx.session, ctx.today, 70),
    teachersAway(ctx.session, ctx.today),
    sheet === "remind" && mayRemind ? staffTemplateBodies("vppsone_marks_reminder") : Promise.resolve(null),
    mode === "week" ? weekFacts(ctx) : Promise.resolve(null),
    mode === "week" && mayRemind ? staffTemplateBodies("vppsone_weekly_summary") : Promise.resolve(null),
  ]);
  // "New this week": nobody has followed them up yet, or the follow-up is this week's (as weekFacts counts it).
  const weekStart = `${mondayOf(ctx.today)}T00:00:00+05:30`;
  const attentionNew = attention.filter((a) => a.followup === null || a.followup.at >= weekStart).length;
  const hello = greeting();

  return (
    <AcadHomeView
      language={language}
      mode={mode}
      sheet={sheet === "remind" ? "remind" : null}
      what={what === "registers" ? "registers" : "marks"}
      who={isUuid(who) ? who : null}
      marksTab={marks === "class" ? "class" : "late"}
      me={{ name: staff.displayName }}
      session={ctx.session.replace("-", "–")}
      hello={{ en: hello, hi: HELLO[hello] ?? "नमस्ते" }}
      today={ctx.today}
      attendance={today}
      entry={entry}
      away={[...away]}
      attention={attention}
      attentionNew={attentionNew}
      notes={notes}
      events={events}
      marksTemplate={marksTemplate}
      week={week ? { monday: week.monday, daily: week.daily, trend: week.trend, facts: week.facts, improved: week.improved, help: week.attention.slice(0, 4), papers: week.papers, principals: week.principals, lastSent: week.lastSent } : null}
      summaryTemplate={summaryTemplate}
      mayRemind={mayRemind}
      // The exam coordinator opens this page too and has no notes screen.
      notesHref={can(staff, "notes:view") ? "/notes" : null}
    />
  );
}
