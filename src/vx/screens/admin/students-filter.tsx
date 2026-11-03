"use client";

import { useState } from "react";

import { useVx } from "@/vx/i18n";
import { Chip, Seg } from "@/vx/ui/controls";
import { Sheet } from "@/vx/ui/overlays";
import type { Pair } from "@/vx/text";
import type { StudentFilter } from "@/vx/screens/admin/logic";
import { classChipLabel, type StudentLayout, type StudentSort, type StudentView } from "@/vx/screens/admin/students-logic";
import { ST } from "@/vx/screens/admin/students-text";

/*
 * The phone's Filter sheet on Students (UI-94): one place for the class, the
 * fee app's saved views, the order and how the list is drawn. Choices are
 * staged here and only "Show students" changes the list, so a reader can pick
 * three things without the list reloading under them three times.
 */

export type FilterChoice = {
  classId: string | null;
  filters: StudentFilter[];
  sort: StudentSort;
  layout: StudentLayout;
  view: StudentView;
  /** A detail the record lacks ("photo", a field key), for asking a teacher; "" for none. */
  missing: string;
  /** Enrolment status, where the list offers it (the Fees directory); grouped here, not a row of pills (review S03). */
  enrollment?: Enrollment;
};

export type Enrollment = "active" | "inactive" | "left" | "graduated" | "all";
export const ENROLLMENT_WORD: Record<Enrollment, Pair> = {
  active: ST.statusActive,
  inactive: ST.statusInactive,
  left: ST.statusLeft,
  graduated: ST.statusGraduated,
  all: ST.statusAll,
};

export const FILTER_WORD: Record<StudentFilter, Pair> = {
  pending: ST.fPending,
  late: ST.fLate,
  never: ST.fNever,
  part: ST.fPart,
  paid: ST.fPaid,
  emi: ST.fEmi,
  emiMissed: ST.fEmiMissed,
  old: ST.fOld,
  bus: ST.fBus,
  new: ST.fNew,
  concession: ST.fConcession,
  noPhone: ST.fNoPhone,
};

const FEE_FILTERS: readonly StudentFilter[] = ["pending", "late", "never", "part", "paid", "emi", "emiMissed", "old"];
const CHILD_FILTERS: readonly StudentFilter[] = ["bus", "new", "concession", "noPhone"];

type SortChoice = "name" | "class" | "pending";

function sortChoice(sort: StudentSort): SortChoice {
  return sort.key === "class" ? "class" : sort.key === "pending" ? "pending" : "name";
}

const SORT_OF: Record<SortChoice, StudentSort> = {
  name: { key: "name", dir: 1 },
  class: { key: "class", dir: 1 },
  pending: { key: "pending", dir: -1 },
};

export function StudentFilterSheet({
  open,
  onClose,
  current,
  classes,
  counts,
  seesMoney,
  onApply,
  missingOptions,
  missingTitle,
}: {
  open: boolean;
  onClose: () => void;
  current: FilterChoice;
  classes: { id: string; label: string }[];
  counts: Partial<Record<string, number | null>> | null;
  /** A reader with `fees:view`: the Fees/School switch and the fee filters. */
  seesMoney: boolean;
  onApply: (next: FilterChoice) => void;
  /** A reader who can ask teachers for details: what a record can be missing. */
  missingOptions?: { value: string; label: Pair }[];
  missingTitle?: Pair;
}) {
  const { tx } = useVx();
  const [draft, setDraft] = useState<FilterChoice>(current);
  // Each opening starts from the list as it is, not from an abandoned draft.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(current);
  }

  const fees = seesMoney && draft.view === "fees";
  const toggle = (f: StudentFilter) =>
    setDraft((d) => ({ ...d, filters: d.filters.includes(f) ? d.filters.filter((x) => x !== f) : [...d.filters, f] }));
  // Counts belong to the list as it is now; a class picked in the draft would make them wrong.
  const countOf = (f: StudentFilter): number | undefined => (draft.classId === current.classId ? (counts?.[f] ?? undefined) : undefined);
  const chip = (f: StudentFilter) => (
    <Chip key={f} on={draft.filters.includes(f)} onClick={() => toggle(f)} count={countOf(f)}>
      {tx(FILTER_WORD[f])}
    </Chip>
  );
  const sortOptions: { value: SortChoice; label: string }[] = [
    { value: "name", label: tx(ST.sortName) },
    { value: "class", label: tx(ST.sortClass) },
    ...(fees ? [{ value: "pending" as const, label: tx(ST.sortPending) }] : []),
  ];
  const sorting = sortChoice(draft.sort);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={tx(ST.sheetTitle)}
      sub={tx(ST.sheetSub)}
      footer={
        <>
          <button
            type="button"
            className="tap btn sec"
            style={{ flex: 1, height: 52 }}
            onClick={() => setDraft({ ...draft, classId: null, filters: [], sort: SORT_OF.name, missing: "", ...(draft.enrollment ? { enrollment: "active" as const } : {}) })}
          >
            {tx(ST.clearAll)}
          </button>
          <button type="button" className="tap btn pri" style={{ flex: 1.6, height: 52, fontSize: 16 }} onClick={() => onApply(draft)}>
            {tx(ST.show)}
          </button>
        </>
      }
    >
      <div className="stu-fsheet">
        {seesMoney ? (
          <section>
            <span className="sech">{tx(ST.views)}</span>
            <Seg<StudentView>
              label={tx(ST.views)}
              value={draft.view}
              onChange={(view) => setDraft((d) => ({ ...d, view, filters: view === "fees" ? d.filters : [], sort: view === "fees" || d.sort.key !== "pending" ? d.sort : SORT_OF.name }))}
              options={[
                { value: "fees", label: tx(ST.viewFees) },
                { value: "school", label: tx(ST.viewSchool) },
              ]}
            />
          </section>
        ) : null}

        <section>
          <span className="sech">{tx(ST.secClass)}</span>
          <div className="stu-fcls" role="radiogroup" aria-label={tx(ST.secClass)}>
            <button type="button" role="radio" aria-checked={draft.classId === null} className={`tap stu-fall${draft.classId === null ? " on" : ""}`} onClick={() => setDraft((d) => ({ ...d, classId: null }))}>
              {tx(ST.allClasses)}
            </button>
            {classes.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={draft.classId === c.id} aria-label={c.label} title={c.label} className={`tap${draft.classId === c.id ? " on" : ""}`} onClick={() => setDraft((d) => ({ ...d, classId: c.id }))}>
                {classChipLabel(c.label)}
              </button>
            ))}
          </div>
        </section>

        {draft.enrollment && fees ? (
          <section>
            <span className="sech">{tx(ST.enrollment)}</span>
            <div className="stu-fchips" role="radiogroup" aria-label={tx(ST.enrollment)}>
              {(Object.keys(ENROLLMENT_WORD) as Enrollment[]).map((value) => (
                <Chip key={value} on={draft.enrollment === value} onClick={() => setDraft((d) => ({ ...d, enrollment: value }))}>
                  {tx(ENROLLMENT_WORD[value])}
                </Chip>
              ))}
            </div>
          </section>
        ) : null}

        {fees ? (
          <>
            <section>
              <span className="sech">{tx(ST.secFees)}</span>
              <div className="stu-fchips">{FEE_FILTERS.map(chip)}</div>
            </section>
            <section>
              <span className="sech">{tx(ST.secChildren)}</span>
              <div className="stu-fchips">{CHILD_FILTERS.map(chip)}</div>
              <span className="stu-fnote">{tx(ST.combineNote)}</span>
            </section>
          </>
        ) : null}

        {missingOptions?.length && missingTitle ? (
          <section>
            <span className="sech">{tx(missingTitle)}</span>
            <div className="stu-fchips" role="group" aria-label={tx(missingTitle)}>
              {missingOptions.map((o) => (
                <Chip key={o.value} on={draft.missing === o.value} onClick={() => setDraft((d) => ({ ...d, missing: d.missing === o.value ? "" : o.value }))}>
                  {tx(o.label)}
                </Chip>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <span className="sech">{tx(ST.secSort)}</span>
          <Seg<SortChoice> label={tx(ST.secSort)} value={sorting} onChange={(v) => setDraft((d) => ({ ...d, sort: SORT_OF[v] }))} options={sortOptions} />
          {sorting === "pending" ? <span className="stu-fnote">{tx(ST.sortPendingNote)}</span> : null}
        </section>

        <section>
          <span className="sech">{tx(ST.secLook)}</span>
          <Seg<StudentLayout>
            label={tx(ST.secLook)}
            value={draft.layout}
            onChange={(layout) => setDraft((d) => ({ ...d, layout }))}
            options={[
              { value: "cards", label: tx(ST.lookCards) },
              { value: "compact", label: tx(ST.lookCompact) },
              { value: "class", label: tx(ST.lookClass) },
            ]}
          />
        </section>
      </div>
    </Sheet>
  );
}
