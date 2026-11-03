/**
 * A tool's output projection: an explicit allowlist of fields, nested for
 * objects and arrays. Whatever the underlying reader returns — a reason, a
 * phone number, a note, a fee figure added to it next year — only the fields
 * named here leave One (plan §4: "a field list fixed in code and pinned by a
 * test"). Unknown keys are dropped, never copied.
 */
export type Shape = { readonly [key: string]: true | Shape | readonly [Shape] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalar(value: unknown): unknown {
  // Only plain JSON scalars and arrays of them pass a `true` leaf; an object
  // under a leaf would smuggle unlisted fields through.
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value) && value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item))) return [...value];
  return null;
}

export function project(value: unknown, shape: Shape): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isRecord(value)) return out;
  for (const [key, rule] of Object.entries(shape)) {
    if (!(key in value)) continue;
    const field = value[key];
    if (rule === true) out[key] = scalar(field);
    else if (Array.isArray(rule)) out[key] = Array.isArray(field) ? field.map((item) => project(item, rule[0] as Shape)) : [];
    else out[key] = project(field, rule as Shape);
  }
  return out;
}

/** Every allowed path, dotted, `[]` for array elements — what the tests pin. */
export function shapePaths(shape: Shape, prefix = ""): string[] {
  return Object.entries(shape).flatMap(([key, rule]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (rule === true) return [path];
    if (Array.isArray(rule)) return shapePaths(rule[0] as Shape, `${path}[]`);
    return shapePaths(rule as Shape, path);
  });
}
