"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import { roleLabels } from "@/platform/auth/permissions";
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
          placeholder="नाम, संक्षिप्त नाम या फ़ोन · Name, short name or phone"
          className="pl-11"
          aria-label="स्टाफ़ खोजें"
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
          निष्क्रिय भी दिखाएँ ({inactiveCount}) · Show inactive
        </label>
      ) : null}

      {visible.length === 0 ? (
        query ? (
          <EmptyState
            hi="कोई स्टाफ़ नहीं मिला।"
            en={`Nothing matches "${query}".`}
          />
        ) : (
          <EmptyState
            hi="अभी कोई स्टाफ़ प्रोफ़ाइल नहीं है।"
            en="Add the teachers and office staff. Every teacher on the timetable needs a profile, even the ones who never sign in."
          />
        )
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
                    {roleLabels[person.role]}
                  </span>
                </span>

                <span className="flex shrink-0 flex-col items-end gap-1">
                  {!person.isActive ? (
                    <Badge tone="neutral">निष्क्रिय</Badge>
                  ) : person.isTeaching ? (
                    <Badge tone="accent">कक्षा</Badge>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-center text-[13px] text-subtle-foreground">
        {visible.length} / {staff.length} दिखाए गए · shown
      </p>
    </div>
  );
}
