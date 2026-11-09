import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { catalogRows } from "@/modules/whatsapp/domain/template-catalog";

/**
 * The template registry's seed (`20261109062459_school_whatsapp.sql`) is the
 * catalogue `scripts/whatsapp-template-catalog.mjs` printed from the app's own
 * descriptors (D-562). A descriptor that gains a slot without a new registry
 * row would be refused at send time as a mismatch — safe, but silent until a
 * parent goes without a message — so the two are held together here.
 */

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/20261109062459_school_whatsapp.sql"), "utf8");
const SEED = /^\s*\('([a-z0-9_]+)', '([a-z0-9_]+)', '(hi|en)', '([a-z_]+)', (\d+), array\[([^\]]*)\]::text\[\], '(none|document)', (true|false), /gm;

const seeded = new Map(
  [...SQL.matchAll(SEED)].map((match) => [
    match[1]!,
    {
      providerName: match[2]!,
      language: match[3]!,
      feature: match[4]!,
      bodyParams: Number(match[5]),
      paramNames: match[6]!.split(",").map((name) => name.trim().replace(/^'|'$/g, "")).filter(Boolean),
      header: match[7]!,
      urlButton: match[8] === "true",
    },
  ]),
);

describe("the WhatsApp template registry's seed", () => {
  const rows = catalogRows();

  it("lists something, and never a _v6 template (its Pay now belongs to the fees app)", () => {
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.some((row) => /_v6$/.test(row.key))).toBe(false);
    expect([...seeded.keys()].some((key) => /_v6$/.test(key))).toBe(false);
  });

  it.each(rows.map((row) => [row.key, row] as const))("%s is seeded exactly as the app sends it", (key, row) => {
    const seed = seeded.get(key);
    expect(seed, `${key} is missing from the migration's seed`).toBeDefined();
    expect(seed).toEqual({
      providerName: key,
      language: row.languageCode,
      feature: row.feature,
      bodyParams: row.bodyParams,
      paramNames: [...row.paramNames],
      header: row.header,
      urlButton: row.urlButton,
    });
    expect(row.paramNames).toHaveLength(row.bodyParams);
  });

  it("starts every row unapproved: approval on the fees app's AiSensy account does not carry over", () => {
    expect(SQL).toMatch(/status\s+text\s+not null\s+default\s+'not_submitted'/);
  });
});
