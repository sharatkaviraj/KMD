
import { PageHeader } from "@/ui/shell/page-header";
import { OfficeNotice } from "@/ui/office/office-ui";
import { PendingSubmitButton } from "@/ui/shell/pending-submit-button";
import { Input } from "@/ui/primitives/input";
import { SelectNative } from "@/ui/primitives/select-native";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { hasStaffPermission, requireAnyStaffPermission } from "@/modules/fees/platform/session";
import { getFeePolicySummary } from "@/modules/fees/data/policy";
import { istToday } from "@/modules/whatsapp/domain/fee-reminders";
import { resolveReminderSessionLabel } from "@/modules/whatsapp/data/reminder-session";
import { buildInstallmentCalendar } from "@/modules/whatsapp/domain/installment-calendar";
import { loadFamilyProfiles, type FamilyProfileRow } from "@/modules/whatsapp/data/family-profiles";
import {
  isReminderProfile,
  profileLabel,
  REMINDER_PROFILES,
  type ReminderProfile,
} from "@/modules/whatsapp/domain/reminder-profile";
import { RemindersNav } from "@/modules/whatsapp/ui/reminders-nav";
import { ProfileBadge } from "@/modules/whatsapp/ui/profile-badge";
import { formatInr } from "@/platform/helpers/currency";
import { cn } from "@/platform/utils";
import {
  saveReminderProfilesAction,
  setProfileForShownAction,
} from "@/app/(app)/fees/reminders/families/actions";
import { NavLink } from "@/ui/shell/nav-link";

/**
 * Families — who gets chased how hard.
 *
 * Every collectable family in the session with the profile they are treated as:
 * the office's own choice where it made one, the ledger's suggestion otherwise.
 * The dropdown on each row is the whole interface; a family left on
 * "Suggested" moves by itself next installment, a family set by hand stays put.
 *
 * Server-rendered with native selects and one form per page, so it works with
 * no client JavaScript at all — on the office desktop and on a phone with a
 * thin signal alike. A SUB-PAGE, so a mobile takeover like the other reminder
 * sub-pages; bottom spacing is the safe area plus the sticky save bar.
 */

export const revalidate = 0;

const PAGE_SIZE = 60;

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function FamiliesPage({ searchParams }: PageProps) {
  const staff = await requireAnyStaffPermission(["settings:view", "settings:write"], {
    onDenied: "redirect",
  });
  const canEdit = hasStaffPermission(staff, "settings:write");
  const params = (await searchParams) ?? {};

  const profileFilter = one(params.profile);
  const classFilter = one(params.classId);
  const sourceFilter = one(params.source);
  const query = one(params.q).toLowerCase();
  // Owing families first: they are who a run can reach. "all" shows the
  // paid-up families too, for filing someone before they fall behind.
  const owingOnly = one(params.owing) !== "all";
  const page = Math.max(1, Number(one(params.page)) || 1);
  const saved = one(params.saved);
  const error = one(params.error);

  const supabase = createAdminClient();
  const sessionLabel = await resolveReminderSessionLabel(supabase);
  const today = istToday();
  const policy = await getFeePolicySummary({ useAdmin: true }).catch(() => null);
  const calendar = buildInstallmentCalendar({
    schedule: policy?.installmentSchedule ?? [],
    today,
  });

  let data: Awaited<ReturnType<typeof loadFamilyProfiles>>;
  try {
    data = await loadFamilyProfiles(supabase, sessionLabel, calendar, today);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Reminders" title="Families" />
        <RemindersNav active="families" />
        <OfficeNotice title="Could not load the families" tone="danger">
          {caught instanceof Error ? caught.message : "Something went wrong reading the ledger."}
        </OfficeNotice>
      </div>
    );
  }

  const classes = [
    ...new Map(
      data.rows
        .filter((row) => row.classId)
        .map((row) => [row.classId as string, { id: row.classId as string, label: row.studentClass, order: row.classSortOrder }]),
    ).values(),
  ].sort((left, right) => left.order - right.order);

  const filtered = data.rows.filter((row) => {
    if (owingOnly && row.balanceDue <= 0) return false;
    if (isReminderProfile(profileFilter) && row.effective.profile !== profileFilter) return false;
    if (classFilter && row.classId !== classFilter) return false;
    if (sourceFilter === "set" && row.effective.source !== "set") return false;
    if (sourceFilter === "suggested" && row.effective.source !== "suggested") return false;
    if (
      query &&
      !row.studentName.toLowerCase().includes(query) &&
      !row.admissionNo.toLowerCase().includes(query) &&
      !row.parentName.toLowerCase().includes(query)
    ) {
      return false;
    }
    return true;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const shown = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  /** Same filters, one thing changed — so a chip or a page link keeps the rest. */
  const hrefWith = (override: Record<string, string | null>) => {
    const next = new URLSearchParams();
    const base: Record<string, string> = {
      profile: profileFilter,
      classId: classFilter,
      source: sourceFilter,
      q: one(params.q),
      owing: owingOnly ? "" : "all",
    };
    for (const [key, value] of Object.entries({ ...base, ...override })) {
      if (value) next.set(key, value);
    }
    const text = next.toString();
    return text ? `?${text}` : "?";
  };

  /** Carried by both forms, so a save lands back on the same filtered page. */
  const returnFields = (
    <>
      <input type="hidden" name="return:profile" value={profileFilter} />
      <input type="hidden" name="return:classId" value={classFilter} />
      <input type="hidden" name="return:source" value={sourceFilter} />
      <input type="hidden" name="return:q" value={one(params.q)} />
      <input type="hidden" name="return:owing" value={owingOnly ? "" : "all"} />
      <input type="hidden" name="return:page" value={String(currentPage)} />
    </>
  );

  const totalFamilies = data.rows.length;

  return (
    <div
      className="flex flex-col gap-5"
      style={{ paddingBottom: "calc(var(--mobile-safe-area-bottom, 0px) + 6rem)" }}
    >
      <PageHeader
        eyebrow="Reminders"
        title="Families"
        description={`How hard each family is reminded. Session ${sessionLabel} · ${totalFamilies} families · ${data.setByHand} set by hand.`}
        mobileEyebrow={`${totalFamilies} families · ${data.setByHand} set by hand`}
      />
      <RemindersNav active="families" />

      {saved ? (
        <OfficeNotice title="Saved" tone="success">
          {saved === "0"
            ? "Nothing had changed, so nothing was written."
            : `${saved} ${saved === "1" ? "family" : "families"} updated. The next reminder list already uses the new profiles.`}
        </OfficeNotice>
      ) : null}
      {error ? (
        <OfficeNotice title="Not saved" tone="danger">
          {error}
        </OfficeNotice>
      ) : null}

      {/* The five profiles as filter cards: what each means, and how many
          families are in it right now. Tapping one shows only those. */}
      <ul className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {REMINDER_PROFILES.map((entry) => {
          const active = profileFilter === entry.value;
          return (
            <li key={entry.value}>
              <NavLink
                href={hrefWith({ profile: active ? null : entry.value, page: null })}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "tap focus-ring flex h-full flex-col gap-1 rounded-xl border bg-card p-3",
                  active ? "border-accent ring-1 ring-accent" : "border-border hover:border-border-strong",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <ProfileBadge profile={entry.value} />
                  <span className="text-lg font-extrabold tabular-nums text-foreground">
                    {data.counts[entry.value]}
                  </span>
                </span>
                <span className="text-[11.5px] leading-snug text-muted-foreground">{entry.hint}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>

      <OfficeNotice title="How profiles work" tone="info">
        A dashed pill is the ledger&rsquo;s suggestion: late fees on two or more installments
        suggest Chronic, a clean record suggests On-time, a repayment plan suggests Hardship. It
        moves by itself as the family pays. Pick a profile to fix a family in place. Fee reminders
        reach On-time, Standard and Chronic unless a run ticks Hardship or Quiet in.
      </OfficeNotice>

      {/* Filters — a GET form, so the filtered page is linkable. */}
      <form method="get" className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3">
        {profileFilter ? <input type="hidden" name="profile" value={profileFilter} /> : null}
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-[11.5px] font-semibold text-muted-foreground">
          Search
          <Input name="q" defaultValue={one(params.q)} placeholder="Name, admission no. or parent" inputSize="sm" className="h-11 md:h-9" />
        </label>
        <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-muted-foreground">
          Class
          <SelectNative name="classId" defaultValue={classFilter} className="h-11 w-40 text-sm md:h-9">
            <option value="">Every class</option>
            {classes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </SelectNative>
        </label>
        <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-muted-foreground">
          Who
          <SelectNative name="source" defaultValue={sourceFilter} className="h-11 w-40 text-sm md:h-9">
            <option value="">Set and suggested</option>
            <option value="set">Set by hand</option>
            <option value="suggested">Suggested only</option>
          </SelectNative>
        </label>
        <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-muted-foreground">
          Owing
          <SelectNative name="owing" defaultValue={owingOnly ? "" : "all"} className="h-11 w-36 text-sm md:h-9">
            <option value="">Owing fees</option>
            <option value="all">Everyone</option>
          </SelectNative>
        </label>
        <button
          type="submit"
          className="focus-ring inline-flex h-11 items-center rounded-lg border border-border px-4 text-sm font-semibold md:h-9"
        >
          Show
        </button>
      </form>

      <p className="text-sm text-muted-foreground">
        {filtered.length === 0
          ? "Nobody matches these filters."
          : `${filtered.length} ${filtered.length === 1 ? "family" : "families"}${
              pageCount > 1 ? ` · page ${currentPage} of ${pageCount}` : ""
            }.`}
      </p>

      {canEdit && shown.length > 0 ? (
        // One profile for every family on this page — "all of Class 10 are
        // quiet this week". Its own form, so it never posts the dropdowns.
        <form
          action={setProfileForShownAction}
          className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border bg-surface-2 p-3 text-sm"
        >
          {returnFields}
          {shown.map((row) => (
            <input key={row.studentId} type="hidden" name="studentId" value={row.studentId} />
          ))}
          <span className="font-semibold text-foreground">
            Set all {shown.length} shown to
          </span>
          <SelectNative name="bulkProfile" defaultValue="" aria-label="Profile for every family shown" className="h-11 w-44 text-sm md:h-9">
            {/* Starts on nothing. It started on "Suggested (clear)", so one
                press of Apply wiped every hand-set profile on the page. */}
            <option value="">Pick a profile…</option>
            <option value="suggested">Back to suggested (clear)</option>
            {REMINDER_PROFILES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </SelectNative>
          <PendingSubmitButton variant="outline" size="sm" className="h-11 md:h-9" pendingLabel="Applying…">
            Apply to all shown
          </PendingSubmitButton>
        </form>
      ) : null}

      <form action={saveReminderProfilesAction} className="flex flex-col gap-3">
        {returnFields}

        {/* Phone: one card per family. */}
        <ul className="flex flex-col gap-2 md:hidden">
          {shown.map((row) => (
            <li key={row.studentId} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-bold text-foreground">{row.studentName}</p>
                  <p className="text-[11.5px] text-muted-foreground">
                    {row.studentClass} · {row.admissionNo}
                    {row.reachable ? "" : " · no WhatsApp number"}
                  </p>
                </div>
                <span className="shrink-0 text-[14px] font-extrabold tabular-nums">
                  {formatInr(row.balanceDue)}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <ProfileBadge profile={row.effective.profile} suggested={row.effective.source === "suggested"} />
                <span className="min-w-0 truncate text-[11.5px] text-muted-foreground">{row.effective.reason}</span>
              </div>
              <ProfileSelect row={row} disabled={!canEdit} className="mt-2.5 h-11 w-full" />
            </li>
          ))}
        </ul>

        {/* Desk: one row per family. */}
        <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Student</th>
                <th className="px-3 py-2">Class</th>
                <th className="px-3 py-2">Parent</th>
                <th className="px-3 py-2 text-right">Fees owed</th>
                <th className="px-3 py-2">Profile</th>
                <th className="px-3 py-2">Why</th>
                <th className="px-3 py-2">Change</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.studentId} className="border-t border-border">
                  <td className="px-3 py-2">
                    <span className="font-medium text-foreground">{row.studentName}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{row.admissionNo}</span>
                    {row.reachable ? null : (
                      <span className="ml-2 text-[11px] text-warning-foreground">no number</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{row.studentClass}</td>
                  <td className="px-3 py-2">{row.parentName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInr(row.balanceDue)}</td>
                  <td className="px-3 py-2">
                    <ProfileBadge profile={row.effective.profile} suggested={row.effective.source === "suggested"} />
                  </td>
                  <td className="max-w-[18rem] px-3 py-2 text-xs text-muted-foreground">{row.effective.reason}</td>
                  <td className="px-3 py-2">
                    <ProfileSelect row={row} disabled={!canEdit} className="h-9 w-44" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pageCount > 1 ? (
          <nav aria-label="Pages" className="flex flex-wrap items-center gap-2 text-sm">
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
              <NavLink
                key={number}
                href={hrefWith({ page: String(number) })}
                aria-current={number === currentPage ? "page" : undefined}
                className={cn(
                  "tap focus-ring grid size-11 place-items-center rounded-lg border font-semibold md:size-9",
                  number === currentPage ? "border-accent bg-accent text-accent-foreground" : "border-border",
                )}
              >
                {number}
              </NavLink>
            ))}
          </nav>
        ) : null}

        {canEdit && shown.length > 0 ? (
          // Sticky on every viewport: on a page of sixty, the button at the end
          // of the table is sixty rows away from the dropdown just changed.
          <div
            className="sticky bottom-0 z-20 -mx-1 flex items-center justify-between gap-3 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur md:bottom-4"
            style={{ marginBottom: "var(--mobile-safe-area-bottom, 0px)" }}
          >
            <span className="text-[12.5px] text-muted-foreground">
              Only the rows you change are saved.
            </span>
            <PendingSubmitButton className="h-11 px-5 md:h-9" pendingLabel="Saving…">
              Save changes
            </PendingSubmitButton>
          </div>
        ) : null}
        {!canEdit ? (
          <p className="text-sm text-muted-foreground">
            You can see the profiles but not change them. An admin can.
          </p>
        ) : null}
      </form>
    </div>
  );
}

/** One family's dropdown, posting its choice and what it was when the page rendered. */
function ProfileSelect({
  row,
  disabled,
  className,
}: {
  row: FamilyProfileRow;
  disabled: boolean;
  className?: string;
}) {
  const current = row.explicit ?? "";
  return (
    <>
      <input type="hidden" name={`was:${row.studentId}`} value={current} />
      <SelectNative
        name={`profile:${row.studentId}`}
        defaultValue={current}
        disabled={disabled}
        aria-label={`Reminder profile for ${row.studentName}`}
        className={cn("text-sm", className)}
      >
        <option value="">Suggested ({profileLabel(row.suggested as ReminderProfile)})</option>
        {REMINDER_PROFILES.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.label}
          </option>
        ))}
      </SelectNative>
    </>
  );
}
