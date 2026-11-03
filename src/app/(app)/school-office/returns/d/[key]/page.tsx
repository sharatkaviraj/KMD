import { notFound } from "next/navigation";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { destinationDetail } from "@/modules/government-records/data/readiness";
import { askTeachersHref, cellStudents } from "@/modules/government-records/domain/readiness";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { getViewer } from "@/vx/view-as";
import { ReturnDestination } from "@/vx/screens/school-office/return-destination";
import { G } from "@/vx/screens/school-office/return-text";
export const runtime = "nodejs";
export const metadata = { title: "Government return destination" };

/** The students one heat-grid cell lists are bounded; a class is ~40, a school-wide column at most the roster. */
const MAX_LISTED = 300;

export default async function ReturnDestinationPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("government:view", "/school-office/returns");
  const { previewing } = await getViewer();
  const session = await resolveSessionLabel();
  if (!session) notFound();
  const [{ key }, query] = await Promise.all([params, searchParams]);
  const detail = await destinationDetail(session, key);
  if (!detail) notFound();
  const readiness = detail.readiness;
  // The selected cell lives in the URL (Back works, a link can be shared); anything unknown is ignored.
  const classId = typeof query.class === "string" && readiness?.grid.classes.some((c) => c.id === query.class) ? query.class : null;
  const issue = typeof query.issue === "string" && readiness?.grid.issues.includes(query.issue) ? query.issue : null;
  const selected = readiness && (classId || issue) ? { classId, issue } : null;
  const students = readiness && selected ? cellStudents(readiness.rows, readiness.preflight, classId, issue).slice(0, MAX_LISTED) : [];
  return <VxPage><TopBar title={lead(G.title, staff.language)} crumb={session} mBack="/school-office/returns" /><main><Section>
    <ReturnDestination sessionLabel={session} destination={detail.destination} counts={readiness?.counts ?? null} grid={readiness?.grid ?? null}
      selected={selected} students={students} sourceRevision={readiness?.sourceRevision ?? ""}
      batches={detail.batches.map((batch) => ({ id: batch.id, state: batch.state, created_at: batch.created_at, direction: batch.direction, mode: batch.adapter.mode }))}
      manual={detail.manual} askHref={readiness && can(staff, "collection:manage") ? askTeachersHref(readiness.grid) : null}
      canExport={!previewing && can(staff, "government:export")} canManage={can(staff, "settings:manage")} />
  </Section></main></VxPage>;
}
