#!/usr/bin/env node
/**
 * Open every screen as every role, and check the answer against the map.
 *
 *   npm run smoke:roles                      # against the dev server
 *   APP_ORIGIN=https://… npm run smoke:roles
 *
 * **The permission map and the guards are two separate things, and only one of
 * them is enforced.** `permissions.ts` says who may open what; the guard at the
 * top of each page is what actually refuses. A page that asks for the wrong
 * permission — or forgets to ask — is invisible to every unit test in this
 * repo, because the test would be asserting the same map the page is wrong
 * about.
 *
 * So this reads the permission out of each page's own `requirePermission()`
 * call, works out from the map what should happen, then signs in as each role
 * and finds out what does happen. Six roles by thirty-odd screens is more
 * combinations than anybody checks by hand, and the interesting ones are always
 * the boring ones nobody thought to try.
 *
 * Dev only (rule 3), and it only ever issues GETs — it opens screens, it does
 * not press anything.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { can, staffRoles } from "../src/platform/auth/permissions.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_PROJECT_REF = "wtgxcptmucjerhufzjcf";
const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";

const env = Object.fromEntries(
  readFileSync(path.join(repoRoot, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

if (!(env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(DEV_PROJECT_REF)) {
  console.error("Refusing to run: .env.local is not the dev project (rule 3).");
  process.exit(1);
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "vppsone" },
  auth: { persistSession: false },
});

/* ------------------------------------------- what each screen asks for */

/** `/route` → the permission its own guard names, or null for "any staff". */
function guards() {
  const base = path.join(repoRoot, "src/app/(app)");
  const found = new Map();

  const walk = (dir, route) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, `${route}/${entry.name}`);
      } else if (entry.name === "page.tsx") {
        const source = readFileSync(full, "utf8").replace(/\r\n/g, "\n");

        const one = source.match(/requirePermission\(\s*"([\w:]+)"/);
        const many = source.match(/requireAnyPermission\(\s*\[([^\]]+)\]/);

        found.set(route === "" ? "/" : route, {
          any: many
            ? [...many[1].matchAll(/"([\w:]+)"/g)].map((m) => m[1])
            : null,
          permission: one ? one[1] : null,
        });
      }
    }
  };

  walk(base, "");
  return found;
}

/* ---------------------------------------------------- real ids to visit */

async function fillIds(route) {
  const pick = async (table, where = {}) => {
    let query = db.from(table).select("id").limit(1);
    for (const [k, v] of Object.entries(where)) query = query.eq(k, v);
    const { data } = await query.maybeSingle();
    return data?.id ?? null;
  };

  const map = {
    "[id]": null,
    "[paperId]": await pick("assessment_subjects"),
    "[studentId]": null,
  };

  if (route.startsWith("/assessments/[id]")) map["[id]"] = await pick("assessments");
  else if (route.startsWith("/collection/[id]")) map["[id]"] = await pick("collection_requests");
  else if (route.startsWith("/staff/[id]")) map["[id]"] = await pick("staff_profiles");
  else if (route.startsWith("/timetable/[id]")) map["[id]"] = await pick("timetable_versions");
  else if (route.startsWith("/academics/subjects/[id]")) map["[id]"] = await pick("subjects");
  else if (route.startsWith("/teach/class/[id]")) {
    const { data } = await db.from("enrolments").select("class_id").limit(1).maybeSingle();
    map["[id]"] = data?.class_id ?? null;
  } else if (route.startsWith("/teach/student/[id]")) {
    const { data } = await db.from("enrolments").select("student_id").limit(1).maybeSingle();
    map["[id]"] = data?.student_id ?? null;
  }

  if (route.includes("[studentId]")) {
    const { data } = await db.from("enrolments").select("student_id").limit(1).maybeSingle();
    map["[studentId]"] = data?.student_id ?? null;
  }

  let filled = route;
  for (const [token, value] of Object.entries(map)) {
    if (!filled.includes(token)) continue;
    if (!value) return null;
    filled = filled.replace(token, value);
  }
  return filled;
}

/* ------------------------------------------------------------ signing in */

const ACCOUNTS = {
  admin: "qa.admin@qa.vpps.local",
  office: "qa.accountant@qa.vpps.local",
  academic_coordinator: "qa.academic@qa.vpps.local",
  exam_coordinator: "qa.exam@qa.vpps.local",
  teacher: "qa.teacher@qa.vpps.local",
  view_only: "qa.viewonly@qa.vpps.local",
};

/** Sign in with a minted link and return the cookie header it leaves behind. */
async function signIn(email) {
  const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`${email}: ${error.message}`);

  const jar = new Map();
  let url = `${origin}/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=%2Fdashboard`;

  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      headers: jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {},
    });

    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      if (value === "" || raw.includes("Max-Age=0")) jar.delete(name);
      else jar.set(name, value);
    }

    const location = response.headers.get("location");
    if (!location) break;
    url = new URL(location, origin).toString();
    if (url.includes("/login")) throw new Error(`${email}: sign-in bounced to /login`);
  }

  if (jar.size === 0) throw new Error(`${email}: no session cookie`);
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

/* ------------------------------------------------------------- the visit */

async function visit(pathname, cookie) {
  let url = `${origin}${pathname}`;

  for (let hop = 0; hop < 6; hop += 1) {
    const response = await fetch(url, { redirect: "manual", headers: { cookie } });
    const location = response.headers.get("location");

    if (!location) {
      if (response.status >= 500) return "error";
      if (response.status === 404) return "not-found";
      if (response.status >= 400) return `http-${response.status}`;

      const body = await response.text();

      // **A guard that fires mid-stream does not get to set a status.** Once
      // the shell has started going out, `redirect()` cannot send a 307, so
      // Next puts the destination in a meta refresh instead and the browser
      // follows it. The response is a 200 carrying a redirect — read the
      // status alone and every refusal in the app looks like a page that
      // rendered, which is exactly what this script concluded the first time
      // it ran, about all six roles at once.
      const streamed = body.match(
        /id="__next-page-redirect"[^>]*content="[^";]*;url=([^"]+)"/,
      );

      if (streamed) {
        const target = streamed[1];
        if (target.includes("/access-denied")) return "access-denied";
        if (target.includes("/login")) return "login";
        return `redirected-to ${target}`;
      }

      // Next renders the error boundary with a 200 too, so the status alone
      // does not tell you the page threw.
      if (body.includes("कुछ गड़बड़ हो गई") || body.includes("Something went wrong")) {
        return "error";
      }
      return "rendered";
    }

    url = new URL(location, origin).toString();
    if (url.includes("/access-denied")) return "access-denied";
    if (url.includes("/login")) return "login";
  }

  return "redirect-loop";
}

/* ------------------------------------------------------------------ run */

const pages = guards();
const routes = [...pages.keys()].filter((route) => route !== "/access-denied").sort();

console.log(`${routes.length} screens × ${staffRoles.length} roles = ${routes.length * staffRoles.length} combinations\n`);

const problems = [];
let checked = 0;

for (const role of staffRoles) {
  const cookie = await signIn(ACCOUNTS[role]);
  const line = [];

  for (const route of routes) {
    const guard = pages.get(route);
    const filled = await fillIds(route);

    if (!filled) {
      line.push(`  ?  ${route} — no test row to visit`);
      continue;
    }

    const allowed = guard.any
      ? guard.any.some((p) => can({ role }, p))
      : guard.permission
        ? can({ role }, guard.permission)
        : true;

    const outcome = await visit(filled, cookie);
    checked += 1;

    const expected = allowed ? "rendered" : "access-denied";

    if (outcome !== expected) {
      const note = `${role} · ${route} · expected ${expected}, got ${outcome}` +
        (guard.permission ? ` (guard: ${guard.permission})` : guard.any ? ` (guard: any of ${guard.any.join(", ")})` : " (guard: any staff)");
      problems.push(note);
      line.push(`  ✗ ${route} — expected ${expected}, got ${outcome}`);
    }
  }

  const bad = line.length;
  console.log(`${role.padEnd(22)} ${bad === 0 ? "✓ all as the map says" : `${bad} to look at`}`);
  for (const entry of line) console.log(entry);
}

console.log(`\n${checked} combinations checked.`);

if (problems.length > 0) {
  console.log(`\n${problems.length} disagreement${problems.length === 1 ? "" : "s"} between the map and the screens:\n`);
  for (const problem of problems) console.log(`  ${problem}`);
  process.exit(1);
}

console.log("Every screen answered the way the permission map says it should.");
