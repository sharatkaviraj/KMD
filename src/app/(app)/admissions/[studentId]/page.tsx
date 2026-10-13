import { notFound } from "next/navigation";

import { requirePermission } from "@/platform/auth/current-staff";
import { schoolProfile } from "@/platform/config/school";
import { getStudentDetail, loadAdmissionsFeeContext, loadDuesSplit, loadStudentHistory } from "@/modules/students-fees/vx/admissions";
import { VxPage } from "@/vx/ui/page";

import { loadAdmissionDetails } from "@/vx/screens/admissions/data";
import { dobForInput } from "@/vx/screens/admissions/logic";
import { StudentRecord } from "@/vx/screens/admissions/record";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Admissions → one student: states `edit` and `withdraw` (`?view=withdraw`). */
export default async function AdmissionRecordPage(props: PageProps<"/admissions/[studentId]">) {
  const { studentId } = await props.params;
  await requirePermission("fees:manage", `/admissions/${studentId}`);
  if (!UUID.test(studentId)) notFound();
  const search = await props.searchParams;

  const student = await getStudentDetail(studentId);
  if (!student) notFound();
  const [ctx, dues, history, details] = await Promise.all([loadAdmissionsFeeContext(), loadDuesSplit(studentId), loadStudentHistory(studentId), loadAdmissionDetails([studentId])]);
  const detail = details.get(studentId);
  const view = search.view === "withdraw" ? "withdraw" : "edit";

  const classes = ctx.classes.map((c) => ({ id: c.id, label: c.label }));
  if (!classes.some((c) => c.id === student.classId)) classes.unshift({ id: student.classId, label: student.classLabel });
  const routes = ctx.routes.map((r) => ({ id: r.id, label: r.label }));
  if (student.transportRouteId && !routes.some((r) => r.id === student.transportRouteId)) routes.unshift({ id: student.transportRouteId, label: student.transportRouteLabel });

  return (
    <VxPage>
      <StudentRecord
        studentId={student.id}
        sessionLabel={student.classSessionLabel}
        sr={student.admissionNo}
        classLabel={student.classLabel}
        status={student.status}
        leftOn={student.leftOn}
        tcNumber={student.tcNumber}
        admittedOn={student.joinedOn ?? detail?.admittedAt ?? null}
        initial={{
          fullName: student.fullName,
          nameHi: detail?.nameHi ?? "",
          dob: dobForInput(student.dateOfBirth),
          gender: student.gender ?? "",
          fatherName: student.fatherName ?? "",
          motherName: student.motherName ?? "",
          fatherPhone: student.fatherPhone ?? "",
          motherPhone: student.motherPhone ?? "",
          address: student.address ?? "",
          villageCity: student.villageCity ?? "",
          previousSchool: student.previousSchool ?? "",
          classId: student.classId,
          transportRouteId: student.transportRouteId ?? "",
        }}
        docs={detail?.docs ?? {}}
        classes={classes}
        routes={routes}
        history={history}
        dues={dues}
        today={ctx.today}
        schoolName={schoolProfile.name}
        mode={view}
      />
    </VxPage>
  );
}
