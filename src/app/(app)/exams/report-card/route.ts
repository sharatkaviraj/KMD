import type { NextRequest } from "next/server";

import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { assertPermission } from "@/platform/auth/current-staff";
import { schoolToday } from "@/platform/dates";
import { documentLetterhead } from "@/modules/certificates/data/issue";
import { cardExtras } from "@/vx/screens/exams/card-extras";
import { classesFor, enrolmentsFor, listExams, remarksFor, staffList, studentsByIds } from "@/vx/screens/exams/data";
import { cardState, graceByStudent, toPdf, type CardState } from "@/vx/screens/exams/cards-data";
import { onRoll } from "@/vx/screens/exams/domain/tracker";
import { mapConcurrently } from "@/platform/helpers/chunk";

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
    // A few children at a time, in roll order: a class of 50 no longer waits for 50 reads one after another.
    const states = await mapConcurrently(ids, 4, (id) => cardState({ studentId: id, sessionLabel, term, grace: grace.get(id) ?? {}, remark: remarks.get(id) ?? null }));
    const found = states.filter((state): state is CardState => state !== null);
    if (found.length === 0) return new Response("No report card yet.", { status: 404 });

    // The page around the marks (D-612): letterhead, photo, mother, birth date,
    // class teacher and exam in-charge. None of it may stop a card printing.
    const [school, extras, classes, staff] = await Promise.all([
      documentLetterhead().catch(() => null),
      cardExtras(found.map((s) => s.card.studentId)).catch(() => new Map()),
      classesFor(sessionLabel).catch(() => []),
      staffList().catch(() => []),
    ]);
    const teacherOf = (label: string) => (classId ? classes.find((c) => c.id === classId) : classes.find((c) => c.label === label))?.classTeacherName ?? null;
    const coordinator = staff.find((s) => s.role === "exam_coordinator")?.name ?? null;
    const cards = found.map((state) => ({ ...toPdf(state), ...(extras.get(state.card.studentId) ?? {}), classTeacher: teacherOf(state.card.classLabel) }));

    // The exam the reader was looking at names the card; the last exam of the
    // term is only a fallback (a Half yearly card printed as "QA Terra
    // Isolated Exam", day-run 6 Nov 2026, E44).
    const asked = url.searchParams.get("exam");
    const exam = termExams.find((e) => e.id === asked) ?? termExams.at(-1);
    const title = { en: exam?.labelEn ?? term, hi: exam?.labelHi ?? term };
    const { renderReportCardsPdf } = await import("@/vx/screens/exams/report-card-pdf");
    const buffer = await renderReportCardsPdf({ cards, title, school, coordinator });
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
