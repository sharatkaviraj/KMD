import type { ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import { m } from "@/messages";
import { schoolBrand } from "@/platform/config/school-brand";
import { primary, secondary, type Language, type Localized } from "@/platform/i18n/language";
import { SchoolBrand } from "./school-brand";

export function SchoolWelcome({ language, heading, displayName, schoolHour = 9, day, sessionLabel }: {
  language: Language;
  heading?: Localized;
  displayName?: string;
  schoolHour?: number;
  day?: Localized;
  sessionLabel?: string;
}) {
  const greeting = schoolHour < 12 ? m.schoolMorning : schoolHour < 17 ? m.schoolAfternoon : m.schoolEvening;
  const subtitle = heading ? secondary(heading, language) : null;
  let title: ReactNode = schoolBrand.appName;
  if (heading) title = <><span lang={language === "en" ? "en" : "hi"}>{primary(heading, language)}</span>{subtitle ? <span lang="en" className="mt-1 block text-sm font-medium leading-5">{subtitle}</span> : null}</>;
  return (
    <header data-school-welcome className="relative overflow-hidden rounded-2xl border border-nav-border bg-nav text-nav-foreground">
      <div className="min-w-0 space-y-3 p-5 md:p-6">
        <div className="flex items-center gap-3">
          <SchoolBrand variant="icon" />
          <div className="min-w-0">
            <p className="break-words text-[13px] font-semibold leading-5">{schoolBrand.name}</p>
            <p className="text-xs leading-5 text-nav-muted">{primary(m.schoolLocation, language)}</p>
          </div>
        </div>
        <p className="text-[13px] font-medium leading-5 text-nav-muted">
          {displayName ? `${primary(greeting, language)}, ${displayName}` : primary(m.schoolWelcome, language)}
        </p>
        {heading ? <h1 className="text-[25px] font-bold leading-tight tracking-tight text-nav-foreground md:text-[32px]">{title}</h1>
          : <h2 className="font-display text-3xl font-semibold tracking-tight text-nav-foreground">{title}</h2>}
        {day || sessionLabel ? <p className="flex flex-wrap items-start gap-x-3 gap-y-1 text-xs leading-5 text-nav-foreground">
          {day ? <span className="inline-flex items-start gap-1.5"><CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0" />{primary(day, language)}</span> : null}
          {sessionLabel ? <span className="rounded-md border border-nav-border px-2">{sessionLabel}</span> : null}
        </p> : <p className="text-sm leading-6 text-nav-foreground">{primary(m.schoolWorkspaceHint, language)}</p>}
      </div>
    </header>
  );
}
