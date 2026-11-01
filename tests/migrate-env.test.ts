import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseArgs, repoRoot, resolveMigrationHome } from "../scripts/migrate/lib/env.mjs";

describe("private migration output location", () => {
  const workspace = path.dirname(repoRoot);
  const userHome = path.join(workspace, "operator-home");
  const privateHome = `${repoRoot}-private`;

  it("preserves the profile default and HOME fallback without an override", () => {
    expect(resolveMigrationHome({ USERPROFILE: userHome })).toBe(path.join(userHome, ".vppsone-migration"));
    expect(resolveMigrationHome({ HOME: userHome })).toBe(path.join(userHome, ".vppsone-migration"));
  });

  it("uses an absolute private directory without changing the operator's home", () => {
    const env = { USERPROFILE: userHome, VPPSONE_MIGRATION_HOME: privateHome };
    expect(resolveMigrationHome(env)).toBe(privateHome);
    expect(env.USERPROFILE).toBe(userHome);
  });

  it.each(["", "relative-folder", "../outside", "."])("refuses a non-absolute override: %s", (override) => {
    expect(() => resolveMigrationHome({ VPPSONE_MIGRATION_HOME: override })).toThrow("must be an absolute path");
  });

  it.each([repoRoot, path.join(repoRoot, "private"), path.join(privateHome, "..", path.basename(repoRoot), "private")])(
    "refuses the repository or a normalized descendant: %s",
    (override) => {
      expect(() => resolveMigrationHome({ VPPSONE_MIGRATION_HOME: override })).toThrow("inside the repo");
    },
  );

  it("allows a sibling whose name starts with the repository name", () => {
    expect(resolveMigrationHome({ VPPSONE_MIGRATION_HOME: privateHome })).toBe(privateHome);
  });

  it("the CLI module uses the override for run directories without creating them", () => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e",
      "import { runDir } from './scripts/migrate/lib/env.mjs'; console.log(runDir('test-run-20261101', { create: false }));",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, VPPSONE_MIGRATION_HOME: privateHome },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(path.join(privateHome, "test-run-20261101"));
  });
});

describe("held-profile approval argument", () => {
  it.each([
    ["--accept-held", "qa-teacher-a,qa-teacher-b", "--rollback-only"],
    ["--accept-held=qa-teacher-a,qa-teacher-b", "--rollback-only"],
  ])("preserves the exact explicit list in either supported form: %j", (...args) => {
    expect(parseArgs(args)).toEqual({
      _: [], "accept-held": "qa-teacher-a,qa-teacher-b", "rollback-only": true,
    });
  });
});
