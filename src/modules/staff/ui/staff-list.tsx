"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import { m } from "@/messages";
import { roleLabel } from "@/platform/auth/permissions";
import { flat, primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import {
  compareStaff,
  matchesStaffSearch,
  type StaffProfile,
} from "@/modules/staff/domain/staff";
import { Badge, Input } from "@/ui/primitives";
import { EmptyState } from "@/ui/states";

/**
 * The staff list, filtered in the browser.
 *
 * A school has a few dozen staff, so the whole list is sent once and the
 * search is instant and works offline. A round trip per keystroke would be
 * slower and would fail in the corridor where the signal is worst.
 */
export function StaffList({ staff }: { staff: StaffProfile[] }) {
  const language = useLanguage();
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const visible = useMemo(() => {
    return staff
      .filter((person) => (showInactive ? true : person.isActive))
      .filter((person) => matchesStaffSearch(person, query))
      .sort(compareStaff);
  }, [staff, query, showInactive]);

  const inactiveCount = staff.filter((person) => !person.isActive).length;

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={primary(m.staffSearch, language)}
          className="pl-11"
          aria-label={flat(m.staffSearchLabel, language)}
        />
      </div>

      {inactiveCount > 0 ? (
        <label className="flex min-h-11 items-center gap-2.5 text-[14px] text-muted-foreground">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(event) => setShowInactive(event.target.checked)}
            className="size-5 accent-accent"
          />
          {primary(m.staffShowInactive, language)} ({inactiveCount})
        </label>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          title={query ? m.staffNoMatch : m.staffNone}
          language={language}
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((person) => (
            <li key={person.id}>
              <Link
                href={`/staff/${person.id}`}
                className="focus-ring flex min-h-[4.5rem] items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
              >
                <span
                  aria-hidden
                  className={`flex size-11 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${
                    person.isActive
                      ? "bg-accent-soft text-accent-soft-foreground"
                      : "bg-surface-3 text-subtle-foreground"
                  }`}
                >
                  {person.shortName.slice(0, 2)}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-foreground">
                    {person.displayName}
                  </span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    <span className="font-mono">{person.shortName}</span>
                    {" · "}
                    {primary(roleLabel(person.role), language)}
                  </span>
                </span>

                <span className="flex shrink-0 flex-col items-end gap-1">
                  {!person.isActive ? (
                    <Badge tone="neutral">{primary(m.inactive, language)}</Badge>
                  ) : person.isTeaching ? (
                    <Badge tone="accent">{primary(m.classBadge, language)}</Badge>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-center text-[13px] text-subtle-foreground">
        {visible.length} / {staff.length} {primary(m.shown, language)}
      </p>
    </div>
  );
}
