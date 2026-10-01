"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CloudOff } from "lucide-react";

import { saveRegisterAction } from "@/app/(app)/teach/actions";
import { recordPerformance } from "@/platform/performance/record";
import { m } from "@/messages";
import {
  attendanceLabels,
  attendanceStatuses,
  compareRoll,
  tally,
  type AttendanceStatus,
  type RollStudent,
} from "@/modules/attendance/domain/attendance";
import { idleTeachState } from "@/modules/attendance/domain/teach-state";
import { draftKey, isStringRecord } from "@/platform/drafts/policy";
import { useDurableDraft } from "@/platform/drafts/use-durable-draft";
import { DraftStatus } from "@/ui/draft-status";
import { countOf, primary, type Localized } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { cn } from "@/platform/utils";
import { Panel } from "@/ui/panel";
import { Badge, Notice } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";

type RegisterDraft = { marks: Record<string, AttendanceStatus> };
function isRegisterDraft(value: unknown): value is RegisterDraft {
  if (!value || typeof value !== "object" || !("marks" in value) || !isStringRecord(value.marks)) return false;
  return Object.values(value.marks).every(status => attendanceStatuses.includes(status as AttendanceStatus));
}

/** Account/session scoped draft; recovered work is reviewed before submission. */
export function RegisterForm({
  roll,
  ownerId,
  sessionLabel,
  classId,
  classLabel,
  day,
  period,
  existing,
  locked,
  onBehalf,
}: {
  roll: RollStudent[];
  ownerId: string;
  sessionLabel: string;
  classId: string;
  classLabel: string;
  day: string;
  period: number | null;
  existing: Record<string, AttendanceStatus>;
  locked: boolean;
  onBehalf: boolean;
}) {
  const language = useLanguage();
  const sorted = useMemo(() => [...roll].sort(compareRoll), [roll]);

  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>(existing);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<Localized | null>(null);

  const current = useRef(existing);
  const sending = useRef(false);
  const retry = useRef<RegisterDraft | null>(null);
  const draft = useDurableDraft(draftKey(ownerId, sessionLabel, `attendance/${classId}/${day}/${period ?? "daily"}`), JSON.stringify({ existing, ids: sorted.map(row => row.studentId) }), isRegisterDraft);
  const { persist, clear, online } = draft;
  const effectiveLocked = locked || saved;

  const flush = useCallback(async () => {
    const entry = retry.current;
    if (!entry || sending.current || !navigator.onLine) return;
    sending.current = true;
    setSaving(true);
    setFailure(null);
    const formData = new FormData();
    formData.set("payload", JSON.stringify({ classId, sessionLabel, day, period, submit: true,
      marks: Object.entries(entry.marks).map(([studentId, status]) => ({ studentId, status, note: null })) }));
    try {
      const started = performance.now();
      const result = await saveRegisterAction(idleTeachState, formData);
      if (result.status === "saved") recordPerformance("form_saved", performance.now() - started);
      if (result.status === "saved") {
        retry.current = null;
        setSaved(true);
        await clear();
      } else {
        retry.current = null; // Server refusals require review, never automatic replay.
        setFailure(result.message ?? m.notSaved);
      }
    } catch { setFailure(m.notSaved); }
    finally { sending.current = false; setSaving(false); }
  }, [classId, sessionLabel, day, period, clear]);

  useEffect(() => {
    const onOnline = () => { void flush(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flush]);

  const setStatus = useCallback((studentId: string, status: AttendanceStatus) => {
    if (effectiveLocked || sending.current) return;
    retry.current = null;
    const next = { ...current.current, [studentId]: status };
    current.current = next;
    setMarks(next);
    void persist({ marks: next });
  }, [effectiveLocked, persist]);

  const markAllPresent = () => {
    if (effectiveLocked || sending.current) return;
    retry.current = null;
    const next = { ...current.current };
    for (const student of sorted) if (!next[student.studentId]) next[student.studentId] = "present";
    current.current = next;
    setMarks(next);
    void persist({ marks: next });
  };

  const restore = () => {
    if (effectiveLocked) return;
    const known = new Set(sorted.map(row => row.studentId));
    const next = Object.fromEntries(Object.entries(draft.recovered?.value.marks ?? {}).filter(([id]) => known.has(id)));
    current.current = next;
    setMarks(next);
    draft.dismissRecovery();
    void persist({ marks: next });
  };

  const submit = async () => {
    if (effectiveLocked || sending.current) return;
    const entry = { marks: { ...current.current } };
    retry.current = entry;
    await persist(entry);
    await flush();
  };

  const counts = tally(sorted, new Map(Object.entries(marks)));

  /**
   * The four status words, spelled out once above the roll.
   *
   * The atlas prints "P = Present · A = Absent · L = Late · E = Excused". The
   * buttons here already carry their whole word rather than an initial, so the
   * legend is the list of what the four mean — useful to somebody opening the
   * register for the first time, and quiet for everybody else.
   */
  const legendText = attendanceStatuses
    .map((option) => primary(attendanceLabels[option], language))
    .join(" · ");
  const legend = { hi: legendText, en: legendText };

  if (sorted.length === 0) {
    return <EmptyState title={m.attendanceEmptyRoll} language={language} />;
  }

  return (
    <div className="space-y-4" aria-busy={saving} data-work-form="true">
      <DraftStatus status={draft.status} online={online} recovered={!effectiveLocked && Boolean(draft.recovered)} changed={draft.changedSinceDraft} onRestore={restore} onDiscard={() => void draft.discard()} language={language} />
      {onBehalf ? (
        <Notice tone="warning" text={m.attendanceOnBehalf} language={language} />
      ) : null}

      {locked ? (
        <Notice tone="info" text={m.attendanceLocked} language={language} />
      ) : null}

      {!online ? (
        <Notice tone="warning" text={m.attendanceOffline} language={language} />
      ) : null}

      {failure ? (
        <Notice tone="danger" text={failure} language={language} />
      ) : null}

      <div className="sticky top-14 z-30 -mx-4 border-b border-border bg-background px-4 py-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[14px] text-muted-foreground">
            {/* `countOf`, not two numbers around a translated "of": Hindi
                counts down from the whole and English counts up from the
                part, so a fixed order reads backwards in one of them. */}
            <span className="font-semibold text-foreground">
              {countOf(counts.marked, counts.total, language)}
            </span>{" "}
            {primary(m.attendanceMarked, language)}
          </p>
          <div className="flex items-center gap-1.5">
            {counts.absent > 0 ? (
              <Badge tone="danger">
                {primary(attendanceLabels.absent, language)} {counts.absent}
              </Badge>
            ) : null}
            {draft.status === "local" ? (
              <Badge tone="warning">
                <CloudOff aria-hidden className="size-3" />
                1
              </Badge>
            ) : null}
            {saved ? (
              <Badge tone="success">
                <Check aria-hidden className="size-3" />
                {primary(m.attendanceSubmitted, language)}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      {!effectiveLocked ? (
        <Button variant="outline" size="sm" onClick={markAllPresent} fullWidth>
          {primary(m.attendanceMarkAllPresent, language)}
        </Button>
      ) : null}

      {/* One panel with hairline rows rather than forty separate cards.
          On a phone the four status controls stay under the name, because at
          360px a name and four buttons on one line leaves nothing readable;
          from `sm` they move beside it, which is the atlas's desktop register
          and halves the scroll for a class of forty. */}
      <Panel
        title={m.attendanceTodaysRegister}
        description={legend}
        language={language}
      >
        {sorted.map(student => <AttendanceRow key={student.studentId} student={student} status={marks[student.studentId]} disabled={effectiveLocked || saving} language={language} onStatus={setStatus} />)}
      </Panel>

      {!effectiveLocked ? (
        <div className="work-action safe-bottom sticky bottom-0 -mx-4 border-t border-border bg-background px-4 pt-3">
          <Button
            onClick={submit}
            fullWidth
            size="lg"
            loading={saving}
            loadingText={primary(m.attendanceSaving, language)}
            disabled={counts.marked === 0}
          >
            {primary(m.attendanceSubmit, language)}
            {counts.marked < counts.total
              ? ` (${counts.marked}/${counts.total})`
              : ""}
          </Button>
          <p className="mt-1.5 pb-3 text-center text-[12px] text-subtle-foreground">
            {classLabel} · {day}
          </p>
        </div>
      ) : null}
    </div>
  );
}

const SELECTED: Record<AttendanceStatus, string> = {
  present: "border-success bg-success-soft text-success-soft-foreground",
  absent: "border-destructive bg-destructive text-destructive-foreground",
  late: "border-accent bg-accent-soft text-accent-soft-foreground",
  leave: "border-border-strong bg-surface-3 text-foreground",
};


const AttendanceRow = memo(function AttendanceRow({ student, status, disabled, language, onStatus }: {
  student: RollStudent; status: AttendanceStatus | undefined; disabled: boolean;
  language: ReturnType<typeof useLanguage>; onStatus: (id: string, status: AttendanceStatus) => void;
}) { return (
            <li
              className="px-4 py-3 sm:flex sm:items-center sm:gap-4"
            >
              <div className="mb-2 flex items-baseline gap-2 sm:mb-0 sm:min-w-0 sm:flex-1">
                <span className="w-7 shrink-0 text-[13px] font-semibold tabular-nums text-subtle-foreground">
                  {student.rollNo ?? "—"}
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-foreground">
                  {student.fullName}
                </span>
              </div>

              {/* Four targets rather than a dropdown: a teacher marks forty
                  children standing up, and a select costs two taps and a
                  steady hand for each one. */}
              <div className="grid grid-cols-4 gap-1.5 sm:w-auto sm:shrink-0">
                {attendanceStatuses.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => onStatus(student.studentId, option)}
                    disabled={disabled}
                    aria-pressed={status === option}
                    className={cn(
                      "focus-ring min-h-11 rounded-xl border px-2 text-[13px] font-semibold transition-colors",
                      "disabled:opacity-60 sm:min-w-20",
                      status === option
                        ? SELECTED[option]
                        : "border-border bg-surface text-muted-foreground",
                    )}
                  >
                    {primary(attendanceLabels[option], language)}
                  </button>
                ))}
              </div>
            </li>
); });
