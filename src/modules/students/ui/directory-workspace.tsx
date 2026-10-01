"use client";

import Link from "next/link";
import { useState } from "react";
import type { DirectoryRow } from "@/modules/students/data/directory-repo";
import { recordPerformance } from "@/platform/performance/record";
import { m } from "@/messages";
import { primary, type Language } from "@/platform/i18n/language";
import { DetailList } from "@/ui/primitives";
import { buttonClasses } from "@/ui/primitives/button";

/** Detail selection is local: changing rows never waits for a database read. */
export function DirectoryWorkspace({ rows, labels, language }: {
  rows: DirectoryRow[]; labels: Record<string, string>; language: Language;
}) {
  const [selectedId, setSelectedId] = useState(rows[0]?.studentId);
  const selected = rows.find(row => row.studentId === selectedId) ?? rows[0];
  return <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
    <ul className="divide-y divide-border">
      {rows.map(row => <li key={row.studentId}>
        <Link href={`/teach/student/${row.studentId}`} prefetch={false} onClick={event => {
          if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && window.matchMedia("(min-width: 1024px)").matches) {
            event.preventDefault();
            const started = performance.now(); setSelectedId(row.studentId);
            requestAnimationFrame(() => requestAnimationFrame(() => recordPerformance("directory_selected", performance.now() - started)));
          }
        }} aria-current={selected?.studentId === row.studentId ? "true" : undefined} className={`focus-ring flex min-h-16 items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2 ${selected?.studentId === row.studentId ? "lg:bg-accent-soft" : ""}`}>
          <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-sm tabular-nums">{row.rollNo ?? "—"}</span>
          <span className="min-w-0"><span className="block font-medium">{row.fullName}</span><span className="block text-xs text-muted-foreground">{[row.classId ? labels[row.classId] : null, row.admissionNo ? `SR ${row.admissionNo}` : null, row.fatherName].filter(Boolean).join(" · ")}</span></span>
        </Link>
      </li>)}
    </ul>
    <aside className="hidden border-l border-border bg-surface-2 p-5 lg:block" aria-label={primary(m.directorySelect, language)}>
      {selected ? <div className="sticky top-20">
        <h2 className="text-xl font-semibold">{selected.fullName}</h2>
        <DetailList className="mt-4" language={language} items={[
          { label: m.teachClassTitle, value: selected.classId ? labels[selected.classId] ?? "—" : "—" },
          { label: { hi: "SR", en: "SR" }, value: selected.admissionNo ?? "—" },
          { label: m.studentFather, value: selected.fatherName ?? "—" },
          { label: m.studentGuardianPhone, value: selected.guardianPhone ?? "—" },
        ]} />
        <Link href={`/teach/student/${selected.studentId}`} prefetch={false} className={buttonClasses({ className: "mt-5 w-full" })}>{primary(m.directoryOpen, language)}</Link>
      </div> : null}
    </aside>
  </div>;
}
