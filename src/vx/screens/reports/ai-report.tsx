"use client";

import { useRef, useState, type ReactNode } from "react";

import {
  base64Bytes, EXAMPLE_QUESTIONS, mergeWorkbooks, photoFileName, photoIndexCsv, readmeText, reportBaseName,
  type AiPhoto, type AiPhotoSkip, type ReadmeInput,
} from "@/modules/ai-report/domain/bundle";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { SwitchRow } from "@/vx/ui/controls";
import { useToast } from "@/vx/ui/overlays";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card, Pill } from "@/vx/ui/primitives";

/*
 * Reports → AI report (7 Nov 2026): one file with everything One and Fees
 * hold for a year, to give to ChatGPT. The server sends it in parts, because
 * one response cannot pass 4.5 MB on Vercel: One's records, Fees' records,
 * then the photographs forty at a time. This page joins them into one Excel
 * file (and a .zip with the photographs) in the browser and saves it.
 */

export type AiReportPart = { ok: true } | { ok: false; reason: Pair };

type StepKey = "school" | "fees" | "photos" | "file";
type Step = { state: "wait" | "run" | "done" | "skip" | "fail"; note?: Pair };
type Steps = Record<StepKey, Step>;
type Made = { name: string; bytes: number };

const T = {
  title: p("AI report", "AI रिपोर्ट"),
  lead: (s: string) => p(
    `Everything VPPS One and the Fees app hold for ${s}, in one file. Give it to ChatGPT and ask for any report you need.`,
    `${s} का सब कुछ, VPPS One और फीस ऐप दोनों से, एक फ़ाइल में। इसे ChatGPT को दें और जो रिपोर्ट चाहिए, माँग लें।`,
  ),
  inside: p("What is in the file", "फ़ाइल में क्या है"),
  one: p("From VPPS One", "VPPS One से"),
  oneSub: p(
    "Students and admissions, collected details (Aadhaar, phones, addresses), attendance, marks and exams, notes on children, support plans, timetable and cover, calendar, messages, staff.",
    "विद्यार्थी व प्रवेश, एकत्रित जानकारी (आधार, फ़ोन, पते), हाज़िरी, अंक व परीक्षा, बच्चों के नोट्स, सहायता योजनाएँ, समय-सारणी व व्यवस्था, कैलेंडर, संदेश, स्टाफ़।",
  ),
  ownOnly: p(
    "This account gets the sheets its role can see: its own notes, and One's fee follow-ups. The whole school's records need an administrator, office or coordinator role.",
    "इस खाते को वही शीटें मिलेंगी जो इसकी भूमिका देख सकती है: अपने नोट्स और One के फीस फ़ॉलो-अप। पूरे स्कूल का रिकॉर्ड प्रशासक, कार्यालय या समन्वयक भूमिका को मिलता है।",
  ),
  fees: p("From the Fees app", "फीस ऐप से"),
  feesSub: p(
    "Fee structure, every installment, payments and receipts, discounts, dues and defaulters, late fees (always kept apart), previous-year dues, follow-up calls.",
    "फीस ढाँचा, हर किस्त, भुगतान व रसीदें, छूट, बकाया व डिफ़ॉल्टर, विलंब शुल्क (हमेशा अलग), पिछले साल का बकाया, फ़ॉलो-अप कॉल।",
  ),
  photos: p("Student photographs", "विद्यार्थियों की फ़ोटो"),
  photosSub: p('Each named "SR no - Name (Class)", with a list of them.', 'हर फ़ोटो "SR नं - नाम (कक्षा)" नाम से, साथ में उनकी सूची।'),
  privateT: p("Private: keep this file safe", "निजी: यह फ़ाइल सुरक्षित रखें"),
  private: p(
    "It holds children's Aadhaar numbers, parents' phone numbers and addresses, marks, health and family notes and photographs. Do not forward it or post it in a group. Delete it when your report is done.",
    "इसमें बच्चों के आधार नंबर, अभिभावकों के फ़ोन नंबर व पते, अंक, स्वास्थ्य व परिवार के नोट्स और फ़ोटो हैं। इसे आगे न भेजें, किसी ग्रुप में न डालें। रिपोर्ट बनने के बाद फ़ाइल हटा दें।",
  ),
  withPhotos: p("Include photographs", "फ़ोटो भी जोड़ें"),
  withPhotosSub: p("Makes a .zip file: bigger and slower. Off gives the Excel file alone.", ".zip फ़ाइल बनेगी: बड़ी और धीमी। बंद करने पर केवल Excel फ़ाइल।"),
  make: p("Make the AI report", "AI रिपोर्ट बनाएँ"),
  again: p("Make it again", "फिर से बनाएँ"),
  working: p("Making the file. Keep this page open.", "फ़ाइल बन रही है। यह पेज खुला रखें।"),
  steps: {
    school: p("VPPS One records", "VPPS One का रिकॉर्ड"),
    fees: p("Fees records", "फीस का रिकॉर्ड"),
    photos: p("Photographs", "फ़ोटो"),
    file: p("Putting the file together", "फ़ाइल तैयार करना"),
  } satisfies Record<StepKey, Pair>,
  saved: (name: string, size: string) => p(`Saved ${name} (${size}). Check your Downloads.`, `${name} (${size}) सेव हो गई। डाउनलोड में देखें।`),
  failed: p("The file could not be made.", "फ़ाइल नहीं बन सकी।"),
  off: p("switched off", "बंद किया गया"),
  how: p("How to use it with ChatGPT", "ChatGPT के साथ कैसे इस्तेमाल करें"),
  how1: p("Open ChatGPT and attach the file.", "ChatGPT खोलें और फ़ाइल जोड़ें।"),
  how2: (s: string) => p(
    `Write: "This is my school's data for ${s}. Read the _README sheet first." Then ask for the report you need, in English or Hindi.`,
    `लिखें: "This is my school's data for ${s}. Read the _README sheet first." फिर जो रिपोर्ट चाहिए, अंग्रेज़ी या हिंदी में माँगें।`,
  ),
  how3: p("For any number you will act on, ask which sheet and which rows it used.", "जिस संख्या पर काम करना हो, पूछें कि वह किस शीट और किन पंक्तियों से आई।"),
  examples: p("Questions to try", "ये सवाल पूछकर देखें"),
  copy: p("Copy", "कॉपी"),
  copied: p("Copied", "कॉपी हो गया"),
};

/** Why a part is missing, in the read-me's words (English: the file is for ChatGPT). */
const README_WHY = {
  off: "the photographs switch was off when the file was made",
};

class PartError extends Error {
  constructor(public readonly words: Pair) {
    super(words.en);
  }
}

/** One part from the server, or its JSON error in words. */
async function fetchPart(url: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  } catch {
    throw new PartError(p("No connection. Check the internet and try again.", "कनेक्शन नहीं है। इंटरनेट देखकर फिर कोशिश करें।"));
  }
  if (response.ok) return response;
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  const message = body?.error?.message;
  throw new PartError(message ? p(message) : p(`The server said ${response.status}. Try again in a minute.`, `सर्वर ने ${response.status} कहा। एक मिनट बाद फिर कोशिश करें।`));
}

type PhotoPage =
  | { source: "fees"; photos: AiPhoto[]; skipped: AiPhotoSkip[]; next: string | null; total: number | null }
  | { source: "none"; reason: string };

/** The photographs as files for the .zip, or why they are not in it (`missing`, in the read-me's words). */
type PhotoPart = { files: Record<string, Uint8Array>; index: string; listed: number; skipped: number; total: number; missing: string | null };

const noPhotos = (missing: string): PhotoPart => ({ files: {}, index: "", listed: 0, skipped: 0, total: 0, missing });

/**
 * Every page of photographs, one after another. Each is turned into bytes as
 * it arrives, so the page's text is dropped before the next one is asked for.
 */
async function readPhotos(query: URLSearchParams, progress: (step: Step) => void, stopped: () => boolean): Promise<PhotoPart> {
  const files: Record<string, Uint8Array> = {};
  const listed: { file: string; photo: Pick<AiPhoto, "admissionNo" | "fullName" | "classLabel" | "status"> }[] = [];
  const skipped: AiPhotoSkip[] = [];
  const taken = new Set<string>();
  let total: number | null = null;
  let after: string | null = null;
  try {
    do {
      if (stopped()) return noPhotos("the report was stopped");
      const page = (await (await fetchPart(`/api/reports/ai/photos?${query}${after ? `&after=${after}` : ""}`)).json()) as PhotoPage;
      if (page.source === "none") {
        progress({ state: "skip", note: p(page.reason) });
        return noPhotos(page.reason);
      }
      total ??= page.total;
      for (const photo of page.photos) {
        const file = photoFileName(photo, taken);
        files[file] = base64Bytes(photo.data);
        listed.push({ file, photo: { admissionNo: photo.admissionNo, fullName: photo.fullName, classLabel: photo.classLabel, status: photo.status } });
      }
      skipped.push(...page.skipped);
      const whole = total ?? listed.length;
      progress({ state: "run", note: p(`${listed.length} of ${whole}`, `${whole} में से ${listed.length}`) });
      after = page.next;
    } while (after);
  } catch (error) {
    const words = error instanceof PartError ? error.words : p("They could not be read just now.", "अभी पढ़ी नहीं जा सकीं।");
    progress({ state: "fail", note: words });
    return noPhotos(`the photographs stopped part-way (${words.en}); make the report again to include them`);
  }
  progress({ state: "done", note: p(`${listed.length} photographs`, `${listed.length} फ़ोटो`) });
  return { files, index: photoIndexCsv(listed, skipped), listed: listed.length, skipped: skipped.length, total: total ?? listed.length, missing: null };
}

function megabytes(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/** "2026-11-07 10:42", India time, for the read-me. */
function istNow(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

function save(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Long enough for a slow phone to start writing the file.
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/** Let the step list paint before the heavy, synchronous joining starts. */
const paint = () => new Promise<void>((resolve) => window.setTimeout(resolve, 60));

const STEP_LOOK: Record<Step["state"], { icon: IconName; color: string; spin?: boolean }> = {
  wait: { icon: "clock", color: "var(--mut)" },
  run: { icon: "refresh", color: "var(--acc)", spin: true },
  done: { icon: "checkCircle", color: "var(--ok)" },
  skip: { icon: "minus", color: "var(--mut)" },
  fail: { icon: "alert", color: "var(--bad)" },
};

export function AiReport({
  sessionLabel,
  madeBy,
  schoolWide,
  fees,
  photos,
}: {
  sessionLabel: string;
  madeBy: string;
  /** Whether this reader gets the whole school's One records or only their own share. */
  schoolWide: boolean;
  fees: AiReportPart;
  photos: AiReportPart;
}) {
  const { tx } = useVx();
  const toast = useToast();
  const [withPhotos, setWithPhotos] = useState(photos.ok);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Steps | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const [failure, setFailure] = useState<Pair | null>(null);
  // Which run the step list belongs to: a run that ended early (One's half
  // failed) may still hear back from Fees after "Make it again" was pressed.
  const runs = useRef(0);

  async function make() {
    const run = ++runs.current;
    const setStep = (key: StepKey, step: Step) => {
      if (runs.current === run) setSteps((current) => (current ? { ...current, [key]: step } : current));
    };
    const photosOn = photos.ok && withPhotos;
    setBusy(true);
    setMade(null);
    setFailure(null);
    setSteps({
      school: { state: "run" },
      fees: fees.ok ? { state: "run" } : { state: "skip", note: fees.reason },
      photos: photosOn ? { state: "wait" } : { state: "skip", note: photos.ok ? T.off : photos.reason },
      file: { state: "wait" },
    });
    const query = new URLSearchParams({ session: sessionLabel });
    const base = reportBaseName(sessionLabel);
    let stopped = false;

    try {
      // One's half and Fees' half are separate systems: read them side by side.
      const schoolTask = fetchPart(`/api/reports/ai/school?${query}`).then(async (response) => {
        const bytes = new Uint8Array(await response.arrayBuffer());
        const rows = Number(response.headers.get("X-Ai-Report-Rows") ?? 0);
        setStep("school", { state: "done", note: p(`${rows.toLocaleString("en-IN")} rows`, `${rows.toLocaleString("en-IN")} पंक्तियाँ`) });
        return { bytes, students: Number(response.headers.get("X-Ai-Report-Students") ?? 0) };
      });
      const feesTask: Promise<{ bytes: Uint8Array | null; why: string | null }> = fees.ok
        ? fetchPart(`/api/reports/ai/fees?${query}`).then(
            async (response) => {
              const bytes = new Uint8Array(await response.arrayBuffer());
              setStep("fees", { state: "done", note: p(megabytes(bytes.byteLength)) });
              return { bytes, why: null };
            },
            (error: unknown) => {
              const words = error instanceof PartError ? error.words : p("It could not be read just now.", "अभी पढ़ा नहीं जा सका।");
              setStep("fees", { state: "fail", note: words });
              return { bytes: null, why: `the Fees app could not send them just now (${words.en})` };
            },
          )
        : Promise.resolve({ bytes: null, why: fees.reason.en });
      // A failed One half ends the run (and stops the photographs); Fees' own
      // failure only leaves its sheets out.
      schoolTask.catch((error: unknown) => {
        stopped = true;
        setStep("school", { state: "fail", note: error instanceof PartError ? error.words : undefined });
      });

      // The photographs go one page at a time, after Fees' workbook, so Fees
      // is never asked for both at once.
      const photoTask = feesTask.then((): Promise<PhotoPart> | PhotoPart => {
        if (!photosOn) return noPhotos(photos.ok ? README_WHY.off : photos.reason.en);
        if (stopped) return noPhotos("the report was stopped");
        setStep("photos", { state: "run" });
        return readPhotos(query, (step) => { if (!stopped) setStep("photos", step); }, () => stopped);
      });

      const [school, feesPart, photoPart] = await Promise.all([schoolTask, feesTask, photoTask]);

      setStep("file", { state: "run" });
      await paint();
      const XLSX = await import("xlsx");
      let workbook: Uint8Array;
      let separateFees: Uint8Array | null = null;
      try {
        workbook = mergeWorkbooks(XLSX, school.bytes, feesPart.bytes);
      } catch {
        // Too big to join on this device: keep the two files side by side.
        workbook = school.bytes;
        separateFees = feesPart.bytes;
      }

      const workbookName = `${base}.xlsx`;
      const feesName = `${base}-fees.xlsx`;
      const photosIn = photosOn && photoPart.missing === null;
      if (!photosIn && !separateFees) {
        save(workbook, workbookName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        setStep("file", { state: "done" });
        setMade({ name: workbookName, bytes: workbook.byteLength });
        return;
      }

      const readme: ReadmeInput = {
        sessionLabel,
        madeAt: istNow(),
        madeBy,
        workbook: workbookName,
        fees: feesPart.bytes ? { included: true } : { included: false, reason: feesPart.why ?? "not available" },
        photos: photoPart.missing !== null
          ? { included: false, reason: photoPart.missing }
          : { included: photoPart.listed, withoutPhoto: Math.max(0, school.students - photoPart.total), skipped: photoPart.skipped },
        separateFeesFile: separateFees ? feesName : null,
      };
      const { strToU8, zipSync } = await import("fflate");
      const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 | 6 }]> = {
        "READ-ME-FIRST.txt": [strToU8(readmeText(readme)), { level: 6 }],
        // Excel files and photographs are already compressed: store them.
        [workbookName]: [workbook, { level: 0 }],
      };
      if (separateFees) entries[feesName] = [separateFees, { level: 0 }];
      if (photoPart.index) entries["photos/index.csv"] = [strToU8(photoPart.index), { level: 6 }];
      for (const [name, bytes] of Object.entries(photoPart.files)) entries[name] = [bytes, { level: 0 }];
      const zipped = zipSync(entries);
      const zipName = `${base}.zip`;
      save(zipped, zipName, "application/zip");
      setStep("file", { state: "done" });
      setMade({ name: zipName, bytes: zipped.byteLength });
    } catch (error) {
      const words = error instanceof PartError ? error.words : T.failed;
      setFailure(words);
      setSteps((current) => (current ? { ...current, file: current.file.state === "run" ? { state: "fail", note: words } : current.file } : current));
    } finally {
      setBusy(false);
    }
  }

  async function copy(question: string) {
    try {
      await navigator.clipboard.writeText(question);
      toast.show({ text: tx(T.copied), tone: "ok", ms: 1600 });
    } catch {
      toast.show({ text: question, tone: "info" });
    }
  }

  const part = (icon: IconName, title: Pair, sub: Pair, state: AiReportPart, extra?: ReactNode) => (
    <li style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderTop: "1px solid var(--bd)" }}>
      <span style={{ width: 36, height: 36, borderRadius: 12, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: state.ok ? "var(--accs)" : "var(--s3)", color: state.ok ? "var(--accfg)" : "var(--mut)" }}>
        <Ic n={icon} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ fontWeight: 700 }}>{tx(title)}</span>
        <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(sub)}</span>
        {state.ok ? extra : <span style={{ fontSize: 13, color: "var(--warnfg)" }}>{tx(state.reason)}</span>}
      </span>
    </li>
  );

  return (
    <VxPage label={tx(T.title)}>
      <TopBar crumb="Reports" title={tx(T.title)} mSub={sessionLabel} mBack="/reports" />
      <Section style={{ maxWidth: 820 }}>
        <p style={{ margin: 0, fontSize: 15 }}>{tx(T.lead(sessionLabel))}</p>

        <Card>
          <h2 className="sech" style={{ marginBottom: 6 }}>{tx(T.inside)}</h2>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {part("database", T.one, T.oneSub, { ok: true }, schoolWide ? null : <span style={{ fontSize: 13, color: "var(--warnfg)" }}>{tx(T.ownOnly)}</span>)}
            {part("rupee", T.fees, T.feesSub, fees)}
            {part("camera", T.photos, T.photosSub, photos)}
          </ul>
        </Card>

        <Card style={{ borderColor: "var(--warn)", background: "var(--warns)" }}>
          <span style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Ic n="lock" size={20} style={{ color: "var(--warnfg)", marginTop: 2 }} />
            <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <strong style={{ color: "var(--warnfg)" }}>{tx(T.privateT)}</strong>
              <span style={{ fontSize: 14 }}>{tx(T.private)}</span>
            </span>
          </span>
        </Card>

        <Card>
          {photos.ok ? <SwitchRow icon="camera" title={tx(T.withPhotos)} sub={tx(T.withPhotosSub)} on={withPhotos} onChange={setWithPhotos} /> : null}
          <Btn variant="pri" big full icon={busy ? undefined : "download"} disabled={busy} onClick={() => void make()}>
            {busy ? tx(T.working) : tx(made || failure ? T.again : T.make)}
          </Btn>
          {steps ? (
            <ol aria-live="polite" style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {(Object.keys(T.steps) as StepKey[]).map((key) => {
                const step = steps[key];
                const look = STEP_LOOK[step.state];
                return (
                  <li key={key} style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 28 }}>
                    <Ic n={look.icon} className={look.spin ? "spin" : undefined} style={{ color: look.color }} />
                    <span style={{ flex: 1, minWidth: 0, fontWeight: step.state === "run" ? 700 : 500, color: step.state === "skip" ? "var(--mut)" : undefined }}>{tx(T.steps[key])}</span>
                    {step.note ? <span style={{ fontSize: 13, color: step.state === "fail" ? "var(--bad)" : "var(--mut)", textAlign: "right", maxWidth: "55%" }}>{tx(step.note)}</span> : null}
                  </li>
                );
              })}
            </ol>
          ) : null}
          {made ? (
            <p role="status" style={{ margin: "14px 0 0", display: "flex", gap: 8, alignItems: "center", color: "var(--ok)", fontWeight: 600 }}>
              <Ic n="checkCircle" /> {tx(T.saved(made.name, megabytes(made.bytes)))}
            </p>
          ) : null}
          {failure ? (
            <p role="alert" style={{ margin: "14px 0 0", color: "var(--bad)", fontWeight: 600 }}>
              {tx(T.failed)} {failure.en !== T.failed.en ? tx(failure) : null}
            </p>
          ) : null}
        </Card>

        <Card>
          <h2 className="sech" style={{ marginBottom: 10 }}>{tx(T.how)}</h2>
          <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
            <li>{tx(T.how1)}</li>
            <li>{tx(T.how2(sessionLabel))}</li>
            <li>{tx(T.how3)}</li>
          </ol>
          <h2 className="sech" style={{ margin: "16px 0 8px" }}>{tx(T.examples)}</h2>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {EXAMPLE_QUESTIONS.map((question) => (
              <li key={question} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", borderRadius: 12, background: "var(--s2)" }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{question}</span>
                <Btn variant="ghost" icon="copy" ariaLabel={`${tx(T.copy)}: ${question}`} onClick={() => void copy(question)} />
              </li>
            ))}
          </ul>
          <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--mut)" }}>
            <Pill tone="mut">ChatGPT</Pill> {tx(p("Any assistant that reads Excel files works the same way.", "Excel फ़ाइल पढ़ने वाला कोई भी सहायक ऐसे ही काम करेगा।"))}
          </p>
        </Card>
      </Section>
    </VxPage>
  );
}
