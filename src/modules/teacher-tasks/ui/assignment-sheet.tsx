"use client";
import { useImperativeHandle, useState, useTransition, type ReactNode, type Ref } from "react";
import { taskAssignmentContextAction } from "@/app/(app)/teach/tasks/actions";
import { ms } from "@/messages/setup";
import type { Language } from "@/platform/i18n/language";
import { lead } from "@/vx/text";
import { Sheet } from "@/vx/ui/overlays";
import { Btn } from "@/vx/ui/primitives";
import type { AssignmentContext } from "../data/assignment";
import type { TaskKind } from "../domain/tasks";
import type { AssignmentEditor } from "./assignment-editor";

/** Lets a menu row open the sheet: the row closes with its menu, the sheet must not. */
export type AssignmentHandle = { show: () => void };

export function AssignmentLauncher({ language, selectedIds, initialKind = "collection", initialMissing = "", label, variant = "sec", trigger, ref }: {
  language: Language;
  selectedIds?: string[];
  initialKind?: TaskKind;
  initialMissing?: string;
  label?: string;
  variant?: "pri" | "sec";
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
  let button: ReactNode = <Btn variant={variant} icon="users" disabled={pending} onClick={show}>{label ?? lead(ms.taskAssign, language)}{count}</Btn>;
  if (trigger === null) button = null;
  // Opened for one child (Student 360): the sheet is about that child, by name.
  const single = many === 1 ? loaded?.context.students.find((s) => s.id === selectedIds![0]) : undefined;
  return <>
    {button}
    <Sheet open={open} onClose={() => setOpen(false)} title={single ? `${lead(ms.taskAssign, language)} · ${single.name}` : lead(ms.taskAssign, language)}>
      {error ? <div role="alert" style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}><p style={{ margin: 0 }}>{lead(ms.taskUnavailable, language)}</p><Btn icon="refresh" disabled={pending} onClick={show}>{lead(ms.taskTryAgain, language)}</Btn></div> : loaded ? <>{loaded.context.unmatched > 0 ? <p role="status" style={{ margin: "0 0 10px", fontSize: 13, color: "var(--warnfg)", background: "var(--warns)", padding: "8px 12px", borderRadius: 12 }}>{lead(ms.taskUnmatched, language)} {loaded.context.unmatched}</p> : null}<loaded.Editor key={`${selectedIds?.join(",")}:${initialKind}:${initialMissing}`} context={loaded.context} selectedIds={selectedIds} initialKind={initialKind} initialMissing={initialMissing} language={language} close={() => setOpen(false)} /></> : <p aria-live="polite">…</p>}
    </Sheet>
  </>;
}
