import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";
import { aiModel, geminiConfig } from "@/lib/ai/config";
import { extractWithGemini } from "@/lib/ai/gemini";
import { AI_MAX_FILE_BYTES, AI_MAX_PAGES } from "@/lib/ai/media-limits";
import { marksPhoto, PHOTO_ACTIONS, substitutionPhoto } from "@/lib/ai/photo-schema";
import { loadPhotoPrompt } from "@/lib/ai/read-prompt";

const CASE = z.strictObject({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/i),
  action: z.enum(PHOTO_ACTIONS),
  files: z.array(z.string()).min(1).max(AI_MAX_PAGES),
  context: z.record(z.string(), z.unknown()),
  expected: z.unknown(),
});
const SPECS = { "marks-photo": marksPhoto, "substitution-photo": substitutionPhoto };
const CORE = { "marks-photo": ["roll", "name", "marks"], "substitution-photo": ["absentTeacher", "period", "classLabel", "substitute"] };
const canonical = (value) => typeof value === "string"
  ? value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase()
  : value;
const outside = (root, target) => {
  const rel = path.relative(root, target);
  return path.isAbsolute(rel) || rel === ".." || rel.startsWith(".." + path.sep);
};
function compare(expected, observed) {
  const fields = Object.keys(expected.rows[0]);
  const counts = Object.fromEntries(fields.map((key) => [key, { matched: 0, total: Math.max(expected.rows.length, observed.rows.length) }]));
  expected.rows.forEach((row, i) => fields.forEach((key) => {
    if (observed.rows[i] && canonical(row[key]) === canonical(observed.rows[i][key])) counts[key].matched++;
  }));
  return counts;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.shift();
  const location = args.shift();
  if (!["--validate-only", "--run"].includes(mode) || !location || (mode === "--validate-only" && args.length)) {
    throw new Error("Usage: npm run ai:eval -- --validate-only <private-folder> OR --run <private-folder> [model ...]");
  }
  const root = await realpath(location);
  if (!outside(await realpath(process.cwd()), root)) throw new Error("Use a private fixture folder outside this checkout.");
  const manifestFile = await realpath(path.join(root, "manifest.json"));
  if (outside(root, manifestFile) || (await stat(manifestFile)).size > 3_000_000) throw new Error("Invalid manifest path or size.");
  const manifest = z.strictObject({ cases: z.array(CASE).min(1).max(200) }).parse(JSON.parse(await readFile(manifestFile, "utf8")));
  const ids = new Set();
  const inputs = [];
  for (const sample of manifest.cases) {
    if (ids.has(sample.id)) throw new Error("Use a unique ID for each case.");
    ids.add(sample.id);
    const spec = SPECS[sample.action];
    const expected = spec.validate.parse(sample.expected);
    if (!expected.rows.length) throw new Error("Each example needs at least one typed row.");
    const files = [];
    for (const name of sample.files) {
      const file = await realpath(path.resolve(root, name));
      if (outside(root, file) || !/\.jpe?g$/i.test(file) || (await stat(file)).size > AI_MAX_FILE_BYTES) {
        throw new Error("A fixture JPEG is out of scope or too large.");
      }
      const data = await readFile(file);
      if (data.length < 4 || data[0] !== 255 || data[1] !== 216 || data[2] !== 255) throw new Error("Invalid JPEG.");
      files.push(file);
    }
    inputs.push({ ...sample, expected, files });
  }
  const amounts = Object.fromEntries(PHOTO_ACTIONS.map((action) => [action, inputs.filter((x) => x.action === action).length]));
  console.log("Validated fixtures:", amounts);
  if (mode === "--validate-only") return;
  if (Object.values(amounts).some((n) => n < 20)) throw new Error("A scored run requires at least 20 examples of each action.");
  if (process.env.GEMINI_EVAL_APPROVED !== "1") throw new Error("Set GEMINI_EVAL_APPROVED=1 for the approved, de-identified evaluation set.");
  const config = geminiConfig();
  const models = args.length ? [...new Set(args.map(aiModel))] : [config.vision];
  let passed = true;
  for (const model of models) {
    for (const action of PHOTO_ACTIONS) {
      const tally = {};
      let failed = 0;
      const instructions = await loadPhotoPrompt(action);
      const durations = [];
      for (const sample of inputs.filter((x) => x.action === action)) {
        const media = await Promise.all(sample.files.map(async (file) => ({ mimeType: "image/jpeg", data: await readFile(file) })));
        const started = performance.now();
        const result = await extractWithGemini({
          config, primary: model, useFallback: false, instructions, context: sample.context,
          media, ...SPECS[action],
        });
        durations.push(performance.now() - started);
        if (!result.ok) failed++;
        for (const [field, n] of Object.entries(compare(sample.expected, result.ok ? result.value : { rows: [] }))) {
          tally[field] ??= { matched: 0, total: 0 };
          tally[field].matched += n.matched;
          tally[field].total += n.total;
        }
      }
      const sum = CORE[action].reduce((n, field) => ({ matched: n.matched + tally[field].matched, total: n.total + tally[field].total }), { matched: 0, total: 0 });
      const percent = (n) => Math.round(10_000 * n.matched / n.total) / 100;
      durations.sort((a, b) => a - b);
      console.log(JSON.stringify({
        model, action, failed, transcriptionPct: percent(sum),
        fields: Object.fromEntries(Object.entries(tally).map(([field, n]) => [field, { ...n, pct: percent(n) }])),
        providerP50Ms: Math.round(durations[Math.floor((durations.length - 1) / 2)]),
        providerP95Ms: Math.round(durations[Math.ceil(durations.length * 0.95) - 1]),
      }));
      if (failed || (action === "marks-photo" && sum.matched / sum.total < 0.95)) passed = false;
    }
  }
  if (!passed) process.exitCode = 2;
}

main().catch((error) => {
  // Zod errors may include fixture values. Do not print private file paths or contents.
  console.error(error instanceof z.ZodError ? "The manifest does not match the documented schema." :
    ["ENOENT", "EACCES", "EISDIR"].includes(error?.code) ? "Could not open the private fixture files." :
    error instanceof SyntaxError ? "The manifest is not valid JSON." :
    error?.message?.startsWith("Usage:") || [
      "Use a private fixture folder outside this checkout.", "Invalid manifest path or size.",
      "Use a unique ID for each case.", "Each example needs at least one typed row.",
      "A fixture JPEG is out of scope or too large.", "Invalid JPEG.",
      "A scored run requires at least 20 examples of each action.",
      "Set GEMINI_EVAL_APPROVED=1 for the approved, de-identified evaluation set.",
      "Gemini is not configured", "Invalid Gemini configuration", "Unsupported Gemini model",
    ].includes(error?.message) ? error.message : "Evaluation could not complete.");
  process.exitCode = 1;
});
