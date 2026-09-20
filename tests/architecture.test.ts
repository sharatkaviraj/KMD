import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PORTED_TREES } from "../scripts/port-rewrite-imports.mjs";

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
      // Both of them. There are two service-role clients now — one per schema
      // — and a rule that names only the first is a rule the second walks past.
      expect(source).not.toMatch(/@\/platform\/supabase\/admin/);
      expect(source).not.toMatch(/@\/modules\/fees\/platform\/supabase\/admin/);
    },
  );

  it.each([
    ["platform/supabase/admin.ts"],
    ["modules/fees/platform/supabase/admin.ts"],
  ])("keeps %s behind both guards", (rel) => {
    const source = readFileSync(path.join(srcRoot, rel), "utf8");

    // Build-time: a client import fails the build.
    expect(source).toMatch(/import\s+["']server-only["']/);
    // Runtime: still true if the build stops honouring the marker.
    expect(source).toMatch(/typeof window !== "undefined"/);
  });
});

/**
 * Fee writes are deliberate.
 *
 * This replaces the old "nothing writes to the fee app's schema" rule, which
 * was CLAUDE.md rule 2 made executable. Rule 2 is gone: the fee app is being
 * folded into this one and retired, so VPPS One writes fee data now.
 *
 * The property that rule was protecting is not gone, and it is the one kept
 * here — **nothing writes fee data by accident.** Two halves:
 *
 *  1. Only the fee module and the fee screens may reach the fee clients at all.
 *  2. Any file that does must check a permission in the same file.
 *
 * The second half is load-bearing rather than tidy. Fee RLS policies key on
 * `public.users.role`, and 24 of this app's 28 staff profiles have no
 * `public.users` row — so fee writes go through the service-role client and
 * bypass RLS entirely. The permission check is not a second line of defence.
 * It is the only one.
 */
describe("fee writes are deliberate", () => {
  const FEE_CLIENT_DIR = "src/modules/fees/platform/supabase/";

  // The alias form, which is how every ported file will import it, and the
  // relative form the clients use among themselves. Matching only the first
  // would exempt exactly the four files closest to the money.
  const FEE_CLIENT_IMPORT = /@\/modules\/fees\/platform\/supabase\//;

  /*
   * "Ported" is defined in exactly one place.
   *
   * `scripts/port-rewrite-imports.mjs` already has to know which trees came
   * from School Fees, because that is what it rewrites. Writing the same list
   * here would be two lists that agree today: add a module to the port, forget
   * this one, and the new module is simply exempt from the rule that stands
   * between it and the school's money — silently, and in the direction that
   * does not fail.
   */
  const inFeeTerritory = (rel: string) =>
    PORTED_TREES.some((tree) => rel.startsWith(`${tree}/`));

  const reachesFeeData = sourceFiles.filter((file) => {
    const rel = relative(file);
    if (rel.startsWith(FEE_CLIENT_DIR)) return true;
    return FEE_CLIENT_IMPORT.test(readFileSync(file, "utf8"));
  });

  it("finds the files it is supposed to be guarding", () => {
    // `it.each([])` passes in silence. If the fee clients are ever renamed,
    // this is what says so rather than a green run that checked nothing.
    expect(reachesFeeData.map(relative)).toContain(`${FEE_CLIENT_DIR}admin.ts`);
  });

  it.each(reachesFeeData.map((file) => [relative(file), file]))(
    "%s is inside the fee module",
    (rel) => {
      expect(
        inFeeTerritory(rel),
        `${rel} reaches fee data from outside src/modules/fees/ and src/app/(app)/fees/`,
      ).toBe(true);
    },
  );

  /*
   * The door authorizes, not the library.
   *
   * This rule first said "every file that writes fee data checks a permission
   * in the same file", and twenty files failed it. They were right and the
   * rule was wrong: `modules/*<x>*\/data/queries.ts` is a library, called by an
   * action that has already checked. Requiring a second check inside it would
   * have meant either twenty redundant guards or — far likelier — somebody
   * relaxing the rule until it said nothing.
   *
   * So the rule is about **entry points**: the places a request can first
   * reach this code. A page, a route handler and a server action are doors. A
   * query module is not; nothing can call it without coming through one.
   */
  const ENTRY_POINT =
    /^src\/app\/.*\/(page|layout|route)\.tsx?$|^src\/app\/.*actions?\.ts$/;

  const WRITE_CALL =
    /\.(insert|update|upsert|delete)\(|\.rpc\(\s*["'](post_|reverse_|waive_|undo_|apply_|generate_|promote_)/;

  const CHECKS_PERMISSION =
    /assertPermission\(|requirePermission\(|requireAnyPermission\(|requireStaffPermission\(|requireAnyStaffPermission\(|staffCan\(|hasStaffPermission\(|hasAnyStaffPermission\(/;

  /*
   * Not every door is opened by a person.
   *
   * A cron route is authorized by `CRON_SECRET` and a provider webhook by its
   * signature — neither has a staff member to check a permission against, and
   * demanding one would only teach people to write a fake check. What they
   * must not be is open, so they are held to proving a machine credential
   * instead.
   */
  const CHECKS_MACHINE_CREDENTIAL =
    /CRON_SECRET|JOBS_SECRET|x-aisensy-signature|SCHOOLFEES_DOC_TOKEN|timingSafeEqual/;

  const feeWriteDoors = reachesFeeData.filter((file) => {
    const rel = relative(file);
    if (!ENTRY_POINT.test(rel)) return false;
    return WRITE_CALL.test(readFileSync(file, "utf8"));
  });

  it("finds the doors it is supposed to be guarding", () => {
    // Twenty-odd files; if this ever drops to nothing the regex has stopped
    // matching and the whole describe block is theatre.
    expect(feeWriteDoors.length).toBeGreaterThan(5);
  });

  it.each(feeWriteDoors.map((file) => [relative(file), file]))(
    "%s authorizes before it writes",
    (rel, file) => {
      const source = readFileSync(file, "utf8");
      expect(
        CHECKS_PERMISSION.test(source) || CHECKS_MACHINE_CREDENTIAL.test(source),
        `${rel} writes fee data through a client that bypasses RLS, and authorizes nobody. ` +
          "That check is the only thing between this request and the school's money.",
      ).toBe(true);
    },
  );
});

/**
 * The two message catalogues do not mix (CLAUDE.md rule 9a).
 *
 * The ported fee screens say their strings through next-intl, out of
 * `src/messages/{en,hi,hi-en}.json`. Everything else says them as Hindi/English
 * pairs from `src/messages/index.ts`, rendered with `primary()`/`secondary()`.
 * Neither was rewritten into the other — 2,094 keys on one side, 750 pairs on
 * the other — so the boundary between them has to hold.
 *
 * A file that imports both is a file where a reader's language is decided
 * twice, and the two answers can disagree: `both` renders as a pair on one
 * line and as Hindi alone on the next.
 */
describe("the two message catalogues do not mix", () => {
  const USES_NEXT_INTL = /from\s+["']next-intl/;
  const USES_PAIRS = /from\s+["']@\/messages["']/;

  const feeTerritory = (rel: string) =>
    // The same one list as the rule above, for the same reason.
    PORTED_TREES.some((tree) => rel.startsWith(`${tree}/`)) ||
    // The seam itself, and the root layout that mounts both providers.
    rel === "src/platform/i18n/request.ts" ||
    rel === "src/platform/i18n/bridge.ts" ||
    // Fixed Hindi+English pairs printed on a receipt, for a parent rather than
    // a staff member. It reads the fee catalogue because the receipt is a fee
    // document; nothing else in this app renders it.
    rel === "src/platform/i18n/bilingual-receipt.ts" ||
    rel === "src/app/layout.tsx";

  it.each(sourceFiles.map((file) => [relative(file), file]))(
    "%s reads one catalogue, not both",
    (rel, file) => {
      const source = readFileSync(file, "utf8");
      expect(
        USES_NEXT_INTL.test(source) && USES_PAIRS.test(source),
        `${rel} imports next-intl and @/messages. Pick the one its screens belong to.`,
      ).toBe(false);
    },
  );

  it.each(sourceFiles.map((file) => [relative(file), file]))(
    "%s only reaches for next-intl inside the fee screens",
    (rel, file) => {
      if (!USES_NEXT_INTL.test(readFileSync(file, "utf8"))) return;
      expect(
        feeTerritory(rel),
        `${rel} uses next-intl from outside the fee module. This app's own screens ` +
          "say their strings as pairs in src/messages/index.ts (rule 9).",
      ).toBe(true);
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
