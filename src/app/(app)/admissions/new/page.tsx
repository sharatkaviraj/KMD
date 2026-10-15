import { requirePermission } from "@/platform/auth/current-staff";
import { schoolProfile } from "@/platform/config/school";
import { getStudentDetail, loadAdmissionsFeeContext, loadNewAdmissionDuesSplit, nextFreeSrCandidates } from "@/modules/students-fees/vx/admissions";
import { lead } from "@/vx/text";
import { VxPage, TopBar, Section } from "@/vx/ui/page";
import { EmptyState, Btn } from "@/vx/ui/primitives";
import { getViewer } from "@/vx/view-as";

import { getEnquiry, loadAdmissionDetails, loadSeats } from "@/vx/screens/admissions/data";
import { AdmissionDone } from "@/vx/screens/admissions/done";
import { nextSrNumber, normalizeName } from "@/vx/screens/admissions/logic";
import { AdmissionWizard, type WizardPrefill } from "@/vx/screens/admissions/wizard";

export const runtime = "nodejs";

const DOC_SHORT: Record<string, string> = { birth: "Birth certificate", photo: "Photo", aadhaar: "Aadhaar copy", tc: "TC", address: "Address proof" };

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/**
 * Admissions → Add a student. States: step1–4 (`?step=`), duplicate and
 * sibling (sheets inside the wizard), and done (`?done=<studentId>`).
 */
export default async function NewAdmissionPage(props: PageProps<"/admissions/new">) {
  await requirePermission("fees:manage", "/admissions/new");
  const params = await props.searchParams;
  const { staff } = await getViewer();
  const lang = staff.language;
  const doneId = one(params.done);

  if (doneId) {
    const student = await getStudentDetail(doneId);
    if (!student) {
      return (
        <VxPage>
          <TopBar title={lead({ en: "Add a student", hi: "विद्यार्थी जोड़ें" }, lang)} mBack="/admissions" />
          <main>
            <Section>
              <EmptyState icon="user" title={lead({ en: "That student was not found", hi: "वह विद्यार्थी नहीं मिला" }, lang)} action={<Btn variant="pri" href="/admissions">{lead({ en: "Back to Admissions", hi: "दाख़िलों पर लौटें" }, lang)}</Btn>} />
            </Section>
          </main>
        </VxPage>
      );
    }
    const [dues, details] = await Promise.all([loadNewAdmissionDuesSplit(doneId), loadAdmissionDetails([doneId])]);
    const docs = details.get(doneId)?.docs ?? {};
    const missingDocs = (["birth", "photo", "aadhaar"] as const).filter((k) => docs[k] !== true).map((k) => DOC_SHORT[k]);
    return (
      <VxPage>
        <AdmissionDone
          info={{
            studentId: student.id,
            name: student.fullName,
            classLabel: student.classLabel,
            sr: student.admissionNo,
            fatherName: student.fatherName,
            phone: student.fatherPhone ?? student.motherPhone,
            savedBy: staff.displayName,
            pendingToday: dues.pendingToday,
            notDueYet: dues.notDueYet,
            missingDocs,
            schoolName: schoolProfile.name,
          }}
        />
      </VxPage>
    );
  }

  const ctx = await loadAdmissionsFeeContext();
  const [seats, srList] = await Promise.all([loadSeats(ctx.sessionLabel), nextFreeSrCandidates()]);
  const enquiryId = one(params.enquiry);
  const enquiry = enquiryId ? await getEnquiry(enquiryId) : null;
  const matchClass = enquiry?.classLabel ? ctx.classes.find((c) => normalizeName(c.label) === normalizeName(enquiry.classLabel ?? "") || normalizeName(c.label).startsWith(normalizeName(enquiry.classLabel ?? "") + " ")) : undefined;
  const prefill: WizardPrefill = {
    enquiryId: enquiry && enquiry.stage !== "admitted" ? enquiry.id : null,
    fullName: enquiry?.childName ?? "",
    classId: matchClass?.id ?? "",
    fatherName: enquiry?.parentName ?? "",
    phone: enquiry?.phone ?? "",
  };
  const step = Number(one(params.step)) || 1;

  return (
    <VxPage>
      <AdmissionWizard
        ctx={{
          ...ctx,
          classes: ctx.classes.map((c) => ({ id: c.id, label: c.label, onRoll: c.onRoll, seats: seats.get(c.id) ?? null, tuition: c.tuition })),
          nextSr: nextSrNumber(srList),
        }}
        prefill={prefill}
        initialStep={step}
      />
    </VxPage>
  );
}
