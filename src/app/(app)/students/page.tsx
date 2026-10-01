import Link from "next/link";
import { Search } from "lucide-react";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { flat, primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import {
  classLabelMap,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import { DirectoryWorkspace } from "@/modules/students/ui/directory-workspace";
import { searchStudents } from "@/modules/students/data/directory-repo";
import {
  directoryHref,
  isFiltered,
  normaliseQuery,
  resolvePage,
} from "@/modules/students/domain/directory";
import { Select } from "@/ui/primitives";
import { FootNote, Panel } from "@/ui/panel";
import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";

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
        eyebrow={m.eyebrowSchoolOffice}
        title={m.studentsTitle}
        description={m.studentsHint}
        language={language}
      />

      {/* A plain GET form. The URL is the state.

          One row on a desk and two on a phone: the atlas puts the search box
          and the class filter side by side, and at 360px a select beside a
          search field leaves neither wide enough to read. */}
      <form
        action="/students"
        method="get"
        className="flex flex-col gap-2.5 sm:flex-row sm:items-start"
      >
        <div className="flex min-w-0 flex-1 gap-2">
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

        <div className="flex gap-2 sm:shrink-0">
          <label htmlFor="class" className="sr-only">
            {flat(m.teachClassTitle, language)}
          </label>
          <Select
            id="class"
            name="class"
            defaultValue={classId ?? ""}
            className="sm:w-44"
          >
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

      {results.total === 0 ? (
        // "Nobody matched" and "there is nobody" are different, and only one of
        // them has anything to do with what was typed.
        <EmptyState
          className="mt-5"
          title={filtered ? m.studentsNoMatch : m.studentsEmpty}
          detail={filtered ? m.studentsTryAgain : undefined}
          language={language}
        />
      ) : (
        <Panel
          className="mt-5"
          title={m.panelStudentDirectory}
          // The count is the panel's context line, not a stray paragraph above
          // it — which is where it used to sit, reading as a page subtitle.
          description={t(
            `${results.total} में से ${results.window.firstRow}–${results.window.lastRow}`,
            `${results.window.firstRow}–${results.window.lastRow} of ${results.total}`,
          )}
          language={language}
          footer={
            results.window.pages > 1 ? (
              <nav
                aria-label={flat(m.studentsPages, language)}
                className="flex items-center justify-between gap-3"
              >
                {results.window.page > 1 ? (
                  <Link
                    href={directoryHref({ ...query, page: results.window.page - 1 })}
                    className={buttonClasses({ variant: "outline", size: "sm" })}
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
                    className={buttonClasses({ variant: "outline", size: "sm" })}
                  >
                    {primary(m.studentsNext, language)}
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            ) : null
          }
        >
          <li><DirectoryWorkspace key={`${text}/${classId}/${page}`} rows={results.rows} labels={Object.fromEntries(labels)} language={language} /></li>
        </Panel>
      )}

      <FootNote
        className="mt-5"
        title={m.panelSearchNote}
        text={m.studentsSourceNote}
        language={language}
      />
    </>
  );
}
