import { requirePermission } from "@/platform/auth/current-staff";
import { ms } from "@/messages/setup";
import { m } from "@/messages";
import { primary } from "@/platform/i18n/language";
import { listTeacherTasks } from "@/modules/teacher-tasks/data/repo";
import { TaskList } from "@/modules/teacher-tasks/ui/task-list";
export const runtime="nodejs";
export default async function Page(){const staff=await requirePermission("attendance:view", "/teach/tasks");const rows=await listTeacherTasks().catch(()=>null);return <main className="mx-auto max-w-5xl space-y-5 p-4"><h1 className="text-2xl font-semibold">{primary(m.teacherTasks,staff.language)}</h1>{rows?<TaskList rows={rows} language={staff.language}/>:<p role="alert">{primary(ms.taskUnavailable,staff.language)}</p>}</main>;}
