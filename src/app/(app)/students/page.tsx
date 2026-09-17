import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { flat, primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import {
  classLabelMap,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import { searchStudents } from "@/modules/students/data/directory-repo";
import {
  directoryHref,
  isFiltered,
  normaliseQuery,
  resolvePage,
} from "@/modules/students/domain/directory";
import { Card, Notice, Select } from "@/ui/primitives";
import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.studentsTitle) };
}

/**
 * Find a child.
 *
 * PLAN §3a asks for "a real searchable directory instead of forcing access
 * through attendance" — until now the only route to a student's record was the
 * register of whichever class they happened to be in, which works if you
 * already know the class and is the whole problem if you do not.
 *
 * **A GET form, and every filter in the URL.** No client state, so Back works,
 * a bookmark works, and a link pasted into WhatsApp opens the same list for
 * the person who receives it. It also means the screen is a Server Component
 * with no JavaScript of its own, which is the difference between usable and
 * not on the connection this is opened on.
 */
export default async function StudentsPage(props: PageProps<"/students">) {
  const staff = await requirePermission("students:view", "/students");
  const language = staff.language;
  const params = await props.searchParams;

  const readOne = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const text = normaliseQuery(readOne(params.q) ?? "");
  const classId = readOne(params.class) ?? null;
  const page = resolvePage(readOne(params.page));

  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader title={m.studentsTitle} language={language} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const [labels, results] = await Promise.all([
    classLabelMap(sessionLabel),
    searchStudents({ text, classId, page }, sessionLabel),
  ]);

  const query = { text, classId, page };
  const filtered = isFiltered(query);

  return (
    <>
      <PageHeader
        title={m.studentsTitle}
        description={m.studentsHint}
        language={language}
      />

      {/* A plain GET form. The URL is the state. */}
      <form action="/students" method="get" className="space-y-2.5">
        <div className="flex gap-2">
          <label htmlFor="q" className="sr-only">
            {flat(m.studentsSearchLabel, language)}
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={text}
            inputMode="search"
            autoComplete="off"
            placeholder={flat(m.studentsSearchHint, language)}
            className="focus-ring h-12 w-full rounded-xl border border-border bg-surface px-4 text-base text-foreground placeholder:text-subtle-foreground"
          />
          <button type="submit" className={buttonClasses({ className: "shrink-0 px-5" })}>
            <Search aria-hidden />
            <span className="sr-only">{flat(m.studentsSearchLabel, language)}</span>
          </button>
        </div>

        <div className="flex gap-2">
          <label htmlFor="class" className="sr-only">
            {flat(m.teachClassTitle, language)}
          </label>
          <Select id="class" name="class" defaultValue={classId ?? ""}>
            <option value="">{flat(m.studentsAllClasses, language)}</option>
            {[...labels.entries()].map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
          {filtered ? (
            <Link
              href="/students"
              className={buttonClasses({
                variant: "outline",
                className: "shrink-0 whitespace-nowrap px-4",
              })}
            >
              {primary(m.studentsClear, language)}
            </Link>
          ) : null}
        </div>
      </form>

      {/* ------------------------------------------------------- the results */}

      <p className="mt-5 text-[13px] text-muted-foreground" role="status">
        {results.total === 0
          ? primary(m.studentsNone, language)
          : primary(
              t(
                `${results.total} में से ${results.window.firstRow}–${results.window.lastRow}`,
                `${results.window.firstRow}–${results.window.lastRow} of ${results.total}`,
              ),
              language,
            )}
      </p>

      {results.total === 0 ? (
        // "Nobody matched" and "there is nobody" are different, and only one of
        // them has anything to do with what was typed.
        <EmptyState
          className="mt-3"
          title={filtered ? m.studentsNoMatch : m.studentsEmpty}
          detail={filtered ? m.studentsTryAgain : undefined}
          language={language}
        />
      ) : (
        <ul className="mt-3 space-y-2">
          {results.rows.map((row) => (
            <li key={row.studentId}>
              <Link
                href={`/teach/student/${row.studentId}`}
                className="focus-ring flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
              >
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-[13px] font-semibold tabular-nums text-muted-foreground"
                >
                  {row.rollNo ?? "—"}
                </span>
                <span className="min-w-0 flex-1">
                  {/* Wrapped, not truncated: a long name is the thing being
                      searched for, and cutting it off defeats the search
                      (PLAN §3a). */}
                  <span className="block text-[15px] font-medium text-foreground">
                    {row.fullName}
                  </span>
                  <span className="block truncate text-[12px] text-subtle-foreground">
                    {[
                      row.classId ? labels.get(row.classId) : null,
                      row.admissionNo ? `SR ${row.admissionNo}` : null,
                      row.fatherName,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden
                  className="size-5 shrink-0 text-subtle-foreground"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* ---------------------------------------------------------- paging */}

      {results.window.pages > 1 ? (
        <nav
          aria-label={flat(m.studentsPages, language)}
          className="mt-5 flex items-center justify-between gap-3"
        >
          {results.window.page > 1 ? (
            <Link
              href={directoryHref({ ...query, page: results.window.page - 1 })}
              className={buttonClasses({ variant: "outline" })}
            >
              {primary(m.studentsPrevious, language)}
            </Link>
          ) : (
            <span />
          )}

          <span className="text-[13px] tabular-nums text-muted-foreground">
            {results.window.page} / {results.window.pages}
          </span>

          {results.window.page < results.window.pages ? (
            <Link
              href={directoryHref({ ...query, page: results.window.page + 1 })}
              className={buttonClasses({ variant: "outline" })}
            >
              {primary(m.studentsNext, language)}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      <Card className="mt-6 p-4">
        <Notice tone="neutral" text={m.studentsSourceNote} language={language} />
      </Card>
    </>
  );
}
