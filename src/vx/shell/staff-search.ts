/*
 * Staff in the search palette (school-day run B12: Ctrl K → "Jainendra" found
 * nothing). Pure, so the matching is tested without a database.
 */

export type StaffHit = {
  id: string;
  name: string;
  /** Short name, when it says something the name does not. */
  short: string | null;
  href: string;
};

type Person = { id: string; displayName: string; shortName: string; isActive: boolean };

/**
 * Active staff whose name or short name holds every word typed, the ones whose
 * name starts with it first. Where the reader may open the staff screen the
 * hit goes there; otherwise to the teacher's own timetable week.
 */
export function matchStaff(staff: readonly Person[], query: string, to: "staff" | "timetable", limit = 4): StaffHit[] {
  const words = query.toLocaleLowerCase("en").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hits = staff
    .filter((person) => person.isActive)
    .map((person) => {
      const name = person.displayName.toLocaleLowerCase("en");
      const hay = `${name} ${person.shortName.toLocaleLowerCase("en")}`;
      return { person, ok: words.every((word) => hay.includes(word)), starts: name.startsWith(words[0]) };
    })
    .filter((row) => row.ok)
    .sort((a, b) => Number(b.starts) - Number(a.starts) || a.person.displayName.localeCompare(b.person.displayName, "en"));
  return hits.slice(0, limit).map(({ person }) => {
    const short = person.shortName.trim();
    return {
      id: person.id,
      name: person.displayName,
      short: short && short.toLocaleLowerCase("en") !== person.displayName.toLocaleLowerCase("en") ? short : null,
      href: to === "staff" ? `/staff?id=${person.id}` : `/timetable?view=teacher&teacher=${person.id}`,
    };
  });
}
