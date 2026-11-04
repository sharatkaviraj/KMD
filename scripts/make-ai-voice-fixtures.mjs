#!/usr/bin/env node
/** Windows offline SAPI voice. No hosted speech or school data. */
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rows = [
  ["attendance_query", "How many students are absent in class seven B today?", { classLabel: "7B" }],
  ["attendance_mark", "Mark Avi Sample absent in class seven B.", { studentName: "Avi Sample", classLabel: "7B", attendanceStatus: "absent" }],
  ["single_mark", "Enter twenty one point five marks for Bela Demo in maths, Unit Test One, class seven B.",
    { studentName: "Bela Demo", classLabel: "7B", subject: "maths", exam: "Unit Test One", mark: "21.5" }],
  ["who_is_free", "Who is free for period five today?", { period: 5 }],
  ["student_note", "Add a progress note for Jai Example in class seven B. Finished the reading exercise.",
    { studentName: "Jai Example", classLabel: "7B", note: "Finished the reading exercise." }],
  ["substitution", "Assign R M Sir to cover Q T Madam for period four in class seven B.",
    { teacher: "QT Madam", substitute: "RM Sir", period: 4, classLabel: "7B" }],
];
const runner = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  foreach ($item in (ConvertFrom-Json $env:VPPSONE_AI_FIXTURE_PLAN)) {
    $synth.SetOutputToWaveFile($item.file)
    $synth.Speak($item.text)
    $synth.SetOutputToNull()
  }
} finally { $synth.Dispose() }
`;

async function main() {
  const [folder, ...rest] = process.argv.slice(2);
  if (!folder || rest.length || process.platform !== "win32") throw new Error("Usage on Windows: npm run ai:voice-fixtures -- <existing synthetic fixture folder>");
  const root = await realpath(folder);
  const checkout = await realpath(process.cwd());
  const relative = path.relative(checkout, root);
  if (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep)) throw new Error("Choose a fixture folder outside the checkout.");
  const filename = await realpath(path.join(root, "manifest.json"));
  if (path.dirname(filename) !== root) throw new Error("Invalid fixture manifest location.");
  const manifest = JSON.parse(await readFile(filename, "utf8"));
  if (manifest.provenance !== "synthetic" || !Array.isArray(manifest.cases) || manifest.cases.some((c) => c.action === "voice")) {
    throw new Error("Use a fresh pack explicitly marked synthetic.");
  }
  await mkdir(path.join(root, "voice"));
  const cases = rows.map(([intent, transcript, fields], i) => ({
    id: "voice-" + String(i + 1).padStart(2, "0"), action: "voice",
    files: ["voice/voice-" + String(i + 1).padStart(2, "0") + ".wav"],
    context: { language: "en", tools: [{ intent }], date: "2026-11-04" },
    expected: { intent, transcript, unclear: false, ...fields },
  }));
  const plan = cases.map((c) => ({ file: path.join(root, c.files[0]), text: c.expected.transcript }));
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", runner], {
    env: { ...process.env, VPPSONE_AI_FIXTURE_PLAN: JSON.stringify(plan) }, encoding: "utf8", windowsHide: true,
  });
  if (result.status !== 0) throw new Error("Offline Windows speech synthesis failed.");
  manifest.cases.push(...cases);
  await writeFile(filename, JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(path.join(root, "voice", "README.md"),
    "Six fictional English commands synthesized offline with Windows SAPI. These clips test fixture plumbing and intent fields, not human speech or Hindi/Hinglish accuracy.\n");
  console.log("Added six synthetic voice cases.");
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
