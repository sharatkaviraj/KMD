"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { ATT_COLORS } from "@/vx/ui/primitives";

import { markRegisterAction } from "@/app/(app)/academics/coordinator-actions";

import { UrlSheet, useAct } from "./client";
import type { AttStatus } from "./domain";

const CHOICES: { status: AttStatus; key: keyof typeof ATT_COLORS; short: string }[] = [
  { status: "present", key: "P", short: "P" },
  { status: "absent", key: "A", short: "A" },
  { status: "leave", key: "L", short: "L" },
  { status: "half_day", key: "H", short: "½" },
];

/**
 * Mark a register for a teacher on leave (AcadAttendance `mark`). Everyone
 * starts present; tap a child to change. Saved through the same database
 * command as the teacher's own register.
 */
export function MarkSheet({
  closeHref,
  classId,
  label,
  day,
  teacher,
  revision,
  students,
  allowed,
  refusal,
}: {
  closeHref: string;
  classId: string;
  label: string;
  day: string;
  teacher: string;
  revision: number;
  students: { studentId: string; name: string; rollNo: string | null; status: AttStatus | null }[];
  allowed: boolean;
  refusal: { en: string; hi: string };
}) {
  const { tx } = useVx();
  const router = useRouter();
  const { run, pending } = useAct();
  const [marks, setMarks] = useState<Record<string, AttStatus>>(() => Object.fromEntries(students.map((s) => [s.studentId, s.status ?? "present"])));
  const [commandId] = useState(() => crypto.randomUUID());
  const counts = Object.values(marks).reduce<Record<string, number>>((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});
  const save = () =>
    run(
      () =>
        markRegisterAction({
          commandId,
          classId,
          day,
          kind: "save",
          expectedRevision: revision,
          reason: null,
          marks: students.map((s) => ({ studentId: s.studentId, status: marks[s.studentId] })),
        }),
      (r) => r.ok && router.replace(closeHref, { scroll: false }),
    );
  return (
    <UrlSheet
      closeHref={closeHref}
      wide
      icon="calCheck"
      title={tx({ en: `Mark ${label} for ${teacher}`, hi: `${teacher} की ओर से ${label} की हाज़िरी` })}
      sub={tx({ en: `${students.length} children · everyone starts present · tap to change`, hi: `${students.length} बच्चे · सब उपस्थित से शुरू · बदलने को टैप करें` })}
      footer={
        <button type="button" className="tap btn pri" style={{ flex: 1 }} disabled={!allowed || pending || students.length === 0} onClick={save}>
          {pending ? <Ic n="refresh" size={16} className="spin" /> : <Ic n="check" size={18} />}
          {tx({ en: `Save · ${counts.present ?? 0} present, ${counts.absent ?? 0} absent`, hi: `सहेजें · ${counts.present ?? 0} उपस्थित, ${counts.absent ?? 0} अनुपस्थित` })}
        </button>
      }
    >
      {!allowed ? (
        <div role="status" style={{ display: "flex", gap: 10, padding: "10px 14px", borderRadius: 14, background: "var(--warns)", color: "var(--warnfg)", fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
          <Ic n="lock" size={18} />
          <span>{tx(refusal)}</span>
        </div>
      ) : null}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
        {students.map((s) => (
          <li key={s.studentId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid var(--bd)", borderRadius: 14 }}>
            <span className="num" style={{ width: 26, color: "var(--mut)", fontSize: 13 }}>{s.rollNo ?? "·"}</span>
            <span className="clip" style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{s.name}</span>
            <span role="radiogroup" aria-label={s.name} style={{ display: "flex", gap: 4 }}>
              {CHOICES.map((c) => {
                const on = marks[s.studentId] === c.status;
                const color = ATT_COLORS[c.key];
                return (
                  <button
                    key={c.status}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={tx({ en: color.label, hi: color.hi })}
                    disabled={!allowed}
                    className="tap"
                    onClick={() => setMarks((m) => ({ ...m, [s.studentId]: c.status }))}
                    style={{ width: 34, height: 34, borderRadius: 10, border: `1.5px solid ${on ? color.fg : "var(--bd)"}`, background: on ? color.bg : "transparent", color: on ? color.fg : "var(--mut)", fontWeight: 700 }}
                  >
                    {c.short}
                  </button>
                );
              })}
            </span>
          </li>
        ))}
      </ul>
    </UrlSheet>
  );
}
