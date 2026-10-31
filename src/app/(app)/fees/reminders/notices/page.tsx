import { BookOpenCheck, CalendarOff, UserX, Users } from "lucide-react";

import { PageHeader } from "@/ui/shell/page-header";
import { OfficeNotice } from "@/ui/office/office-ui";
import { PendingSubmitButton } from "@/ui/shell/pending-submit-button";
import { Input } from "@/ui/primitives/input";
import { SelectNative } from "@/ui/primitives/select-native";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { hasStaffPermission, requireAnyStaffPermission } from "@/modules/fees/platform/session";
import { istToday } from "@/modules/whatsapp/domain/fee-reminders";
import { resolveReminderSessionLabel } from "@/modules/whatsapp/data/reminder-session";
import {
  loadRecentSchoolNoticeBatches,
  loadSchoolRoster,
  schoolNoticesThisMonth,
  type RosterStudent,
} from "@/modules/whatsapp/data/school-notice-sender";
import {
  isSchoolNoticeApproved,
  isSchoolNoticeKind,
  SCHOOL_NOTICE_MONTHLY_BUDGET,
  SCHOOL_NOTICES,
  schoolNoticeFor,
  type SchoolNoticeKind,
} from "@/modules/whatsapp/domain/school-notices";
import { schoolNoticeTemplate } from "@/modules/whatsapp/domain/school-notice-bodies";
import { fillBody, studentsLine } from "@/modules/whatsapp/domain/campaign-bodies-v6";
import { isNoticeLanguage, type NoticeLanguage } from "@/modules/whatsapp/domain/campaigns";
import { RemindersNav } from "@/modules/whatsapp/ui/reminders-nav";
import { NoticePreview } from "@/modules/whatsapp/ui/notice-preview";
import { formatDdMmYyyy } from "@/platform/helpers/date";
import { cn } from "@/platform/utils";
import { sendSchoolNoticeAction } from "@/app/(app)/fees/reminders/notices/actions";
import { NavLink } from "@/ui/shell/nav-link";

/**
 * School notices — the everyday messages that are not about money.
 *
 * Three steps on one screen, top to bottom, each a plain form: pick the notice,
 * fill in its details and who it is for, read the message, send. An absence
 * alert ticks children in one class; the others go to whole classes. A family
 * flagged no-call is never contacted, a phone with siblings gets one closure
 * notice, and nothing goes out in quiet hours.
 *
 * Server-rendered throughout — links, GET forms and one server action — so it
 * costs no client JavaScript. A SUB-PAGE, so a mobile takeover.
 */

export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

const ICONS: Record<SchoolNoticeKind, typeof UserX> = {
  absent_today: UserX,
  exam_schedule: BookOpenCheck,
  ptm: Users,
  school_closed: CalendarOff,
};

function StepHeading({ step, title, detail }: { step: number; title: string; detail?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-extrabold text-accent-foreground">
          {step}
        </span>
        {title}
      </h2>
      {detail ? <p className="text-[11.5px] text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

export default async function SchoolNoticesPage({ searchParams }: PageProps) {
  const staff = await requireAnyStaffPermission(["settings:view", "settings:write"], {
    onDenied: "redirect",
  });
  const canSend = hasStaffPermission(staff, "settings:write");
  const params = (await searchParams) ?? {};

  const kindRaw = one(params.kind);
  const kind: SchoolNoticeKind = isSchoolNoticeKind(kindRaw) ? kindRaw : "absent_today";
  const languageRaw = one(params.language);
  const language: NoticeLanguage = isNoticeLanguage(languageRaw) ? languageRaw : "hi";
  const definition = schoolNoticeFor(kind);
  const today = istToday();
  const done = one(params.done);
  const error = one(params.error);

  const fieldValues: Record<string, string> = {};
  for (const field of definition.fields) {
    const raw = one(params[`field:${field.name}`]);
    // The absence date opens on today, which is the one it almost always is.
    fieldValues[field.name] = raw || (field.kind === "date" && kind === "absent_today" ? today : "");
  }

  const supabase = createAdminClient();
  const sessionLabel = await resolveReminderSessionLabel(supabase);
  let roster: RosterStudent[] = [];
  let loadError: string | null = null;
  try {
    roster = await loadSchoolRoster(supabase, sessionLabel);
  } catch (caught) {
    loadError = caught instanceof Error ? caught.message : "Could not read the class rolls.";
  }
  const [batches, monthCount] = await Promise.all([
    loadRecentSchoolNoticeBatches(supabase, sessionLabel).catch(() => []),
    schoolNoticesThisMonth(supabase, today).catch(() => 0),
  ]);

  const classes = [
    ...new Map(
      roster
        .filter((student) => student.classId)
        .map((student) => [
          student.classId as string,
          { id: student.classId as string, label: student.studentClass, order: student.classSortOrder },
        ]),
    ).values(),
  ].sort((left, right) => left.order - right.order);
  const classCounts = new Map<string, number>();
  for (const student of roster) {
    if (student.classId) classCounts.set(student.classId, (classCounts.get(student.classId) ?? 0) + 1);
  }

  const rosterClassId = one(params.classId) || classes[0]?.id || "";
  const pickedClasses = new Set(
    one(params.classes)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const recipients =
    definition.pick === "roster"
      ? roster.filter((student) => student.classId === rosterClassId)
      : roster.filter((student) => student.classId && pickedClasses.has(student.classId));

  const approvedHere = isSchoolNoticeApproved(kind, language);
  const approvedAny = approvedHere || isSchoolNoticeApproved(kind, language === "hi" ? "en" : "hi");

  // The message as the FIRST recipient's parent will read it.
  const sample = recipients[0] ?? null;
  const template = schoolNoticeTemplate(kind, language);
  const previewFields: Record<string, string> = {};
  for (const field of definition.fields) {
    const value = fieldValues[field.name] ?? "";
    previewFields[field.name] = field.kind === "date" ? formatDdMmYyyy(value) || value : value;
  }
  const previewBody = fillBody(
    template.body,
    template.buildParams({
      studentName: sample
        ? definition.addressedTo === "household"
          ? studentsLine(roster.filter((student) => student.destination && student.destination === sample.destination))
          : sample.studentName
        : "Student name",
      studentClass: sample?.studentClass ?? "Class",
      fields: previewFields,
    }),
  );

  const reachable = recipients.filter((student) => !student.noCall && student.destination);
  const messageCount =
    definition.addressedTo === "household"
      ? new Set(reachable.map((student) => student.destination)).size
      : reachable.length;

  /** Same screen, one thing changed. */
  const hrefWith = (override: Record<string, string>) => {
    const next = new URLSearchParams({ kind, language });
    for (const [key, value] of Object.entries({ ...override })) next.set(key, value);
    return `?${next.toString()}`;
  };

  return (
    <div
      className="flex flex-col gap-5"
      style={{ paddingBottom: "calc(var(--mobile-safe-area-bottom, 0px) + 0.75rem)" }}
    >
      <PageHeader
        eyebrow="Reminders"
        title="School notices"
        description={`Absence alerts, exam schedules, parent-teacher meetings and closures. ${monthCount} sent this month of ${SCHOOL_NOTICE_MONTHLY_BUDGET}.`}
        mobileEyebrow={`${monthCount} sent this month`}
      />
      <RemindersNav active="notices" />

      {done ? (
        <OfficeNotice title="Sent" tone="success">
          {done}
        </OfficeNotice>
      ) : null}
      {error ? (
        <OfficeNotice title="Not sent" tone="danger">
          {error}
        </OfficeNotice>
      ) : null}
      {loadError ? (
        <OfficeNotice title="Could not load the class rolls" tone="danger">
          {loadError}
        </OfficeNotice>
      ) : null}
      {!approvedAny ? (
        <OfficeNotice title="Waiting for Meta" tone="warning">
          This notice&rsquo;s template has been written but Meta has not approved it yet, so it
          cannot be sent. You can still fill it in and read exactly what parents will get.
        </OfficeNotice>
      ) : null}

      {/* ---------------------------------------------------------- 1 which */}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <StepHeading step={1} title="Which notice" />
        <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {SCHOOL_NOTICES.map((entry) => {
            const Icon = ICONS[entry.kind];
            const active = entry.kind === kind;
            return (
              <li key={entry.kind}>
                <NavLink
                  href={`?kind=${entry.kind}&language=${language}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "tap focus-ring flex h-full flex-col gap-1 rounded-xl border p-3",
                    active ? "border-accent bg-accent/[0.06] ring-1 ring-accent" : "border-border hover:border-border-strong",
                  )}
                >
                  <Icon className="size-5 text-accent" aria-hidden="true" />
                  <span className="text-[13px] font-bold text-foreground">{entry.label}</span>
                  <span className="text-[11.5px] leading-snug text-muted-foreground">{entry.hint}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ------------------------------------------------- 2 details + who */}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <StepHeading
          step={2}
          title="Details and who it is for"
          detail={definition.pick === "roster" ? "Pick a class, then tick the children." : "Tick the classes."}
        />
        <form method="get" className="flex flex-col gap-3">
          <input type="hidden" name="kind" value={kind} />
          <div className="flex flex-wrap items-end gap-3">
            {definition.fields.map((field) => (
              <label
                key={field.name}
                className="flex min-w-[9rem] flex-col gap-1 text-[11.5px] font-semibold text-muted-foreground"
              >
                {field.label}
                <Input
                  name={`field:${field.name}`}
                  type={field.kind === "date" ? "date" : "text"}
                  defaultValue={fieldValues[field.name]}
                  placeholder={field.placeholder}
                  maxLength={field.maxLength}
                  inputSize="sm"
                  className="h-11 md:h-9"
                />
              </label>
            ))}
            <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-muted-foreground">
              Language
              <SelectNative name="language" defaultValue={language} className="h-11 w-28 text-sm md:h-9">
                <option value="hi">Hindi</option>
                <option value="en">English</option>
              </SelectNative>
            </label>
            {definition.pick === "roster" ? (
              <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-muted-foreground">
                Class
                <SelectNative name="classId" defaultValue={rosterClassId} className="h-11 w-40 text-sm md:h-9">
                  {classes.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label} ({classCounts.get(entry.id) ?? 0})
                    </option>
                  ))}
                </SelectNative>
              </label>
            ) : null}
          </div>
          {definition.pick === "classes" ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-[11.5px] font-semibold text-muted-foreground">Classes</legend>
              <div className="flex flex-wrap gap-1.5">
                {classes.map((entry) => (
                  <label
                    key={entry.id}
                    className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border px-3 text-[12px] font-semibold has-[:checked]:border-accent has-[:checked]:bg-accent/[0.06] md:min-h-9"
                  >
                    <input
                      type="checkbox"
                      name="classes"
                      value={entry.id}
                      defaultChecked={pickedClasses.has(entry.id)}
                      className="size-4 accent-accent"
                    />
                    {entry.label}
                    <span className="tabular-nums text-muted-foreground">{classCounts.get(entry.id) ?? 0}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <div>
            <button
              type="submit"
              className="focus-ring inline-flex h-11 items-center rounded-lg border border-border px-4 text-sm font-semibold md:h-9"
            >
              Show the message
            </button>
          </div>
        </form>
      </section>

      {/* ------------------------------------------------ 3 check and send */}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <StepHeading
          step={3}
          title="Check and send"
          detail={`${messageCount} message${messageCount === 1 ? "" : "s"} · ${recipients.length - reachable.length} can't be reached`}
        />
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_22rem]">
          <form action={sendSchoolNoticeAction} className="flex flex-col gap-3">
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="language" value={language} />
            {definition.pick === "roster" ? <input type="hidden" name="classId" value={rosterClassId} /> : null}
            {[...pickedClasses].map((classId) => (
              <input key={classId} type="hidden" name="classes" value={classId} />
            ))}
            {definition.fields.map((field) => (
              <input key={field.name} type="hidden" name={`field:${field.name}`} value={fieldValues[field.name] ?? ""} />
            ))}

            {recipients.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                {definition.pick === "roster" ? "Nobody on this class roll." : "Tick at least one class above, then press Show the message."}
              </p>
            ) : (
              <ul className={cn("grid gap-1.5", definition.pick === "roster" ? "md:grid-cols-2" : "max-h-80 overflow-y-auto md:grid-cols-2")}>
                {recipients.map((student) => {
                  const blocked = student.noCall || !student.destination;
                  return (
                    <li key={student.studentId}>
                      <label
                        className={cn(
                          "flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-1.5 text-[13px]",
                          blocked ? "border-border bg-surface-2 text-muted-foreground" : "cursor-pointer border-border has-[:checked]:border-accent has-[:checked]:bg-accent/[0.06]",
                        )}
                      >
                        {definition.pick === "roster" ? (
                          <input
                            type="checkbox"
                            name="studentId"
                            value={student.studentId}
                            disabled={blocked}
                            className="size-5 shrink-0 accent-accent"
                          />
                        ) : blocked ? null : (
                          <input type="hidden" name="studentId" value={student.studentId} />
                        )}
                        <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{student.studentName}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {student.noCall ? "no-call" : !student.destination ? "no number" : student.studentClass}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}

            {canSend ? (
              <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 p-3">
                <label className="flex min-h-11 items-start gap-2 text-[12.5px] font-semibold">
                  <input type="checkbox" name="confirm" className="mt-1 size-4 shrink-0 accent-accent" />
                  I have read the message on the right. Send real WhatsApp messages, billed per message.
                </label>
                <PendingSubmitButton
                  className="h-12 w-full md:h-10 md:w-fit md:px-6"
                  pendingLabel="Sending…"
                  disabled={!approvedAny || recipients.length === 0}
                >
                  {definition.pick === "roster" ? "Send to the ticked children" : `Send ${messageCount} message${messageCount === 1 ? "" : "s"}`}
                </PendingSubmitButton>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">You can prepare a notice, but only an admin can send it.</p>
            )}
          </form>

          <NoticePreview
            recipient={sample ? `${sample.studentName}'s parent` : "the parent"}
            body={previewBody}
            buttons={[{ label: language === "hi" ? "कार्यालय को कॉल करें" : "Call office", kind: "phone" }]}
            footnote={
              approvedHere
                ? "Exactly what goes out, filled for the first child on the list. Each family sees their own child's name."
                : "Waiting for Meta. When it is approved, this is the message that goes."
            }
          />
        </div>
      </section>

      {batches.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-bold text-foreground">Sent recently</h2>
          <ul className="flex flex-col gap-1.5">
            {batches.map((batch) => (
              <li key={batch.batchId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px]">
                <span className="font-semibold text-foreground">
                  {isSchoolNoticeKind(batch.noticeKind) ? schoolNoticeFor(batch.noticeKind).label : batch.noticeKind}
                </span>
                <span className="text-muted-foreground">
                  {formatDdMmYyyy(batch.sentOn)} · {batch.messages} messages · {batch.children} children
                  {batch.failed ? ` · ${batch.failed} failed` : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11.5px] text-muted-foreground">
            <NavLink href={hrefWith({})} className="font-semibold text-accent underline-offset-2 hover:underline">
              Start a new notice
            </NavLink>
          </p>
        </section>
      ) : null}
    </div>
  );
}
