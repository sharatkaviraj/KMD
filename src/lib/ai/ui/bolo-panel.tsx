"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { AI_INPUT_BUCKET } from "@/lib/ai/media-limits";
import type { VoiceResult, VoiceReview } from "@/lib/ai/voice-review";
import { attendanceLabels, attendanceStatuses, type AttendanceTally } from "@/modules/attendance/domain/attendance";
import { createClient } from "@/platform/supabase/client";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { Sheet } from "@/vx/ui/overlays";
import { Btn, Card, CardHead } from "@/vx/ui/primitives";

import { VoiceButton } from "./voice-button";

const problems = {
  quota: p("You’ve reached today’s recording limit.", "आज की रिकॉर्डिंग सीमा पूरी हो गई है।"),
  upload: p("Could not upload this recording. Check your connection and try again.", "रिकॉर्डिंग अपलोड नहीं हुई। इंटरनेट जाँचकर फिर कोशिश करें।"),
  parse: p("Could not read the recording. Try speaking again.", "रिकॉर्डिंग पढ़ी नहीं गई। फिर बोलकर देखें।"),
  stale: p("The record changed since this review. Close and record a new request.", "जाँच के बाद रिकॉर्ड बदल गया। बंद करके नया अनुरोध रिकॉर्ड करें।"),
  save: p("The record could not be saved. Open it in the app to check its current state.", "रिकॉर्ड सहेजा नहीं गया। उसकी स्थिति ऐप में खोलकर जाँचें।"),
  retry_save: p("The save could not be confirmed. Tap Save again to check the same request.", "सहेजने की पुष्टि नहीं हुई। इसी अनुरोध की जाँच के लिए फिर सहेजें दबाएँ।"),
  unavailable: p("Bolo is temporarily unavailable. Try again in a moment.", "बोलो अभी उपलब्ध नहीं है। थोड़ी देर बाद फिर कोशिश करें।"),
};

const clarification = {
  unsupported: p("Bolo couldn’t identify a request available to you. Try one request at a time.", "बोलो आपके लिए उपलब्ध अनुरोध पहचान नहीं पाया। एक बार में एक अनुरोध बोलें।"),
  target: p("Bolo couldn’t match the details to one record. Say the full class and the exact name or roll number.", "बोलो को एक रिकॉर्ड नहीं मिला। पूरी कक्षा और सही नाम या रोल नंबर बोलें।"),
  register: p("Check the register. For a new register, say who is present for the whole class. For a correction, include a reason.", "हाज़िरी रजिस्टर जाँचें। नए रजिस्टर के लिए पूरी कक्षा की हाज़िरी बताएँ। सुधार के लिए कारण बोलें।"),
  mark: p("The spoken mark doesn’t fit this paper’s marking rules.", "बोला गया अंक इस पेपर के अंक नियमों के अनुसार नहीं है।"),
  schedule: p("Bolo couldn’t verify a timetable or date for this request.", "बोलो इस अनुरोध की समय-सारणी या तारीख़ जाँच नहीं पाया।"),
  cover: p("Bolo couldn’t verify this cover. Check the period and the two teachers in Substitutions.", "बोलो इस बदली की पुष्टि नहीं कर पाया। बदली में पीरियड और दोनों शिक्षकों को जाँचें।"),
};

async function post<T>(operation: "upload" | "parse" | "apply" | "discard", body: object): Promise<T> {
  const response = await fetch(`/api/ai/voice/${operation}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok !== true) throw new Error(data?.code ?? "unavailable");
  return data as T;
}

function Tally({ counts }: { counts: AttendanceTally }) {
  const { tx } = useVx();
  return <p>{attendanceStatuses.map((status) => {
    const label = attendanceLabels[status];
    return `${tx(label)} ${counts[status]}`;
  }).join(" · ")}{counts.complete ? null : ` · ${tx(p("Marked", "दर्ज"))} ${counts.marked}/${counts.total}`}</p>;
}

function Result({ result }: { result: VoiceResult }) {
  const { tx } = useVx();
  switch (result.kind) {
    case "clarify": return <p>{tx(clarification[result.reason])}</p>;
    case "attendance_answer": {
      const { classLabel, day, student, saved, status, tally, absent } = result;
      return <div className="space-y-2">
        <p className="font-semibold">{[classLabel, day, student].filter(Boolean).join(" · ")}</p>
        {!saved ? <p>{tx(p("Attendance has yet to be saved for this class and date.", "इस कक्षा और तारीख़ की हाज़िरी अभी सहेजी नहीं गई है।"))}</p>
          : student ? <p>{status ? tx(attendanceLabels[status]) : tx(p("There is no saved mark for this student.", "इस विद्यार्थी की हाज़िरी दर्ज नहीं है।"))}</p>
          : tally ? <Tally counts={tally} /> : null}
        {absent && (absent.length ? <>
          <p className="font-semibold">{tx(p("Marked absent", "अनुपस्थित दर्ज"))}</p>
          <ul className="list-disc space-y-1 pl-5">{absent.map(({ name, roll }, index) => (
            <li key={index}>{[roll, name].filter(Boolean).join(" · ")}</li>
          ))}</ul>
        </> : <p>{tx(p("No students are marked absent.", "कोई विद्यार्थी अनुपस्थित दर्ज नहीं है।"))}</p>)}
      </div>;
    }
    case "period_answer": {
      const { day, requested, periods } = result;
      const answer = requested !== null
        ? periods.includes(requested) ? p(`You are free in period ${requested}.`, `आप पीरियड ${requested} में खाली हैं।`)
          : p(`You are unavailable in period ${requested}.`, `आप पीरियड ${requested} में उपलब्ध नहीं हैं।`)
        : periods.length ? p(`Your free periods are ${periods.join(", ")}.`, `आपके खाली पीरियड ${periods.join(", ")} हैं।`)
          : p("You have no free periods.", "आपका कोई खाली पीरियड नहीं है।");
      return <div className="space-y-2"><p className="font-semibold">{day}</p><p>{tx(answer)}</p></div>;
    }
    case "available_teachers": return <div className="space-y-2">
      <p className="font-semibold">{result.day} · {tx(p(`Period ${result.period}`, `पीरियड ${result.period}`))}</p>
      {result.teachers.length ? <>
        <p>{tx(p("Available teachers", "उपलब्ध शिक्षक"))}</p>
        <ul className="list-disc space-y-1 pl-5">{result.teachers.map((name) => <li key={name}>{name}</li>)}</ul>
      </> : <p>{tx(p("No teachers are available in this period.", "इस पीरियड में कोई शिक्षक उपलब्ध नहीं है।"))}</p>}
    </div>;
    case "attendance_mark": return <div className="space-y-2">
      <p className="font-semibold">{result.classLabel} · {result.day}</p>
      <p>{tx(result.correction ? p("Register correction", "हाज़िरी सुधार") : p("New class register", "नई कक्षा हाज़िरी"))}</p>
      <Tally counts={result.tally} />
      {result.changes.length > 0 && <ul className="list-disc space-y-1 pl-5">{result.changes.map(({ name, roll, status }, index) => (
        <li key={index}>{[roll, name, tx(attendanceLabels[status])].filter(Boolean).join(" · ")}</li>
      ))}</ul>}
      {result.reason && <p dir="auto" className="break-words">{tx(p("Reason", "कारण"))} · {result.reason}</p>}
    </div>;
    case "single_mark": return <div className="space-y-2">
      <p className="font-semibold">{[result.classLabel, result.roll, result.student].filter(Boolean).join(" · ")}</p>
      <p>{tx(result.exam)} · {tx(result.subject)}</p>
      <p>{tx(p("Current", "मौजूदा"))} {result.previous ?? "—"} · {tx(p("New", "नया"))} {result.mark === null ? tx(p("Absent", "अनुपस्थित")) : `${result.mark}/${result.max}`}</p>
      <p>{tx(p("This saves one mark as a draft.", "यह एक अंक का मसौदा सहेजता है।"))}</p>
    </div>;
    case "student_note": return <div className="space-y-2">
      <p className="font-semibold">{[result.classLabel, result.roll, result.student].filter(Boolean).join(" · ")}</p>
      <p>{tx(result.category)}</p>
      <p dir="auto" className="whitespace-pre-wrap break-words">{result.note}</p>
    </div>;
    case "substitution": return <div className="space-y-2">
      <p className="font-semibold">{result.classLabel} · {result.day} · {tx(p(`Period ${result.period}`, `पीरियड ${result.period}`))}</p>
      <p>{result.subject} · {result.teacher} → {result.substitute}</p>
    </div>;
  }
}

/** What Bolo can be asked from the quick-substitute shortcut. */
const COVER_HINT = p(
  "Say the period, class, who is away and who covers. For example: “Period 3, class 7B, Sharma ji is absent, Verma ji will take it.” Or ask: “Who is free in period 5?”",
  "पीरियड, कक्षा, कौन अनुपस्थित है और कौन लेगा, यह बोलें। जैसे: “पीरियड 3, कक्षा 7B, शर्मा जी अनुपस्थित हैं, वर्मा जी लेंगे।” या पूछें: “पीरियड 5 में कौन खाली है?”",
);

export function BoloPanel() {
  const { tx } = useVx();
  const [open, setOpen] = useState(false);
  const title = tx(p("Bolo", "बोलो"));
  return <>
    <Card>
      <CardHead title={title} sub={tx(p("Ask about your school day or prepare an update by voice.", "अपने स्कूल के दिन के बारे में पूछें या बोलकर बदलाव तैयार करें।"))}
        action={<Btn icon="mic" variant="soft" onClick={() => setOpen(true)}>{tx(p("Open Bolo", "बोलो खोलें"))}</Btn>} />
    </Card>
    <BoloSheet open={open} onClose={() => setOpen(false)} />
  </>;
}

/**
 * Bolo in a sheet: hold to speak, see the transcript and the checked result,
 * Save for a write. `cover` opens it from the quick-substitute shortcut with
 * an example of a cover request.
 */
export function BoloSheet({ open, onClose, cover = false }: { open: boolean; onClose: () => void; cover?: boolean }) {
  const { tx } = useVx();
  const router = useRouter();
  const [busy, setBusy] = useState<"read" | "apply" | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [review, setReview] = useState<VoiceReview | null>(null);
  const [problem, setProblem] = useState<keyof typeof problems | null>(null);
  const [saved, setSaved] = useState(false);

  async function read(clip: Blob) {
    if (busy || review) return;
    if (jobId) void post("discard", { jobId }).catch(() => undefined);
    setJobId(null);
    setBusy("read");
    setProblem(null);
    try {
      const batch = await post<{ jobId: string; uploads: { path: string; token: string }[] }>("upload", { mimeType: clip.type });
      const [file] = batch.uploads;
      setJobId(batch.jobId);
      const upload = await createClient().storage.from(AI_INPUT_BUCKET).uploadToSignedUrl(file.path, file.token, clip, {
        contentType: clip.type, upsert: false,
      });
      if (upload.error) throw new Error("upload");
      setReview(await post<VoiceReview>("parse", { jobId: batch.jobId }));
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setProblem(Object.hasOwn(problems, code) ? code as keyof typeof problems : "unavailable");
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!review?.confirmation || busy || saved) return;
    setBusy("apply");
    setProblem(null);
    try {
      await post("apply", { jobId: review.jobId, confirmation: review.confirmation });
      setSaved(true);
      router.refresh();
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setProblem(code === "stale" || code === "save" ? code : "retry_save");
    } finally {
      setBusy(null);
    }
  }

  function close() {
    if (busy || problem === "retry_save") return;
    if (jobId && !saved) void post("discard", { jobId }).catch(() => undefined);
    onClose();
    setJobId(null);
    setReview(null);
    setProblem(null);
    setSaved(false);
  }

  const title = cover ? tx(p("Substitute by voice", "बोलकर बदली")) : tx(p("Bolo", "बोलो"));
  const canSave = review?.confirmation && !saved && problem !== "stale" && problem !== "save";
  const cancel = Boolean(review?.confirmation) && !saved;
  const again = review && !busy && (saved || !review.confirmation || problem === "stale" || problem === "save");
  function retry() {
    if (jobId && !saved) void post("discard", { jobId }).catch(() => undefined);
    setJobId(null);
    setReview(null);
    setProblem(null);
    setSaved(false);
  }
  return <Sheet open={open} onClose={close} title={title} icon="mic" backCloses dismissable={!busy && problem !== "retry_save"}
      footer={<div className="grid w-full grid-cols-1 gap-2 sm:flex sm:flex-wrap">
        {canSave && <Btn variant="pri" big disabled={busy !== null} onClick={() => void confirm()}>{busy === "apply"
          ? tx(p("Saving…", "सहेज रहे हैं…")) : tx(p("Save", "सहेजें"))}</Btn>}
        {again && <Btn variant="sec" big icon="mic" onClick={retry}>{tx(p("Speak again", "फिर से बोलें"))}</Btn>}
        <Btn big disabled={busy !== null || problem === "retry_save"} onClick={close}>{cancel ? tx(p("Cancel", "रद्द करें")) : tx(p("Close", "बंद करें"))}</Btn>
      </div>}>
      {open && <div className="space-y-4">
        {!review && <p>{tx(p("Speak in Hindi, English, or a mix. Hold the microphone button and release when you finish. Nothing is saved until you tap Save.",
          "हिंदी, अंग्रेज़ी या दोनों में बोलें। माइक बटन दबाकर रखें और बोलने के बाद छोड़ दें। सहेजें दबाने तक कुछ भी सहेजा नहीं जाता।"))}</p>}
        {!review && cover && <p className="text-sm" style={{ color: "var(--mut)" }}>{tx(COVER_HINT)}</p>}
        {!review && !busy && <VoiceButton onClip={(clip) => void read(clip)} />}
        {busy === "read" && <p role="status">{tx(p("Reading your recording…", "रिकॉर्डिंग पढ़ रहे हैं…"))}</p>}
        {review && <>
          <div className="space-y-1">
            <h3 className="font-semibold">{tx(p("Transcript", "बोले गए शब्द"))}</h3>
            <p dir="auto" className="whitespace-pre-wrap break-words">{review.transcript || tx(p("No clear speech was detected.", "साफ़ आवाज़ सुनाई नहीं दी।"))}</p>
          </div>
          <Card><Result result={review.result} /></Card>
          {saved && <p role="status" className="font-semibold" style={{ color: "var(--ok)" }}>{tx(p("Saved", "सहेजा गया"))}</p>}
        </>}
        {problem && <p role="alert">{tx(problems[problem])}</p>}
      </div>}
    </Sheet>;
}
