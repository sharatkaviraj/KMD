// Public, unauthenticated canonical GETs only. Never reads deployment secrets.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

const origin = "https://vppsone.vercel.app";
const projectRef = "wtgxcptmucjerhufzjcf";
const forbiddenRef = "vgqyilgstjvgohrsiwkb";
const maxAssetBytes = 2_000_000;
const maxTotalBytes = 12_000_000;
const maxAssets = 32;
let totalBytes = 0;

async function publicGet(url) {
  const target = new URL(url, origin);
  if (target.origin !== origin) throw Error("Noncanonical public preflight target refused.");
  const response = await fetch(target, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw Error(`Public preflight GET failed (${response.status}); no authentication allowed.`);
  const reader = response.body?.getReader();
  if (!reader) throw Error("Public preflight body unavailable.");
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const read = await reader.read();
      if (read.done) break;
      bytes += read.value.byteLength; totalBytes += read.value.byteLength;
      if (bytes > maxAssetBytes || totalBytes > maxTotalBytes) throw Error("Public preflight response budget exceeded.");
      chunks.push(read.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const body = Buffer.concat(chunks);
  return { pathname: target.pathname, bytes, sha256: createHash("sha256").update(body).digest("hex"), text: body.toString("utf8") };
}

const html = await publicGet("/login");
const scripts = [...html.text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => new URL(match[1], origin));
const unique = [...new Map(scripts.map(url => [url.href, url])).values()];
if (!unique.length || unique.length > maxAssets || unique.some(url => url.origin !== origin || !url.pathname.startsWith("/_next/static/") || !url.pathname.endsWith(".js"))) {
  throw Error("Public login script inventory outside canonical static budget; no authentication allowed.");
}
const assets = [html];
for (const url of unique) assets.push(await publicGet(url));
const refs = new Set(); const bindingAssets = [];
for (const asset of assets) {
  if (asset.text.includes(forbiddenRef)) throw Error("Protected LIVE reference detected; authentication prohibited.");
  const found = [...asset.text.matchAll(/([a-z0-9]{20})\.supabase\.co/gi)].map(match => match[1].toLowerCase());
  found.forEach(ref => refs.add(ref));
  if (found.includes(projectRef)) bindingAssets.push(asset.pathname);
}
if (refs.size !== 1 || !refs.has(projectRef) || !bindingAssets.length) {
  console.log(JSON.stringify({ status: "blocked", refs: [...refs], assets: assets.map(({ pathname, bytes, sha256 }) => ({ pathname, bytes, sha256 })), totalBytes }));
  throw Error("Public Supabase client binding was not exclusively exact DEV; authentication prohibited.");
}
const proof = {
  checkedAt: new Date().toISOString(), origin, projectRef, protectedLiveReferenceAbsent: true,
  method: "Unauthenticated canonical /login and its bounded same-origin static script GETs; no browser/auth/env-secret reads.",
  assets: assets.map(({ pathname, bytes, sha256 }) => ({ pathname, bytes, sha256 })),
  bindingAssets, totalBytes,
};
const output = path.resolve(process.env.PR79_READONLY_BINDING_OUTPUT ?? "../evidence/pr79-public-dev-binding.json");
writeFileSync(output, `${JSON.stringify(proof, null, 2)}\n`);
console.log(JSON.stringify({ output, checkedAt: proof.checkedAt, origin, projectRef, protectedLiveReferenceAbsent: true, assets: proof.assets.length, bindingAssets, totalBytes }));
