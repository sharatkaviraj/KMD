import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `20261029030619` took EXECUTE on two SECURITY DEFINER staff reads away from
 * PUBLIC (and so from `anon`, the browser's publishable key). They had it
 * because every `create function` in `public` comes out callable by PUBLIC:
 * the per-schema `alter default privileges … revoke … from public` in
 * `20260523164957` cannot remove a global default. So the grant comes back on
 * the next drop-and-recreate unless that migration revokes it again.
 *
 * Ported from the fees app (65c1586e, #85). In One the fee-schema SQL lives in
 * `supabase/fee-migrations/` (D-338), and the two functions arrived with the
 * schema bootstrap rather than a file here — so the last check reads "no
 * fee-migration re-creates them after the revoke" instead of "the revoke
 * follows the last create". Applied to wtgx as
 * `fee_20261029030619_guarded_staff_reads_not_callable_by_anon`; checked there
 * with has_function_privilege('anon', …) = false on 30 Oct.
 */
const MIGRATIONS_DIR = "supabase/fee-migrations";
const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const readMigration = (name: string) =>
  readFileSync(`${MIGRATIONS_DIR}/${name}`, "utf8").toLowerCase();

const REVOKE_FILE = "20261029030619_guarded_staff_reads_not_callable_by_anon.sql";

const GUARDED_READS = [
  { name: "get_dashboard_analytics", signature: "public.get_dashboard_analytics(text)" },
  {
    name: "preview_workbook_payment_allocation",
    signature: "public.preview_workbook_payment_allocation(uuid, date)",
  },
];

describe("guarded staff reads are not callable by anon", () => {
  const sql = readMigration(REVOKE_FILE);

  it("revokes EXECUTE from public and anon, and keeps authenticated and service_role", () => {
    for (const { signature } of GUARDED_READS) {
      expect(sql).toContain(`revoke execute on function ${signature} from public, anon;`);
      expect(sql).toContain(
        `grant execute on function ${signature} to authenticated, service_role;`,
      );
    }
  });

  it("changes grants only, never a function body", () => {
    const statements = sql.replace(/--.*$/gm, "");
    expect(statements).not.toMatch(/create\s+(or\s+replace\s+)?function/);
    expect(statements).not.toMatch(/drop\s+function/);
  });

  // A drop-and-create after the revoke would bring PUBLIC's EXECUTE back.
  it.each(GUARDED_READS)(
    "no later fee-migration re-creates $name without revoking again",
    ({ name }) => {
      const createPattern = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`);
      const revokePattern = new RegExp(
        `revoke\\s+(execute|all)\\s+on\\s+function\\s+public\\.${name}\\s*\\([^)]*\\)\\s+from\\s+public\\b`,
      );
      expect(migrationFiles).toContain(REVOKE_FILE);

      let lastCreate = -1;
      let lastRevoke = -1;
      migrationFiles.forEach((file, index) => {
        const text = readMigration(file);
        if (createPattern.test(text)) lastCreate = index;
        if (revokePattern.test(text)) lastRevoke = index;
      });

      expect(
        lastRevoke,
        `${migrationFiles[lastCreate]} re-creates public.${name} after the last PUBLIC revoke`,
      ).toBeGreaterThanOrEqual(lastCreate);
    },
  );
});
