import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { boardWorkspace } from "@/modules/official-results/data/repo";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { BoardWorkspace } from "@/vx/screens/board-office/workspace";
import { B } from "@/vx/screens/board-office/text";
import { z } from "zod";
export const runtime = "nodejs";
export default async function BoardPage({ searchParams }: { searchParams: Promise<{ cycle?: string; student?: string }> }) {
 const staff = await requirePermission("outcomes:view", "/exam-office/board"), session = await resolveSessionLabel(), params = await searchParams, selected = params.cycle, student = z.uuid().safeParse(params.student);
 const workspace = session ? await boardWorkspace(session, selected).catch(() => null) : null;
 return <VxPage><TopBar title={lead(B.board, staff.language)} crumb={session} mBack="/exam-office" /><main><Section><BoardWorkspace workspace={workspace} sessionLabel={session ?? ""} canManage={can(staff, "outcomes:manage")} mode="board" unavailable={!workspace} studentId={student.success ? student.data : undefined} /></Section></main></VxPage>;
}
