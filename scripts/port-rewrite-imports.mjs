/**
 * Rewrites imports in code ported from School Fees.
 *
 * Both repos use `@/` over the same `src/{app,modules,platform,ui}` layout,
 * which is why most of a 600-file port needed no edits at all. This handles
 * the paths that exist in both repos and mean different things — and one of
 * them is not cosmetic:
 *
 * **`@/platform/supabase/*` is the dangerous one.** Fee code calls
 * `.from("students")` with no `.schema()`, because `public` was its default.
 * Left pointing at this app's clients, every one of those queries would
 * silently address `vppsone.students`. Nothing would throw; the reads would
 * just come back empty, and the writes would land in the wrong schema or
 * nowhere.
 *
 * Committed rather than run once and forgotten, so the rewrite is auditable:
 * when somebody asks in a year why a ported file imports from
 * `@/modules/fees/platform/supabase`, this file is the answer.
 *
 *   node scripts/port-rewrite-imports.mjs            # rewrite
 *   node scripts/port-rewrite-imports.mjs --check    # fail if anything is left
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CHECK_ONLY = process.argv.includes("--check");

/**
 * `tests/architecture.test.ts` imports `PORTED_TREES` from this file so the
 * two agree about what "ported" means by construction rather than by
 * somebody remembering to edit both. That import must not rewrite the repo,
 * so everything below the list runs only when this is the entry point.
 */
const RUN_AS_SCRIPT =
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

/**
 * Where ported code lives. Only these trees are rewritten — this app's own
 * files must keep importing this app's own clients.
 */
export const PORTED_TREES = [
  "src/modules/fees",
  "src/modules/dashboard",
  "src/modules/payments",
  "src/modules/receipts",
  "src/modules/transactions",
  "src/modules/defaulters",
  "src/modules/imports",
  "src/modules/exports",
  "src/modules/reports",
  "src/modules/recovery",
  "src/modules/promotion",
  "src/modules/activity",
  "src/modules/master-data",
  "src/modules/finance-controls",
  "src/modules/prev-year-dues",
  "src/modules/repayment-plans",
  "src/modules/system-sync",
  "src/modules/whatsapp",
  "src/modules/staff-fees",
  "src/modules/students-fees",
  "src/ui",
  "src/platform/helpers",
  "src/platform/money",
  "src/platform/locale",
  "src/platform/navigation",
  "src/platform/telemetry",
  "src/platform/observability",
  "src/platform/session",
  "src/platform/db",
  "src/platform/excel",
  "src/platform/pdf",
  "src/app/(app)/fees",
  "src/app/api/fees",
  "src/app/pay",
  // Razorpay's webhook at the same path as the fees app's (go-live Phase E,
  // plan §7.1); `/api/fees/webhooks/razorpay` re-exports it.
  "src/app/api/webhooks",
  // The fees app's public receipt check, `/r/[code]` there. `/r/` is a
  // SamPark token here, so it moved to `/rv/` (go-live critique A2).
  "src/app/rv",
];

/**
 * This app's own files that happen to live inside a ported tree.
 *
 * `src/ui` is mostly School Fees' kit now, but a handful of files in it are
 * this app's and always were. They import this app's navigation map and this
 * app's Supabase clients, and both of those names also exist on the fee side
 * meaning something else — so without this list the rewrite quietly points
 * them at the wrong one.
 *
 * It has caught that twice: once here, and once when `src/modules/students`
 * was in PORTED_TREES and this app's directory repo started reading the fee
 * schema. Both times the code still compiled.
 */
const NOT_PORTED = new Set(
  [
    "src/ui/shell/app-shell.tsx",
    "src/ui/shell/bottom-nav.tsx",
    "src/ui/panel.tsx",
    "src/ui/task-hero.tsx",
    "src/ui/text.tsx",
    "src/ui/authored-text.tsx",
    "src/ui/environment-badge.tsx",
    "src/ui/print-landscape.tsx",
    "src/ui/states/index.tsx",
    "src/ui/primitives/index.tsx",

    /*
     * Rewritten from scratch on the way in, so it is this app's file now.
     *
     * The ported version wrote `public.users.preferred_locale`, which nothing
     * here reads — the language lives in
     * `vppsone.staff_profiles.preferred_language`. So it deliberately uses
     * *this* app's admin client, and the rewrite rules would point it back at
     * the fee schema and undo the fix.
     */
    "src/platform/locale/actions.ts",

    /*
     * Written here, not moved here.
     *
     * The shim that answers the fee app's ~90 `requireAuthenticatedStaff()`
     * calls from this app's session. It is inside a ported tree because that
     * is where the fee code looks for it, but nothing in it came across — and
     * its comments name the fee app's old `/auth/login` to explain what
     * changed, which the URL rules would helpfully rewrite into nonsense.
     */
    "src/modules/fees/platform/session.ts",

    /*
     * The two nav bars now read BOTH navigation maps — the fee app's, for
     * the tablet topbar it still derives, and this app's `navIconFor()`,
     * because a component reference cannot be sent from the server. So an
     * `@/platform/config/navigation` import in them is deliberate, and the
     * rewrite rule would helpfully point it at the fee one and undo it.
     */
    "src/ui/shell/sidebar-nav.tsx",
    "src/ui/shell/mobile-bottom-nav.tsx",
  ].map((p) => path.resolve(p)),
);

/**
 * Ordered, and the order matters: the supabase rules are prefixes of each
 * other, so the most specific has to win first.
 */
const RULES = [
  // The fee app's Supabase clients default to `public`; this app's default to
  // `vppsone`. See the note at the top — this is the rule that stops a ported
  // query silently addressing the wrong schema.
  ["@/platform/supabase/cache-safe", "@/modules/fees/platform/supabase/cache-safe"],
  ["@/platform/supabase/server", "@/modules/fees/platform/supabase/server"],
  ["@/platform/supabase/client", "@/modules/fees/platform/supabase/client"],
  ["@/platform/supabase/admin", "@/modules/fees/platform/supabase/admin"],

  // `session.ts` in the fee app is the auth session. Here it is the shim that
  // answers from `vppsone.staff_profiles` instead of `public.users` (D-6).
  ["@/platform/supabase/session", "@/modules/fees/platform/session"],

  // The fee role vocabulary. This app's own roles are in
  // `@/platform/auth/permissions`, and the two are bridged by
  // `@/platform/auth/fee-roles`.
  ["@/platform/auth/roles", "@/modules/fees/platform/roles"],

  // Route metadata and the mobile-takeover list are fee-screen concerns. This
  // app's `@/platform/config/navigation` is the navigation map for every role
  // and is not the fee app's.
  ["@/platform/config/navigation", "@/modules/fees/config/navigation"],

  // The fee app's academic-session switcher, not a login session. Moved so
  // nobody reads `@/platform/session` as auth.
  ["@/platform/session/", "@/modules/fees/platform/session-context/"],

  // One sign-in door. The fee app's `/auth/login` is not ported.
  ["@/app/auth/login/actions", "@/app/login/actions"],

  // `students` and `staff` exist in both repos and mean different things.
  // This app's `students` is the school directory: name, class, SR number.
  // The fee app's is the fee desk's student workspace, with money on it.
  // Neither is a better name, so the ported ones carry the suffix.
  ["@/modules/students/", "@/modules/students-fees/"],
  ["@/modules/staff/", "@/modules/staff-fees/"],

  // Fee routes move from `/protected/*` to `(app)/fees/*`.
  ["@/app/protected/", "@/app/(app)/fees/"],
];

/**
 * URLs, not module specifiers.
 *
 * The fee app writes its own routes as strings in about 670 places — `<Link
 * href>`, `redirect()`, `revalidatePath()`, the navigation config, the
 * service worker's precache list. Every one of them pointed at `/protected`,
 * which is not a route in this app.
 *
 * These are applied to the whole file rather than only inside quotes, because
 * a route also appears inside template literals
 * (`` `/protected/students/${id}` ``) and in prose comments that should move
 * with it. Ordered: the two specific redirections must win over the general
 * prefix.
 */
const URL_RULES = [
  // This app already has an access-denied screen that names the permission and
  // the role, and it is not under /fees — a refusal is not a fee screen.
  ["/protected/access-denied", "/access-denied"],

  // One sign-in door.
  ["/auth/login", "/login"],

  // Everything else.
  ["/protected", "/fees"],
];

function walk(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (/\.(ts|tsx|mjs)$/.test(full)) out.push(full);
  }
  return out;
}

if (RUN_AS_SCRIPT) main();

function main() {
const files = PORTED_TREES.flatMap((tree) => walk(path.resolve(tree))).filter(
  (file) => !NOT_PORTED.has(file),
);

let changed = 0;
const remaining = [];

for (const file of files) {
  const before = readFileSync(file, "utf8");
  let after = before;

  for (const [from, to] of RULES) {
    // Only inside a module specifier, so a path mentioned in a comment or a
    // string is left alone.
    after = after.split(`"${from}`).join(`"${to}`);
    after = after.split(`'${from}`).join(`'${to}`);
  }

  for (const [from, to] of URL_RULES) {
    after = after.split(from).join(to);
  }

  if (after !== before) {
    changed += 1;
    if (!CHECK_ONLY) writeFileSync(file, after);
  }

  if (CHECK_ONLY && after !== before) {
    remaining.push(path.relative(process.cwd(), file));
  }
}

  if (CHECK_ONLY) {
    if (remaining.length > 0) {
      console.error(
        `port imports: ${remaining.length} ported file(s) still import a path that means ` +
          "something else here:\n  " +
          remaining.join("\n  ") +
          "\n\nRun `node scripts/port-rewrite-imports.mjs`.\n",
      );
      process.exit(1);
    }
    console.log(
      `port imports: ${files.length} ported files, none left to rewrite.`,
    );
  } else {
    console.log(
      `port imports: rewrote ${changed} of ${files.length} ported files.`,
    );
  }
}
