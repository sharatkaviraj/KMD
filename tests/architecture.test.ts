import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(repoRoot, "src");

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const sourceFiles = walk(srcRoot).filter((file) => /\.tsx?$/.test(file));

function relative(file: string) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

/**
 * The one architectural rule CLAUDE.md asks to be enforced: pure logic imports
 * no database.
 *
 * `src/modules/*<x>*\/domain/` is where that logic lives once there are
 * modules; `permissions.ts` is the same kind of file living in `platform/`
 * because every layer needs it. Both are covered here, so the rule is a test
 * failure rather than a review comment.
 */
const DB_IMPORT = /from\s+["'](@\/platform\/supabase\/|@supabase\/|next\/headers|next\/cache)/;

describe("pure logic stays pure", () => {
  const pureFiles = sourceFiles.filter((file) => {
    const rel = relative(file);
    return rel.includes("/domain/") || rel === "src/platform/auth/permissions.ts";
  });

  it("finds the files it is supposed to be guarding", () => {
    // A glob that silently matches nothing is a test that always passes.
    expect(pureFiles.map(relative)).toContain("src/platform/auth/permissions.ts");
  });

  it.each(pureFiles.map((file) => [relative(file), file]))(
    "%s imports no database and no request context",
    (_rel, file) => {
      const source = readFileSync(file, "utf8");
      expect(DB_IMPORT.test(source)).toBe(false);
    },
  );
});

describe("the service-role key cannot reach the browser", () => {
  const clientComponents = sourceFiles.filter((file) =>
    /^["']use client["']/.test(readFileSync(file, "utf8").trimStart()),
  );

  it("finds the Client Components it is supposed to be guarding", () => {
    // `it.each([])` produces no tests and passes in silence. If the detection
    // ever stops matching, this is what says so instead of a green run that
    // checked nothing.
    expect(clientComponents.map(relative)).toContain(
      "src/app/login/login-form.tsx",
    );
  });

  it.each(clientComponents.map((file) => [relative(file), file]))(
    "%s does not import the admin client",
    (_rel, file) => {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/@\/platform\/supabase\/admin/);
    },
  );

  it("keeps the admin client behind both guards", () => {
    const source = readFileSync(
      path.join(srcRoot, "platform/supabase/admin.ts"),
      "utf8",
    );

    // Build-time: a client import fails the build.
    expect(source).toMatch(/import\s+["']server-only["']/);
    // Runtime: still true if the build stops honouring the marker.
    expect(source).toMatch(/typeof window !== "undefined"/);
  });
});

describe("nothing writes to the fee app's schema", () => {
  // Rule 2. `public` is SELECT-only from here, so a write verb on a
  // `.schema("public")` chain is the shape to catch. Reads are expected and
  // arrive in Phase 1.6.
  const forbidden = /\.schema\(\s*["']public["']\s*\)[\s\S]{0,200}?\.(insert|update|upsert|delete)\(/;

  it.each(sourceFiles.map((file) => [relative(file), file]))(
    "%s does not write through .schema(\"public\")",
    (_rel, file) => {
      expect(forbidden.test(readFileSync(file, "utf8"))).toBe(false);
    },
  );
});

describe("migrations", () => {
  const migrationsDir = path.join(repoRoot, "supabase/migrations");
  const migrations = readdirSync(migrationsDir).filter((file) =>
    file.endsWith(".sql"),
  );

  it("has migrations to check", () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it.each(migrations)("%s is numbered after the fee app's history", (file) => {
    // docs/SETUP.md: 20260916160100 is the highest version already recorded on
    // this database. A lower number sorts before rows that are already applied.
    const version = file.slice(0, 14);
    expect(version).toMatch(/^\d{14}$/);
    expect(Number(version)).toBeGreaterThan(20260916160100);
  });

  it.each(migrations)("%s creates nothing in public", (file) => {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8")
      // Comments explain the rule; only statements can break it.
      .replace(/--[^\n]*/g, "");

    expect(
      /\bcreate\s+(or\s+replace\s+)?(table|view|function|type|index|trigger|policy|materialized\s+view)\s+(if\s+not\s+exists\s+)?public\./i.test(
        sql,
      ),
      `${file} creates an object in public`,
    ).toBe(false);

    expect(
      /\balter\s+table\s+(only\s+)?public\./i.test(sql),
      `${file} alters a table in public`,
    ).toBe(false);
  });
});
