"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { m } from "@/messages";
import { roleLabel } from "@/platform/auth/permissions";
import { flat, primary, t } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import {
  compareStaff,
  matchesStaffSearch,
  type StaffProfile,
} from "@/modules/staff/domain/staff";
import { cn } from "@/platform/utils";
import { Panel, PanelRow } from "@/ui/panel";
import { Badge, Input } from "@/ui/primitives";
import { EmptyState } from "@/ui/states";

/**
 * The staff list, filtered in the browser.
 *
 * A school has a few dozen staff, so the whole list is sent once and the
 * search is instant and works offline. A round trip per keystroke would be
 * slower and would fail in the corridor where the signal is worst.
 */
export function StaffList({
  staff,
  className,
}: {
  staff: StaffProfile[];
  className?: string;
}) {
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
    <div className={cn("space-y-4", className)}>
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
        <Panel
          title={m.panelStaffDirectory}
          description={t(
            `${staff.length} में से ${visible.length}`,
            `${visible.length} of ${staff.length}`,
          )}
          language={language}
        >
          {visible.map((person) => (
            <PanelRow
              key={person.id}
              href={`/staff/${person.id}`}
              lead={person.shortName.slice(0, 2)}
              title={person.displayName}
              detail={
                <>
                  <span className="font-mono">{person.shortName}</span>
                  {" · "}
                  {primary(roleLabel(person.role), language)}
                </>
              }
              trailing={
                !person.isActive ? (
                  <Badge tone="neutral">{primary(m.inactive, language)}</Badge>
                ) : person.isTeaching ? (
                  <Badge tone="accent">{primary(m.classBadge, language)}</Badge>
                ) : null
              }
            />
          ))}
        </Panel>
      )}
    </div>
  );
}
