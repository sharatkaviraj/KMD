import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";
import { aiModel, providerConfig } from "@/lib/ai/config";
import { AI_MAX_FILE_BYTES, AI_MAX_PAGES } from "@/lib/ai/media-limits";
import { marksPhoto, PHOTO_ACTIONS, substitutionPhoto } from "@/lib/ai/photo-schema";
import { extractWithProviders } from "@/lib/ai/providers";
import { loadPhotoPrompt } from "@/lib/ai/read-prompt";
import { voiceSpec } from "@/lib/ai/voice-schema";

class InputError extends Error {}
const ACTIONS = [...PHOTO_ACTIONS, "voice"];
const CASE = z.strictObject({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/i),
  action: z.enum(ACTIONS), files: z.array(z.string()).min(1).max(AI_MAX_PAGES),
  context: z.record(z.string(), z.unknown()), expected: z.unknown(),
});
const SPECS = { "marks-photo": marksPhoto, "substitution-photo": substitutionPhoto, voice: voiceSpec };
const CORE = { "marks-photo": ["roll", "name", "marks"], "substitution-photo": ["absentTeacher", "period", "classLabel", "substitute"] };
const STAGES = ["gemini-free", "anthropic", "openai-claude", "gemini-paid"];
const AUDIO = { ".mp4": "audio/mp4", ".m4a": "audio/mp4", ".wav": "audio/wav", ".webm": "audio/webm" };
const outside = (root, target) => {
  const rel = path.relative(root, target);
  return path.isAbsolute(rel) || rel === ".." || rel.startsWith(".." + path.sep);
};
function canonical(value) {
  if (typeof value === "string") return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value;
}
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function tallyRows(tally, expected, actual) {
  const fields = new Set(expected.flatMap((row) => Object.keys(row)));
  for (const key of fields) {
    tally[key] ??= { matched: 0, total: 0 };
    tally[key].total += Math.max(actual.length - expected.length, 0);
    expected.forEach((row, i) => {
      if (!Object.hasOwn(row, key)) return;
      tally[key].total++;
      if (actual[i] && equal(row[key], actual[i][key])) tally[key].matched++;
    });
  }
}

async function loadManifest(root, mode) {
  const manifestFile = await realpath(path.join(root, "manifest.json"));
  if (outside(root, manifestFile) || (await stat(manifestFile)).size > 3_000_000) throw new InputError("Invalid manifest path or size.");
  const manifest = z.strictObject({
    provenance: z.enum(["synthetic", "school-approved-deidentified"]).optional(),
    cases: z.array(CASE).min(1).max(200),
  }).parse(JSON.parse(await readFile(manifestFile, "utf8")));
  if (mode === "--run" && manifest.provenance !== "school-approved-deidentified") {
    throw new InputError("Acceptance scoring requires a school-approved, de-identified handwriting and audio set.");
  }
  if (mode === "--run-synthetic" && manifest.provenance !== "synthetic") {
    throw new InputError("Synthetic scoring requires a manifest marked synthetic.");
  }
  const ids = new Set();
  const inputs = [];
  for (const sample of manifest.cases) {
    if (ids.has(sample.id)) throw new InputError("Use a unique ID for each case.");
    ids.add(sample.id);
    const expected = SPECS[sample.action].validate.parse(sample.expected);
    const voice = sample.action === "voice";
    if (voice ? sample.files.length !== 1 : !expected.rows.length) {
      throw new InputError("Use one clip per voice case and at least one row per photo case.");
    }
    const files = [];
    for (const name of sample.files) {
      const file = await realpath(path.resolve(root, name));
      const ext = path.extname(file).toLowerCase();
      const mimeType = voice ? AUDIO[ext] : /^\.jpe?g$/i.test(ext) ? "image/jpeg" : null;
      if (outside(root, file) || !mimeType || (await stat(file)).size > AI_MAX_FILE_BYTES) {
        throw new InputError("A fixture file is out of scope, the wrong format, or too large.");
      }
      const bytes = await readFile(file);
      const valid = mimeType === "image/jpeg" ? bytes.subarray(0, 3).equals(Buffer.from([255,216,255]))
        : mimeType === "audio/wav" ? bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WAVE"
        : mimeType === "audio/webm" ? bytes.subarray(0, 4).equals(Buffer.from([26,69,223,163]))
        : bytes.subarray(4, 8).toString() === "ftyp" && bytes.includes("soun") && !bytes.includes("vide");
      if (!valid) throw new InputError("A fixture has an invalid media header.");
      files.push({ file, mimeType });
    }
    inputs.push({ ...sample, expected, files });
  }
  return { provenance: manifest.provenance ?? "unspecified", inputs };
}

function selection(value, config, synthetic) {
  if (STAGES.includes(value)) {
    if (!synthetic && value === "gemini-free") throw new InputError("The free provider is for synthetic fixtures only.");
    return { providerOnly: value, config };
  }
  // Old model-ID arguments still work; select the tier explicitly when it matters.
  const model = aiModel(value);
  const free = synthetic && Boolean(config.freeApiKey);
  return { providerOnly: free ? "gemini-free" : "gemini-paid", config: { ...config, model, vision: model, paidModel: model } };
}
function stagesFor(config, synthetic) {
  return [
    synthetic && config.freeApiKey ? "gemini-free" : null,
    config.anthropicApiKey ? "anthropic" : null,
    config.openAiApiKey && config.anthropicApiKey ? "openai-claude" : null,
    config.paidApiKey ? "gemini-paid" : null,
  ].filter(Boolean);
}
const supports = (stage, action) => action === "voice" ? stage !== "anthropic" : stage !== "openai-claude";

async function main() {
  const [mode, location, ...selectors] = process.argv.slice(2);
  if (!["--validate-only", "--run", "--run-synthetic"].includes(mode) || !location || (mode === "--validate-only" && selectors.length)) {
    throw new InputError("Usage: npm run ai:eval -- --validate-only <folder> OR (--run | --run-synthetic) <folder> [provider or Gemini model ...]");
  }
  const root = await realpath(location);
  if (!outside(await realpath(process.cwd()), root)) throw new InputError("Use a private fixture folder outside this checkout.");
  const { provenance, inputs } = await loadManifest(root, mode);
  const amounts = Object.fromEntries(ACTIONS.map((action) => [action, inputs.filter((x) => x.action === action).length]));
  console.log("Validated fixtures:", { provenance, ...amounts });
  if (mode === "--validate-only") return;
  const synthetic = mode === "--run-synthetic";
  if (PHOTO_ACTIONS.some((action) => amounts[action] < 20) || (!synthetic && amounts.voice < 3)) {
    throw new InputError("A scored run needs 20 cases of each photo action; the handwriting benchmark also requires at least three reviewed voice clips.");
  }
  if (process.env.GEMINI_EVAL_APPROVED !== "1") throw new InputError("Set GEMINI_EVAL_APPROVED=1 only when this provider evaluation is approved.");
  const config = providerConfig();
  const available = stagesFor(config, synthetic);
  const selected = (selectors.length ? [...new Set(selectors)] : available).map((v) => selection(v, config, synthetic));
  if (!selected.length || selected.some((s) => !available.includes(s.providerOnly))) throw new InputError("A selected provider is not configured or not eligible for this fixture set.");
  let passed = true;
  for (const { providerOnly, config: chosen } of selected) {
    for (const action of ACTIONS.filter((id) => amounts[id] && supports(providerOnly, id))) {
      const tally = {};
      const models = new Set();
      let failed = 0;
      const instructions = action === "voice"
        ? await readFile(path.join(process.cwd(), "src/lib/ai/prompts/voice.md"), "utf8") : await loadPhotoPrompt(action);
      const durations = [];
      for (const sample of inputs.filter((x) => x.action === action)) {
        const media = await Promise.all(sample.files.map(async ({ file, mimeType }) => ({ mimeType, data: await readFile(file) })));
        const started = performance.now();
        const result = await extractWithProviders({
          config: chosen, task: action === "voice" ? "voice" : "image", providerOnly,
          instructions, context: sample.context, media, ...SPECS[action],
        });
        durations.push(performance.now() - started);
        for (const a of result.attempts) models.add(a.provider + ":" + a.model + (a.modelVersion ? "@" + a.modelVersion : ""));
        if (!result.ok) failed++;
        if (action === "voice") tallyRows(tally, [sample.expected], result.ok ? [result.value] : []);
        else tallyRows(tally, sample.expected.rows, result.ok ? result.value.rows : []);
      }
      const core = CORE[action] ?? ["intent"];
      const sum = core.reduce((n, field) => ({ matched: n.matched + tally[field].matched, total: n.total + tally[field].total }), { matched: 0, total: 0 });
      const percent = (n) => Math.round(10_000 * n.matched / n.total) / 100;
      durations.sort((a, b) => a - b);
      console.log(JSON.stringify({
        provider: providerOnly, models: [...models], action, failed, primaryFieldsPct: percent(sum),
        eligibility: synthetic ? "synthetic-only" : "handwriting-and-audio-benchmark",
        fields: Object.fromEntries(Object.entries(tally).map(([field, n]) => [field, { ...n, pct: percent(n) }])),
        providerP50Ms: Math.round(durations[Math.floor((durations.length - 1) / 2)]),
        providerP95Ms: Math.round(durations[Math.ceil(durations.length * 0.95) - 1]),
      }));
      if (failed || (!synthetic && action === "marks-photo" && sum.matched / sum.total < 0.95)) passed = false;
    }
  }
  if (!passed) process.exitCode = 2;
}

main().catch((error) => {
  // Zod/provider/OS errors can contain private fixture values, paths or tokens.
  console.error(error instanceof InputError ? error.message : error instanceof z.ZodError ? "The manifest does not match the documented schema." :
    ["ENOENT", "EACCES", "EISDIR"].includes(error?.code) ? "Could not open the private fixture files." :
    error instanceof SyntaxError ? "The manifest is not valid JSON." : "Evaluation could not complete; check model selection and server environment.");
  process.exitCode = 1;
});
