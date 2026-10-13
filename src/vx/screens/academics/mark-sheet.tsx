"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { Pair } from "@/vx/text";

import { markRegisterAction } from "@/app/(app)/academics/coordinator-actions";

import { UrlSheet, useAct } from "./client";
import type { AttStatus } from "./domain";

/** How each status looks (RULES G: present green, absent red, half-day/leave amber). */
const LOOK: Record<AttStatus, { label: Pair; bg: string; fg: string; bd: string }> = {
  present: { label: { en: "Present", hi: "उपस्थित" }, bg: "var(--oks)", fg: "var(--ok)", bd: "var(--bd)" },
  late: { label: { en: "Late", hi: "देर" }, bg: "var(--oks)", fg: "var(--ok)", bd: "var(--ok)" },
  absent: { label: { en: "Absent", hi: "अनुपस्थित" }, bg: "var(--bads)", fg: "var(--bad)", bd: "var(--bad)" },
  half_day: { label: { en: "Half-day", hi: "आधा दिन" }, bg: "var(--warns)", fg: "var(--warnfg)", bd: "var(--warn)" },
  leave: { label: { en: "Leave", hi: "छुट्टी" }, bg: "var(--warns)", fg: "var(--warnfg)", bd: "var(--warn)" },
};

/** The tap cycle (UI-34): Present → Absent → Half-day → Present. A child already on leave or late moves on from there. */
const NEXT: Record<AttStatus, AttStatus> = { present: "absent", absent: "half_day", half_day: "present", leave: "present", late: "absent" };

/**
 * Mark a register for a teacher on leave (AcadAttendance `mark`), as the
 * design draws it: everyone starts present, tap a child to change, then save
 * through the same database command as the teacher's own register.
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
  const count = (st: AttStatus[]) => Object.values(marks).filter((s) => st.includes(s)).length;
  const present = count(["present", "late"]);
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
  const pills: [string, number, string, string][] = [
    [tx({ en: "present", hi: "उपस्थित" }), present, "var(--oks)", "var(--ok)"],
    [tx({ en: "absent", hi: "अनुपस्थित" }), count(["absent"]), "var(--bads)", "var(--bad)"],
    [tx({ en: "half-day", hi: "आधा दिन" }), count(["half_day", "leave"]), "var(--warns)", "var(--warnfg)"],
  ];
  return (
    <UrlSheet
      closeHref={closeHref}
      wide
      title={tx({ en: `Mark ${label} for ${teacher}`, hi: `${teacher} की ओर से ${label} की हाज़िरी` })}
      sub={tx({ en: "On leave today. Everyone starts as Present — tap a child to change.", hi: "आज छुट्टी पर। सब उपस्थित से शुरू — बदलने को बच्चे पर टैप करें।" })}
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1 }} onClick={() => router.replace(closeHref, { scroll: false })}>
            {tx({ en: "Cancel", hi: "रद्द करें" })}
          </button>
          <button type="button" className="tap btn pri" style={{ flex: 1.6 }} disabled={!allowed || pending || students.length === 0} onClick={save}>
            {pending ? <Ic n="refresh" size={16} className="spin" /> : <Ic n="check" size={18} />}
            {tx({ en: `Save attendance · ${present} present`, hi: `हाज़िरी सहेजें · ${present} उपस्थित` })}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {!allowed ? (
          <div role="status" style={{ display: "flex", gap: 10, padding: "10px 14px", borderRadius: 14, background: "var(--warns)", color: "var(--warnfg)", fontWeight: 600, fontSize: 14 }}>
            <Ic n="lock" size={18} />
            <span>{tx(refusal)}</span>
          </div>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          {pills.map(([t, n, bg, fg]) => (
            <span key={t} className="pill num" style={{ height: 30, padding: "0 12px", fontSize: 13, background: bg, color: fg }}>
              {n} {t}
            </span>
          ))}
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx({ en: "Tap: Present → Absent → Half-day", hi: "टैप: उपस्थित → अनुपस्थित → आधा दिन" })}</span>
        </div>
        <div className="acad-kg" style={{ display: "grid", gap: 8 }}>
          <style>{`.acad-kg{grid-template-columns:repeat(2,minmax(0,1fr))}@media (max-width:899px){.acad-kg{grid-template-columns:minmax(0,1fr)}}`}</style>
          {students.map((s) => {
            const st = marks[s.studentId];
            const look = LOOK[st];
            const plain = st === "present";
            return (
              <button
                key={s.studentId}
                type="button"
                className="tap"
                disabled={!allowed}
                aria-label={tx({ en: `${s.name} · ${look.label.en} · tap to change`, hi: `${s.name} · ${look.label.hi} · बदलने को टैप करें` })}
                onClick={() => setMarks((m) => ({ ...m, [s.studentId]: NEXT[m[s.studentId]] }))}
                style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 52, padding: "10px 14px", borderRadius: 14, width: "100%", textAlign: "left", color: "var(--fg)", border: `1px solid ${plain ? "var(--bd)" : look.bd}`, background: plain ? "var(--card)" : look.bg }}
              >
                <span className="num" style={{ width: 20, fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{s.rollNo ?? "·"}</span>
                <span className="clip" style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{s.name}</span>
                <span className="pill" style={{ height: 26, padding: "0 10px", fontSize: 12, background: look.bg, color: look.fg, animation: plain ? "none" : "xPopIn .3s var(--spring) both" }}>{tx(look.label)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </UrlSheet>
  );
}
