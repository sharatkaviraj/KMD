import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { db } from "../e2e/support/harness";
import { qaAccount } from "../fixtures/qa-accounts";

export const origin = "https://vppsone.vercel.app";
export const project = "wtgxcptmucjerhufzjcf";
export type Actor = "accountant" | "admin" | "teacher";
export type GuardEvidence = { blockedWrites: { method: string; pathname: string }[]; blockedExternalGets: number };

export function releaseGuard() {
  const expected = process.env.PR79_READONLY_DEPLOYED_SHA ?? "";
  if (!/^[0-9a-f]{40}$/.test(expected)) throw Error("Exact deployed SHA is required.");
  const file = process.env.PR79_READONLY_DEPLOYMENT_FILE;
  if (!file) throw Error("Fresh coordinator deployment/project proof is required.");
  const proof = JSON.parse(readFileSync(path.resolve(file), "utf8"));
  if (proof.state !== "READY" || proof.target !== "production" || proof.sha !== expected || !proof.aliases?.includes(new URL(origin).hostname)) throw Error("Canonical READY deployment proof does not match the authorized SHA.");
  const checkedAt = Date.parse(proof.checkedAt), projectCheckedAt = Date.parse(proof.projectCheckedAt), productionEnvCheckedAt = Date.parse(proof.productionEnvCheckedAt);
  if (![checkedAt, projectCheckedAt, productionEnvCheckedAt].every(at => Number.isFinite(at) && at <= Date.now() && Date.now() - at < 15 * 60_000) || proof.projectRef !== project) throw Error("Fresh exact DEV identity and production binding proof is missing; no auth or database action allowed.");
  // Canonical release metadata alone does not prove the app's actual database.
  // Coordinator reads only this NONSECRET public URL via the official Vercel API;
  // no key or other decrypted environment value is required by this check.
  if (proof.productionPublicUrl !== `https://${project}.supabase.co` || proof.productionEnvTarget !== "production"
    || !Number.isFinite(proof.productionEnvUpdatedAt) || !Number.isFinite(proof.deploymentCreatedAt)
    || proof.productionEnvUpdatedAt > proof.deploymentCreatedAt) throw Error("Actual production public database URL is not verified exact DEV for this deployment; authentication prohibited.");
  if (execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== expected) throw Error("Local source does not match the deployed SHA.");
  const env = readFileSync(".env.local", "utf8");
  const url = env.split(/\r?\n/).find(line => line.startsWith("NEXT_PUBLIC_SUPABASE_URL="))?.slice("NEXT_PUBLIC_SUPABASE_URL=".length).trim();
  if (!url || new URL(url).hostname !== `${project}.supabase.co`) throw Error("Local read-only/auth client is not exact DEV.");
  return { sha: expected, origin, project, checkedAt: proof.checkedAt, projectCheckedAt: proof.projectCheckedAt, productionPublicUrl: proof.productionPublicUrl, productionEnvCheckedAt: proof.productionEnvCheckedAt, productionEnvUpdatedAt: proof.productionEnvUpdatedAt, deploymentCreatedAt: proof.deploymentCreatedAt, databaseBindingMethod: "Official Vercel production NONSECRET public URL only; not inferred from a test session or client script absence." };
}

export async function guardContext(context: BrowserContext): Promise<GuardEvidence> {
  const evidence: GuardEvidence = { blockedWrites: [], blockedExternalGets: 0 };
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== "GET") {
      evidence.blockedWrites.push({ method: request.method(), pathname: url.pathname });
      return route.abort("blockedbyclient");
    }
    if (url.origin !== origin) { evidence.blockedExternalGets += 1; return route.abort("blockedbyclient"); }
    return route.continue();
  });
  return evidence;
}

// The only non-read API operation is an ephemeral magic link for an independently
// verified existing QA identity. No account, password, profile or grant is created.
export async function signInExisting(page: Page, actor: Actor, next: string) {
  const account = qaAccount(actor);
  const listed = await db().auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = listed.data?.users.find(candidate => candidate.email === account.email);
  if (listed.error || !user || !account.canSignIn || !account.email.endsWith("@qa.vpps.local")) throw Error("Existing QA identity unavailable; refusing account creation.");
  const profile = await db().from("staff_profiles").select("id,user_id,role,is_active").eq("user_id", user.id).single();
  if (profile.error || !profile.data?.is_active || profile.data.role !== account.role) throw Error("Existing QA profile binding/role unavailable; no grant changes allowed.");
  const link = await db().auth.admin.generateLink({ type: "magiclink", email: account.email });
  if (link.error || link.data?.user.id !== user.id || !link.data.properties.hashed_token) throw Error("Existing QA magic link unavailable; identity unchanged.");
  try {
    await page.goto(`/auth/confirm?token_hash=${link.data.properties.hashed_token}&type=magiclink&next=${encodeURIComponent(next)}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForURL(url => url.origin === origin && url.pathname === new URL(next, origin).pathname, { timeout: 60_000 });
  } catch {
    // A failed auth URL must not leak its one-time token into Playwright context.
    await page.goto("about:blank").catch(() => undefined);
    throw Error("QA GET authentication did not settle; token URL withheld.");
  }
  return { userId: user.id, staffId: profile.data.id };
}

export async function geometry(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  return target.evaluate(element => {
    const r = element.getBoundingClientRect(), navElement = document.querySelector("nav.vx-bottom"), nav = navElement?.getBoundingClientRect();
    const navVisible = Boolean(nav && nav.width > 0 && nav.height > 0);
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { width: r.width, height: r.height, top: r.top, bottom: r.bottom, withinViewport: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1, ownsCenter: hit === element || Boolean(hit && element.contains(hit)), navVisible, gap: navVisible && nav ? nav.top - r.bottom : null, viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth, coarse: matchMedia("(pointer: coarse)").matches };
  });
}

export async function trustedTap(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await target.evaluate(element => element.addEventListener("click", event => element.setAttribute("data-pr79-trusted-click", String(event.isTrusted)), { once: true }));
  await target.tap();
  await expect(target).toHaveAttribute("data-pr79-trusted-click", "true");
}

export { db };
