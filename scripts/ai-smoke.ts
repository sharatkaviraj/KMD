/**
 * `npm run ai:smoke`: one tiny text and one small image request with the free
 * Gemini key on every candidate model, the same on the paid key's model, and
 * a probe of the Anthropic and OpenAI keys. Prints pass/fail and the best
 * Flash model that works on the free key. Reads keys from the environment
 * (and `.env.local` if present); never prints a key or a provider's message.
 *
 * Production keys are Vercel secrets, which `vercel env pull` cannot return:
 * run the same check on the server from Settings → Built-in AI → Check keys.
 */
import "./alias-hook.mjs";

const { runAiSmoke } = await import("@/lib/ai/smoke");

const report = await runAiSmoke(process.env);
const rows = report.results.map((row) => ({
  key: row.key, type: row.keyType, model: row.model, probe: row.probe,
  result: row.ok ? "pass" : `fail ${row.problem ?? ""}${row.httpStatus ? ` ${row.httpStatus}` : ""}`.trim(),
  ms: row.ms, note: row.note ?? "",
}));
console.table(rows);
if (report.missing.length) console.log(`Not configured here: ${report.missing.join(", ")}`);
console.log(`Configured GEMINI_MODEL: ${report.configuredModel}`);
console.log(report.recommended
  ? `Best Flash model on the free key: ${report.recommended}`
  : "No candidate model passed both probes on the free key.");
process.exitCode = report.results.length && report.results.every((row) => row.ok) ? 0 : 1;
