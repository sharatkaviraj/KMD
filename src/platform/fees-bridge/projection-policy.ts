/** The local projection adapter knows only these read models. It cannot proxy financial SQL. */
export const PROJECTION_TABLES = {
  students: "fees_bridge_students",
  classes: "fees_bridge_classes",
  academic_sessions: "fees_bridge_sessions",
} as const;

export function projectionUrl(input: URL): URL | null {
  const table = input.pathname.match(/^\/rest\/v1\/([^/]+)$/)?.[1];
  if (!table || !(table in PROJECTION_TABLES)) return null;
  const url = new URL(input);
  url.pathname = `/rest/v1/${PROJECTION_TABLES[table as keyof typeof PROJECTION_TABLES]}`;
  const select = url.searchParams.get("select");
  if (select) {
    // Keep the original result alias, so existing academic callers receive
    // `class`, `class_ref` or `classes`, exactly as their types expect.
    url.searchParams.set("select", select.replace(
      /(^|,)([A-Za-z_][A-Za-z0-9_]*:)?classes(?:!students_class_id_fkey)?(!inner)?\(/g,
      (_match, prefix: string, alias: string | undefined, inner: string | undefined) =>
        `${prefix}${alias ?? "classes:"}fees_bridge_classes!fees_bridge_students_class_id_fkey${inner ?? ""}(`,
    ));
  }
  return url;
}

export function explicitSessionOf(url: URL): string | null {
  for (const key of ["session_label", "class.session_label", "class_ref.session_label", "classes.session_label"]) {
    const value = url.searchParams.get(key);
    if (value?.startsWith("eq.")) return value.slice(3);
  }
  return null;
}
