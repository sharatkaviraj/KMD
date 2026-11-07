import type { ReactNode } from "react";
import type { Language } from "@/platform/i18n/language";
import { lead } from "@/vx/text";
import { TopBar } from "@/vx/ui/page";
import type { BoardTask } from "@/modules/teacher-tasks/domain/collect";
import { CollectBoard } from "@/modules/teacher-tasks/ui/collect-board";
import { CW } from "@/modules/teacher-tasks/ui/collect-words";
import { T } from "@/vx/screens/admin/text";

/**
 * Needs you · Teachers' work (D-520). The desk keeps Needs you's bar; the
 * phone draws Needs you's large title over the two tabs, as the decisions
 * half does.
 */
export function CollectScreen({ language, tasks, today, previewing, views, taskDetail }: {
  language: Language;
  tasks: BoardTask[] | null;
  today: string;
  previewing: boolean;
  views: ReactNode;
  taskDetail?: ReactNode;
}) {
  const open = tasks ? tasks.filter((t) => t.state !== "complete" && t.state !== "revoked").length : 0;
  return (
    <>
      <div className="only-d" style={{ display: "contents" }}>
        {/* "Ask teachers" is the board's own big button, so the bar carries no second copy of it. */}
        <TopBar crumb={`${lead(CW.collect, language)}${open ? ` · ${lead(CW.openWork, language)} ${open}` : ""}`} title={lead(T.needsYou, language)} />
      </div>
      <main>
        <div className="only-m glass" style={{ position: "sticky", top: 0, zIndex: 5, padding: "14px 18px 12px", display: "flex", flexDirection: "column", gap: 10, borderBottom: "1px solid var(--bd)" }}>
          <h1 className="serif" style={{ margin: 0, fontSize: 30, fontWeight: 600 }}>{lead(T.needsYou, language)}</h1>
          {views}
        </div>
        <div className="pad" style={{ padding: "18px 28px 32px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1180, minWidth: 0 }}>
          <div className="only-d" style={{ maxWidth: 460 }}>{views}</div>
          <CollectBoard tasks={tasks} today={today} language={language} previewing={previewing} />
        </div>
      </main>
      {taskDetail}
    </>
  );
}
