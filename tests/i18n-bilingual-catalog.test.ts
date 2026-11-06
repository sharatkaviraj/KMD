import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { bilingualCatalog, bilingualLabel } from "@/platform/i18n/bilingual-catalog";

const catalogue = (name: string) =>
  JSON.parse(readFileSync(path.join(process.cwd(), "src", "messages", `${name}.json`), "utf8")) as Record<string, unknown>;

describe("the fee screens for a reader of both languages (A-23)", () => {
  it("puts both on a short label and keeps sentences and fragments English", () => {
    expect(bilingualLabel("Receipts", "रसीदें")).toBe("Receipts · रसीदें");
    expect(bilingualLabel("Recovery rate", "वसूली दर")).toBe("Recovery rate · वसूली दर");
    expect(bilingualLabel("of", "का")).toBe("of");
    expect(bilingualLabel("No upcoming reminders for the selected filters.", "कोई नहीं।")).toBe("No upcoming reminders for the selected filters.");
    expect(bilingualLabel("{count, plural, one {# child} other {# children}}", "{count} बच्चे")).toBe("{count, plural, one {# child} other {# children}}");
    expect(bilingualLabel("WhatsApp", "WhatsApp")).toBe("WhatsApp");
    expect(bilingualLabel("Due in {count} days", "{count} दिन में देय")).toBe("Due in {count} days · {count} दिन में देय");
  });

  it("keeps every key of the English catalogue, and nothing else", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
        typeof v === "object" && v ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
      );
    const en = catalogue("en");
    const both = bilingualCatalog(en as never, catalogue("hi") as never);
    expect(keys(both)).toEqual(keys(en));
  });

  it("has no Hindi string lost to question marks", () => {
    const raw = readFileSync(path.join(process.cwd(), "src", "messages", "hi.json"), "utf8");
    expect(raw).not.toMatch(/\?{3}/);
  });
});
