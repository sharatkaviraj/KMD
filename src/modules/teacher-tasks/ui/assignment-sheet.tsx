"use client";
import { useImperativeHandle, useState, useTransition, type ReactNode, type Ref } from "react";
import { taskAssignmentContextAction } from "@/app/(app)/teach/tasks/actions";
import { taskAssignMessages as ms } from "@/messages/task-assign";
import type { Language } from "@/platform/i18n/language";
import { lead, p } from "@/vx/text";
import { Sheet } from "@/vx/ui/overlays";
import { Btn } from "@/vx/ui/primitives";
import type { AssignmentContext } from "../data/assignment";
import type { TaskKind } from "../domain/tasks";
import type { AssignmentEditor } from "./assignment-editor";

/** What the sheet says while it reads the school's children and teachers. */
const LOADING = p("Finding what is missing…", "देख रहे हैं क्या बाकी है…");

/** Lets a menu row open the sheet: the row closes with its menu, the sheet must not. */
export type AssignmentHandle = { show: () => void };

export function AssignmentLauncher({ language, selectedIds, initialKind = "collection", initialMissing = "", label, variant = "sec", big = false, trigger, ref }: {
  language: Language;
  selectedIds?: string[];
  initialKind?: TaskKind;
  initialMissing?: string;
  label?: string;
  variant?: "pri" | "sec";
  /** The big button of Needs you's Teachers' work (D-520). */
  big?: boolean;
  /** `null`: no button of its own; the caller opens it through `ref`. */
  trigger?: null;
  ref?: Ref<AssignmentHandle>;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<{ context: AssignmentContext; Editor: typeof AssignmentEditor } | null>(null);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const show = () => {
    setOpen(true); setError(false); start(async () => {
      try {
        // Open the sheet right away; fetch the data and editor together, only when requested.
        const [context, { AssignmentEditor: Editor }] = await Promise.all([
          taskAssignmentContextAction(), import("./assignment-editor"),
        ]);
        setLoaded({ context, Editor });
      }
      catch {
        setError(true);
      }
    });
  };
  useImperativeHandle(ref, () => ({ show }));
  // A count says how many children a bulk request covers; one child is the page itself.
  const many = selectedIds?.length ?? 0;
  const count = many > 1 ? ` (${many})` : "";
  let button: ReactNode = <Btn variant={variant} big={big} icon={big ? "plus" : "users"} disabled={pending} onClick={show}>{label ?? lead(ms.taskAssign, language)}{count}</Btn>;
  if (trigger === null) button = null;
  // Opened for one child (Student 360): the sheet is about that child, by name.
  const single = many === 1 ? loaded?.context.students.find((s) => s.id === selectedIds![0]) : undefined;
  return <>
    {button}
    <Sheet open={open} onClose={() => setOpen(false)} wide icon="users" title={single ? `${label ?? lead(ms.taskAssign, language)} · ${single.name}` : label ?? lead(ms.taskAssign, language)}>
      {error ? <div role="alert" style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}><p style={{ margin: 0 }}>{lead(ms.taskUnavailable, language)}</p><Btn icon="refresh" disabled={pending} onClick={show}>{lead(ms.taskTryAgain, language)}</Btn></div> : loaded ? <>{loaded.context.unmatched > 0 ? <p role="status" style={{ margin: "0 0 10px", fontSize: 13, color: "var(--warnfg)", background: "var(--warns)", padding: "8px 12px", borderRadius: 12 }}>{lead(ms.taskUnmatched, language)} {loaded.context.unmatched}</p> : null}<loaded.Editor key={`${selectedIds?.join(",")}:${initialKind}:${initialMissing}`} context={loaded.context} selectedIds={selectedIds} initialKind={initialKind} initialMissing={initialMissing} language={language} close={() => setOpen(false)} /></> : <p aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--mut)" }}><span aria-hidden="true" style={{ display: "inline-flex", gap: 3 }}>{[0, 1, 2].map((i) => <span key={i} style={{ width: 6, height: 6, borderRadius: 3, background: "var(--acc)", animation: `xPulse 1s ease ${i * 160}ms infinite` }} />)}</span>{lead(LOADING, language)}</p>}
    </Sheet>
  </>;
}
