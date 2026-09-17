"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Check, CloudOff } from "lucide-react";

import { saveRegisterAction } from "@/app/(app)/teach/actions";
import { m } from "@/messages";
import {
  attendanceLabels,
  attendanceStatuses,
  compareRoll,
  mergeQueued,
  pendingFlushes,
  queueKeyFor,
  tally,
  type AttendanceStatus,
  type QueuedRegister,
  type RollStudent,
} from "@/modules/attendance/domain/attendance";
import { idleTeachState } from "@/modules/attendance/domain/teach-state";
import {
  parseQueue,
  queueSnapshot,
  readQueue,
  serverQueueSnapshot,
  subscribeQueue,
  writeQueue,
} from "@/modules/attendance/ui/queue-store";
import { countOf, primary, type Localized } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { cn } from "@/platform/utils";
import { Panel } from "@/ui/panel";
import { Badge, Notice } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";

/**
 * The register a teacher marks every morning.
 *
 * Built for a phone with one bar of signal in a corridor, which drives three
 * decisions:
 *
 *  - **every tap is written to storage immediately**, so work survives the
 *    browser being killed, the phone locking, or the signal going;
 *  - **the flush is one request for the whole register**, not one per child,
 *    so a drop halfway cannot leave a class half-marked;
 *  - **submitting twice is harmless** — the server upserts on
 *    (register, student), so the second attempt writes the same rows.
 *
 * The queue and the connection are both external systems, subscribed to rather
 * than copied into state: see `queue-store.ts`.
 */
export function RegisterForm({
  roll,
  classId,
  classLabel,
  day,
  period,
  existing,
  locked,
  onBehalf,
}: {
  roll: RollStudent[];
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

  // One id per marking session, reused across every retry of it.
  const [clientId] = useState(
    () => `${classId}:${day}:${period ?? "d"}:${Date.now()}`,
  );

  const online = useSyncExternalStore(subscribeOnline, isOnline, () => true);
  const queued = useSyncExternalStore(
    subscribeQueue,
    queueSnapshot,
    serverQueueSnapshot,
  );
  const queuedCount = Object.keys(parseQueue(queued)).length;

  /** Put the current state in the queue. Called on every tap. */
  const enqueue = useCallback(
    (next: Record<string, AttendanceStatus>, submitted: boolean) => {
      const key = queueKeyFor(classId, day, period);
      const queue = readQueue();

      const incoming: QueuedRegister = {
        clientId,
        classId,
        day,
        period,
        marks: Object.fromEntries(
          Object.entries(next).map(([studentId, status]) => [
            studentId,
            { status, note: null },
          ]),
        ),
        submitted,
        updatedAt: Date.now(),
      };

      writeQueue({ ...queue, [key]: mergeQueued(queue[key], incoming) });
    },
    [classId, clientId, day, period],
  );

  const flush = useCallback(async () => {
    const pending = pendingFlushes(readQueue()).filter(
      (entry) => Object.keys(entry.marks).length > 0,
    );
    if (pending.length === 0) return;

    setSaving(true);
    setFailure(null);

    for (const entry of pending) {
      const formData = new FormData();
      formData.set(
        "payload",
        JSON.stringify({
          classId: entry.classId,
          day: entry.day,
          period: entry.period,
          submit: entry.submitted,
          marks: Object.entries(entry.marks).map(([studentId, mark]) => ({
            studentId,
            status: mark.status,
            note: mark.note,
          })),
        }),
      );

      let result;
      try {
        result = await saveRegisterAction(idleTeachState, formData);
      } catch {
        // The request never landed — almost always the connection. The entry
        // stays queued and the next flush picks it up.
        setSaving(false);
        return;
      }

      if (result.status === "error") {
        // A refusal the teacher has to see: the wrong class, a locked
        // register, a session that has moved on. Left in the queue
        // deliberately, so nothing is silently dropped.
        setFailure(result.message ?? m.notSaved);
        setSaving(false);
        return;
      }

      const after = readQueue();
      delete after[queueKeyFor(entry.classId, entry.day, entry.period)];
      writeQueue(after);
    }

    setSaving(false);
    setSaved(true);
  }, []);

  // Subscribing only — nothing here sets state synchronously, which is what
  // the effect is allowed to do.
  useEffect(() => {
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flush]);

  const setStatus = (studentId: string, status: AttendanceStatus) => {
    if (locked) return;
    setSaved(false);
    setMarks((current) => {
      const next = { ...current, [studentId]: status };
      enqueue(next, false);
      return next;
    });
  };

  const markAllPresent = () => {
    if (locked) return;
    setSaved(false);

    const next: Record<string, AttendanceStatus> = { ...marks };
    for (const student of sorted) {
      // Only the blanks: this is "the rest are here", not "undo my work".
      if (!next[student.studentId]) next[student.studentId] = "present";
    }

    setMarks(next);
    enqueue(next, false);
  };

  const submit = async () => {
    enqueue(marks, true);
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
    <div className="space-y-4">
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

      <div className="sticky top-14 z-30 -mx-4 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
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
            {queuedCount > 0 ? (
              <Badge tone="warning">
                <CloudOff aria-hidden className="size-3" />
                {queuedCount}
              </Badge>
            ) : null}
            {saved && queuedCount === 0 ? (
              <Badge tone="success">
                <Check aria-hidden className="size-3" />
                {primary(m.attendanceSubmitted, language)}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      {!locked ? (
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
        {sorted.map((student) => {
          const status = marks[student.studentId];

          return (
            // A `<li>`, because `Panel` is a `<ul>`: a register is a list of
            // children and a screen reader should say so.
            <li
              key={student.studentId}
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
                    onClick={() => setStatus(student.studentId, option)}
                    disabled={locked}
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
          );
        })}
      </Panel>

      {!locked ? (
        <div className="safe-bottom sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 pt-3 backdrop-blur">
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

function isOnline() {
  return navigator.onLine;
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);

  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}
