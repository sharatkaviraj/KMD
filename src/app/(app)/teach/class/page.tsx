import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { loadClass, loadStudent, loadSubject } from "@/vx/screens/teach/data";
import { TeachClass, TeachStudent, TeachSubject } from "@/vx/screens/teach/ui/class";
import { TeachEmpty } from "@/vx/screens/teach/ui/empty";

export const runtime = "nodejs";

export const metadata = { title: "My class" };

const UUID = /^[0-9a-f-]{36}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const VIEWS = ["class", "roster", "subjects"] as const;
const TABS = ["about", "attendance", "marks", "notes"] as const;

/**
 * TchClass: `class` (default), `?view=roster|subjects`, `?student=<id>`
 * (`&tab=`), `?subject=<classId>.<subjectId>`. Never any money.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("attendance:view", "/teach/class");
  const sp = await searchParams;
  const title = { en: "My class", hi: "मेरी कक्षा" };

  const student = one(sp.student);
  if (student) {
    const data = UUID.test(student) ? await loadStudent(staff, student) : null;
    if (!data) return <TeachEmpty kind="not-found" title={title} back="/teach/class" />;
    const tab = one(sp.tab);
    return <TeachStudent data={data} initialTab={(TABS as readonly string[]).includes(tab ?? "") ? (tab as (typeof TABS)[number]) : "about"} back={`/teach/class?class=${data.classId}&view=roster`} canAskCertificate={can(staff, "certificates:request")} />;
  }

  const subject = one(sp.subject);
  if (subject) {
    const [classId, subjectId] = subject.split(".");
    const data = classId && subjectId && UUID.test(classId) && UUID.test(subjectId) ? await loadSubject(staff, classId, subjectId) : null;
    if (!data) return <TeachEmpty kind="not-found" title={title} back="/teach/class?view=subjects" />;
    return <TeachSubject data={data} />;
  }

  const classParam = one(sp.class);
  const data = await loadClass(staff, { classId: classParam && UUID.test(classParam) ? classParam : null });
  if (data.kind === "no-session") return <TeachEmpty kind="no-session" title={title} back="/teach" />;
  const view = one(sp.view);
  return <TeachClass data={data} initialView={(VIEWS as readonly string[]).includes(view ?? "") ? (view as (typeof VIEWS)[number]) : "class"} />;
}
