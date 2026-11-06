import { mapConcurrently } from "@/platform/helpers/chunk";
import { PAGE_SIZE, pageWindow } from "@/modules/students/domain/directory";

/** Intersect the canonical query, including SR/parent/fee filters, before paging. */
export async function missingDirectoryPage<Page extends { rows: unknown[]; total: number }>(
  read: (page: number) => Promise<Page>,
  missingIds: ReadonlySet<string>,
  idOf: (row: Page["rows"][number]) => string,
  page: number,
): Promise<Page & { sourceTotal: number; matchingIds: string[] }> {
  return keptDirectoryPage(read, (row) => missingIds.has(idOf(row)), idOf, page);
}

/**
 * Every page of the list, kept to the rows `keep` accepts, then paged again.
 * For a filter the database cannot apply: a missing field, or a name typed in
 * Hindi against names stored in Latin letters.
 */
export async function keptDirectoryPage<Page extends { rows: unknown[]; total: number }>(
  read: (page: number) => Promise<Page>,
  keep: (row: Page["rows"][number]) => boolean,
  idOf: (row: Page["rows"][number]) => string,
  page: number,
): Promise<Page & { sourceTotal: number; matchingIds: string[] }> {
  const first = await read(1);
  const rest = await mapConcurrently(
    Array.from({ length: Math.max(0, Math.ceil(first.total / PAGE_SIZE) - 1) }, (_, i) => i + 2),
    4,
    read,
  );
  const seen = new Set<string>();
  const matching = [first, ...rest].flatMap(p => p.rows).filter(row => {
    const id = idOf(row);
    if (!keep(row) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const window = pageWindow(page, matching.length);
  return {
    ...first,
    sourceTotal: first.total,
    total: matching.length,
    rows: matching.slice(window.from, window.to + 1),
    matchingIds: matching.map(idOf),
  };
}
