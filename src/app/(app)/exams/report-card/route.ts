import type { NextRequest } from "next/server";

import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { assertPermission } from "@/platform/auth/current-staff";
import { schoolToday } from "@/platform/dates";
import { enrolmentsFor, listExams, remarksFor, studentsByIds } from "@/vx/screens/exams/data";
import { cardState, graceByStudent, toPdf } from "@/vx/screens/exams/cards-data";
import { onRoll } from "@/vx/screens/exams/domain/tracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Report cards as a PDF, made on the server: `?student=<id>&term=<term>` for
 * one child, or `?class=<id>&term=<term>` for a whole class in roll order.
 * Reading cards is `reports:view`; the card shown is the issued one when
 * there is one, else a draft marked as such.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const student = url.searchParams.get("student");
  const classId = url.searchParams.get("class");
  const term = url.searchParams.get("term") ?? "";
  if ((!student || !UUID.test(student)) && (!classId || !UUID.test(classId))) return new Response("Not found.", { status: 404 });
  if (!term || term.length > 40) return new Response("Say which term.", { status: 400 });

  try {
    await assertPermission("reports:view");
  } catch {
    return new Response("You cannot open report cards.", { status: 403 });
  }

  try {
    const sessionLabel = await resolveSessionLabel();
    if (!sessionLabel) return new Response("No session.", { status: 404 });
    const termExams = (await listExams(sessionLabel)).filter((e) => e.term === term && e.status !== "draft");
    let ids: string[];
    if (student) ids = [student];
    else {
      const today = schoolToday();
      const roll = (await enrolmentsFor(sessionLabel, [classId!])).filter((e) => onRoll(e, { startsOn: today, endsOn: today }, today));
      const names = await studentsByIds(roll.map((r) => r.studentId));
      ids = roll
        .sort((a, b) => Number(a.roll ?? 9999) - Number(b.roll ?? 9999) || (names.get(a.studentId)?.name ?? "").localeCompare(names.get(b.studentId)?.name ?? ""))
        .map((r) => r.studentId);
    }
    const [grace, remarks] = await Promise.all([graceByStudent(termExams, classId ?? undefined), remarksFor(sessionLabel, term, ids)]);
    const cards = [];
    for (const id of ids) {
      const state = await cardState({ studentId: id, sessionLabel, term, grace: grace.get(id) ?? {}, remark: remarks.get(id) ?? null });
      if (state) cards.push(toPdf(state));
    }
    if (cards.length === 0) return new Response("No report card yet.", { status: 404 });

    const exam = termExams.at(-1);
    const title = { en: `${exam?.labelEn ?? term} · Report card`, hi: `${exam?.labelHi ?? term} · प्रगति पत्र` };
    const { renderReportCardsPdf } = await import("@/vx/screens/exams/report-card-pdf");
    const buffer = await renderReportCardsPdf({ cards, title });
    const name = student ? `report-card-${cards[0].card.admissionNo ?? student}` : `report-cards-${cards[0].card.classLabel}`;
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${url.searchParams.get("download") ? "attachment" : "inline"}; filename="${name.replace(/[^a-z0-9-]/gi, "_")}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[report-card-pdf] failed", error);
    return new Response("Could not make the report card. Please try again.", { status: 500 });
  }
}
