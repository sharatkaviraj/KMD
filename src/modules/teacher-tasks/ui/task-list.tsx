import Link from "next/link";
import { m } from "@/messages";
import { ms } from "@/messages/setup";
import { primary, type Language } from "@/platform/i18n/language";
import type { TaskState, TaskSummary } from "../domain/tasks";
const states={"to-assign":ms.taskToAssign,waiting:m.taskWaiting,"to-approve":m.taskApprove,complete:m.taskComplete,revoked:ms.taskRevoke};
export function TaskList({rows,language,compact=false,office=false}:{rows:TaskSummary[];language:Language;compact?:boolean;office?:boolean}) {
  const groups:TaskState[]=["to-assign","waiting","to-approve","complete","revoked"];
  return <div className="grid gap-4 md:grid-cols-3">{groups.filter(state=>rows.some(r=>r.state===state)||(office&&state==="to-assign")).map(state=>{const items=rows.filter(r=>r.state===state);return <section key={state} className="rounded-2xl border border-border bg-card p-4"><h2 className="mb-3 font-semibold">{primary(states[state],language)} <span className="text-muted-foreground">{items.length}</span></h2>{(compact?items.slice(0,3):items).map(t=><Link key={t.id} href={t.href} className="mb-2 block rounded-xl bg-accent-soft p-3 text-sm"><strong className="block">{t.title}</strong><span className="block">{t.teacherName}</span>{t.expected>0&&<span>{t.answered}/{t.expected} · </span>}<span>{t.dueDate??""}</span>{!!t.rejected&&<span className="block">{primary(ms.taskRejected,language)}: {t.rejected}</span>}</Link>)}{compact&&items.length>3&&<Link className="text-sm text-primary" href="/inbox?tasks=all">{primary(m.taskViewAll,language)}</Link>}{office&&state==="to-approve"&&items.length>0&&<Link className="text-sm text-primary" href="/collection/review">{primary(m.taskApprove,language)}</Link>}</section>;})}</div>;
}
