/**
 * Finding one child among a few hundred.
 *
 * PLAN §3a: "Add a real searchable directory instead of forcing access through
 * attendance." Until now the only way to a student's record was to open the
 * register of the class they happen to be in — which works if you already know
 * the class, and is the whole problem if you do not.
 *
 * Pure: what a typed query means, and what a page of results looks like. The
 * reads live in `data/directory-repo.ts`.
 */

export type DirectoryQuery = {
  /** What was typed. Empty means "everybody in scope". */
  text: string;
  /** A class id, or null for all of them. */
  classId: string | null;
  /** 1-based, because it appears in a URL a person may read. */
  page: number;
};

/**
 * How many rows a page holds.
 *
 * Fifty rather than everything: `public.students` is a few hundred today and
 * PostgREST silently truncates a read at a thousand (D-62), so a directory
 * that asked for "all" would start lying the year the school grew. Fifty is
 * also about two phone screens, which is as far as anybody scrolls before
 * typing instead.
 */
export const PAGE_SIZE = 50;

/**
 * What a typed query is looking for.
 *
 * Three kinds of thing get typed into a school's search box, and they want
 * different matches:
 *
 *  - a **bare number** is an SR/admission number, and it matches exactly rather
 *    than as a substring — "12" must not return every child whose admission
 *    number contains a 12;
 *  - a **ten-digit number** is a phone, and the office types one when a parent
 *    rings;
 *  - anything else is a **label**: a name, or an admission number with letters
 *    in it. This school issues both — `TEST-CL6-002` is an SR — so the loose
 *    branch searches the admission number as well as the names, or a pasted SR
 *    finds nothing and reads as "that child is not here". Loose, because Hindi
 *    and English spellings of one child differ and nobody types a middle name.
 */
export type QueryKind = "empty" | "phone" | "admission" | "name";

export function queryKind(text: string): QueryKind {
  const trimmed = text.trim();
  if (trimmed === "") return "empty";

  const digits = trimmed.replace(/\D/g, "");

  // A ten-digit Indian mobile, the way the office would type it.
  if (digits.length === 10 && digits === trimmed.replace(/[\s-]/g, "")) {
    return "phone";
  }

  // All digits and short: an admission number.
  if (/^\d{1,9}$/.test(trimmed)) return "admission";

  return "name";
}

/** The search text, trimmed and collapsed, ready for a query. */
export function normaliseQuery(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * A page number that exists.
 *
 * A URL is typed, bookmarked and shared, so `?page=0`, `?page=-3` and
 * `?page=banana` all arrive eventually. Each of them means the first page.
 */
export function resolvePage(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export type PageWindow = {
  page: number;
  pages: number;
  from: number;
  to: number;
  /** 1-based index of the first row on this page, for "51–100 of 139". */
  firstRow: number;
  lastRow: number;
};

/**
 * Which rows this page covers, and how many pages there are.
 *
 * `from`/`to` are the inclusive range PostgREST wants. `firstRow`/`lastRow`
 * are what a person reads, which is the same numbers plus one — and getting
 * that wrong is how a list says it is showing "0–49 of 139".
 */
export function pageWindow(page: number, total: number): PageWindow {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const clamped = Math.min(Math.max(1, page), pages);
  const from = (clamped - 1) * PAGE_SIZE;

  return {
    page: clamped,
    pages,
    from,
    to: from + PAGE_SIZE - 1,
    firstRow: total === 0 ? 0 : from + 1,
    lastRow: Math.min(from + PAGE_SIZE, total),
  };
}

/**
 * The query as URL parameters, so Back, bookmarks and a shared link all work.
 *
 * Empty values are left out rather than written as `q=`: a URL a person may
 * read should say what is actually filtered, and `?q=&class=&page=1` says
 * nothing three times.
 */
export function directoryHref(query: Partial<DirectoryQuery>): string {
  const params = new URLSearchParams();

  const text = normaliseQuery(query.text ?? "");
  if (text) params.set("q", text);
  if (query.classId) params.set("class", query.classId);
  if (query.page && query.page > 1) params.set("page", String(query.page));

  const search = params.toString();
  return search ? `/students?${search}` : "/students";
}

/** Whether anything is filtering the list, for the "clear" affordance. */
export function isFiltered(query: DirectoryQuery): boolean {
  return normaliseQuery(query.text) !== "" || query.classId !== null;
}
