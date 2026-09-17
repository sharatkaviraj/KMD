"use client";

import { useMemo, useState } from "react";

import { m } from "@/messages";
import { PERIOD_COUNT } from "@/modules/timetable/domain/parse-timetable";
import { periodNumber } from "@/modules/timetable/domain/periods";
import {
  findClashes,
  freeTeachers,
  gridForClass,
  gridForTeacher,
  teacherLoad,
  type GridCell,
  type StoredSlot,
} from "@/modules/timetable/domain/views";
import { flat, primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Badge, Notice, Select } from "@/ui/primitives";
import { EmptyState } from "@/ui/states";

type ClassOption = { id: string; label: string };
type TeacherOption = { id: string; label: string; shortName: string };

type View = "class" | "teacher" | "day" | "free";

/**
 * The four grids the school reads.
 *
 * All four filter in the browser over the whole published timetable — 768
 * cells is a few tens of kilobytes, and a teacher checking which room they are
 * in next does it in a corridor where a round trip may not come back.
 */
export function TimetableViews({
  slots,
  days,
  classes,
  teachers,
}: {
  slots: StoredSlot[];
  days: string[];
  classes: ClassOption[];
  teachers: TeacherOption[];
}) {
  const language = useLanguage();
  const [view, setView] = useState<View>("class");
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [teacherId, setTeacherId] = useState(teachers[0]?.id ?? "");
  const [day, setDay] = useState(days[0] ?? "");
  const [period, setPeriod] = useState(0);

  const clashes = useMemo(() => findClashes(slots), [slots]);

  const tabs: { key: View; label: (typeof m)[keyof typeof m] }[] = [
    { key: "class", label: m.timetableByClass },
    { key: "teacher", label: m.timetableByTeacher },
    { key: "day", label: m.timetableByDay },
    { key: "free", label: m.timetableFree },
  ];

  return (
    <div className="space-y-4">
      {clashes.length > 0 ? (
        <Notice tone="danger" text={m.timetableClashFound} language={language}>
          <ul className="space-y-1 text-[13px]">
            {clashes.slice(0, 5).map((clash, index) => (
              <li key={index}>
                {clash.teacherShortName} — {clash.day} P{periodNumber(clash.period)} —{" "}
                {clash.classLabels.join(" / ")} ({clash.subjects.join(" / ")})
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {/* A scrolling strip rather than four tabs across: four Hindi labels do
          not fit on a 360px phone without truncating to nothing. */}
      <div className="-mx-4 overflow-x-auto px-4">
        <div className="flex w-max gap-1.5">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setView(tab.key)}
              aria-current={view === tab.key ? "true" : undefined}
              className={`focus-ring min-h-11 whitespace-nowrap rounded-xl px-4 text-[14px] font-semibold transition-colors ${
                view === tab.key
                  ? "bg-accent-soft text-accent-soft-foreground"
                  : "bg-surface-2 text-muted-foreground"
              }`}
            >
              {primary(tab.label, language)}
            </button>
          ))}
        </div>
      </div>

      {view === "class" ? (
        <>
          <Select
            value={classId}
            onChange={(event) => setClassId(event.target.value)}
            aria-label={flat(m.timetableChooseClass, language)}
          >
            {classes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
          <WeekGrid
            rows={gridForClass(slots, classId, days).rows}
            days={days}
            render={(cell) => renderClassCell(cell, language)}
          />
        </>
      ) : null}

      {view === "teacher" ? (
        <>
          <Select
            value={teacherId}
            onChange={(event) => setTeacherId(event.target.value)}
            aria-label={flat(m.timetableChooseTeacher, language)}
          >
            {teachers.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} · {option.shortName}
              </option>
            ))}
          </Select>

          <p className="text-[13px] text-muted-foreground">
            {flat(m.timetableLoad, language)}:{" "}
            <span className="font-semibold text-foreground">
              {teacherLoad(slots, teacherId, days).total}
            </span>
          </p>

          <WeekGrid
            rows={gridForTeacher(slots, teacherId, days).rows}
            days={days}
            render={(cell) => renderTeacherCell(cell, language)}
          />
        </>
      ) : null}

      {view === "day" ? (
        <>
          <Select
            value={day}
            onChange={(event) => setDay(event.target.value)}
            aria-label={flat(m.timetableChooseDay, language)}
          >
            {days.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>

          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-max min-w-full border-separate border-spacing-1 text-[12px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-background px-2 text-left font-semibold">
                    {primary(m.classBadge, language)}
                  </th>
                  {Array.from({ length: PERIOD_COUNT }, (_, index) => (
                    <th key={index} className="px-2 font-semibold">
                      {index + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {classes.map((option) => {
                  const row = gridForClass(slots, option.id, days).rows[day] ?? [];
                  return (
                    <tr key={option.id}>
                      <th className="sticky left-0 z-10 max-w-28 truncate bg-background px-2 text-left font-medium">
                        {option.label}
                      </th>
                      {row.map((cell) => (
                        <td
                          key={cell.period}
                          className="min-w-24 rounded-lg bg-surface px-2 py-1.5 align-top"
                        >
                          {renderClassCell(cell, language)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {view === "free" ? (
        <>
          <div className="flex gap-2">
            <Select
              value={day}
              onChange={(event) => setDay(event.target.value)}
              className="flex-1"
              aria-label={flat(m.timetableChooseDay, language)}
            >
              {days.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
            <Select
              value={String(period)}
              onChange={(event) => setPeriod(Number(event.target.value))}
              className="w-32"
              aria-label={flat(m.timetablePeriod, language)}
            >
              {Array.from({ length: PERIOD_COUNT }, (_, index) => (
                <option key={index} value={index}>
                  {primary(m.timetablePeriod, language)} {index + 1}
                </option>
              ))}
            </Select>
          </div>

          <FreeList
            ids={freeTeachers(
              slots,
              teachers.map((option) => option.id),
              day,
              period,
            )}
            teachers={teachers}
          />
        </>
      ) : null}
    </div>
  );
}

function WeekGrid({
  rows,
  days,
  render,
}: {
  rows: Record<string, GridCell[]>;
  days: string[];
  render: (cell: GridCell) => React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      {days.map((day) => (
        <section key={day}>
          <h3 className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-subtle-foreground">
            {day}
          </h3>
          <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {(rows[day] ?? []).map((cell) => (
              <li
                key={cell.period}
                className="min-h-16 rounded-xl border border-border bg-surface px-2.5 py-2"
              >
                <span className="block text-[11px] font-semibold text-subtle-foreground">
                  {periodNumber(cell.period)}
                </span>
                {render(cell)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function renderClassCell(cell: GridCell, language: Parameters<typeof primary>[1]) {
  if (cell.slots.length === 0) {
    return <span className="text-[12px] text-subtle-foreground">—</span>;
  }

  return (
    <>
      {cell.slots.map((slot, index) => (
        <span key={index} className="block">
          <span className="block truncate text-[13px] font-medium text-foreground">
            {slot.subjectCode}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {slot.teacherShortName}
          </span>
        </span>
      ))}
      {cell.slots[0].parallel ? (
        <Badge tone="accent" className="mt-1 text-[10px]">
          {primary(m.timetableParallelBadge, language)}
        </Badge>
      ) : cell.slots[0].shared ? (
        <Badge tone="info" className="mt-1 text-[10px]">
          {primary(m.timetableSharedBadge, language)}
        </Badge>
      ) : null}
    </>
  );
}

function renderTeacherCell(cell: GridCell, language: Parameters<typeof primary>[1]) {
  if (cell.slots.length === 0) {
    return <span className="text-[12px] text-subtle-foreground">—</span>;
  }

  // Combined sections: one room, several class labels.
  const labels = [...new Set(cell.slots.map((slot) => slot.classLabel))];

  return (
    <>
      <span className="block truncate text-[13px] font-medium text-foreground">
        {cell.slots[0].subjectCode}
      </span>
      <span className="block truncate text-[11px] text-muted-foreground">
        {labels.join(" · ")}
      </span>
      {cell.slots[0].shared ? (
        <Badge tone="info" className="mt-1 text-[10px]">
          {primary(m.timetableSharedBadge, language)}
        </Badge>
      ) : null}
    </>
  );
}

function FreeList({
  ids,
  teachers,
}: {
  ids: string[];
  teachers: TeacherOption[];
}) {
  const language = useLanguage();
  const byId = new Map(teachers.map((teacher) => [teacher.id, teacher]));

  if (ids.length === 0) {
    return <EmptyState title={m.timetableNobodyFree} language={language} />;
  }

  return (
    <ul className="space-y-1.5">
      {ids.map((id) => {
        const teacher = byId.get(id);
        return (
          <li
            key={id}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
          >
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success-soft text-[13px] font-bold text-success-soft-foreground"
            >
              {teacher?.shortName.slice(0, 2) ?? "—"}
            </span>
            <span className="min-w-0 flex-1 truncate text-[15px] text-foreground">
              {teacher?.label ?? id}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
