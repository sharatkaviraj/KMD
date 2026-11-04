"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { PhotoChoice, PhotoReview } from "@/lib/ai/marks-review";
import { finalPhotoEntries, MARKS_PHOTO_ACTION, readPhotoMark } from "@/lib/ai/marks-review";
import { AI_INPUT_BUCKET } from "@/lib/ai/media-limits";
import { AiReviewCard } from "@/lib/ai/ui/ai-review-card";
import { CameraCapture } from "@/lib/ai/ui/camera-capture";
import { createClient } from "@/platform/supabase/client";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { Btn, Card } from "@/vx/ui/primitives";

const problems = {
  quota: p("You’ve reached today’s photo limit. You can still enter marks by hand.", "आज की फ़ोटो सीमा पूरी हो गई। अंक हाथ से भर सकते हैं।"),
  upload: p("Could not upload the photos. Check your connection and try again.", "फ़ोटो अपलोड नहीं हुईं। इंटरनेट जाँचकर फिर कोशिश करें।"),
  parse: p("Could not read this sheet. Try a clearer photo or enter the marks by hand.", "शीट पढ़ी नहीं गई। साफ़ फ़ोटो लें या अंक हाथ से भरें।"),
  stale: p("The paper or draft changed. Go back and open it again.", "पेपर या मसौदा बदल गया है। वापस जाकर फिर खोलें।"),
  roster: p("The class list is unavailable for this paper.", "इस पेपर की कक्षा सूची उपलब्ध नहीं है।"),
  review: p("Check the highlighted rows before saving.", "सहेजने से पहले चिह्नित पंक्तियाँ जाँचें।"),
  save: p("The paper refused the save. Open the marks paper again.", "अंक सहेजे नहीं गए। अंक पेपर फिर खोलें।"),
  retry_save: p("Could not confirm the save. Try Save again with the same marks.", "सहेजने की पुष्टि नहीं हुई। इन्हीं अंकों के साथ फिर सहेजें।"),
  sealed: p("The review has already been saved or is being confirmed. Open the marks paper again.", "जाँच सहेजी जा चुकी है या उसकी पुष्टि हो रही है। अंक पेपर फिर खोलें।"),
  unavailable: p("The photo reader is unavailable. Try again or enter marks by hand.", "फ़ोटो पढ़ने की सुविधा उपलब्ध नहीं है। फिर कोशिश करें या अंक हाथ से भरें।"),
};
const issueLabels = {
  identity: p("Check the name and roll", "नाम और रोल जाँचें"),
  unclear: p("Hard to read", "पढ़ने में अस्पष्ट"),
  mark: p("Check the mark", "अंक जाँचें"),
  duplicate: p("Repeated student", "विद्यार्थी दो बार है"),
};

type Operation = "upload" | "parse" | "apply" | "discard";
async function post<T>(operation: Operation, body: object): Promise<T> {
  const response = await fetch("/api/ai/" + MARKS_PHOTO_ACTION + "/" + operation, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok !== true) throw new Error(data?.code ?? "unavailable");
  return data as T;
}

function problemOf(error: unknown) {
  const code = error instanceof Error ? error.message : "unavailable";
  return Object.hasOwn(problems, code) ? problems[code as keyof typeof problems] : problems.unavailable;
}

export function MarksPhotoPanel({ paperId, backHref, max, step }: {
  paperId: string; backHref: string; max: number; step: number;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ jobId: string; review: PhotoReview } | null>(null);
  const [choices, setChoices] = useState<PhotoChoice[]>([]);
  const [busy, setBusy] = useState<"upload" | "parse" | "apply" | "discard" | null>(null);
  const [error, setError] = useState<ReturnType<typeof p> | null>(null);
  const [saved, setSaved] = useState(false);
  const [retrySave, setRetrySave] = useState(false);
  const rule = { max, step };

  async function read() {
    if (!photos.length || busy) return;
    setError(null);
    let jobId = uploaded;
    try {
      if (!jobId) {
        setBusy("upload");
        const batch = await post<{ jobId: string; uploads: { path: string; token: string }[] }>("upload", { paperId, pages: photos.length });
        const bucket = createClient().storage.from(AI_INPUT_BUCKET);
        const results = await Promise.all(batch.uploads.map(({ path, token }, i) =>
          bucket.uploadToSignedUrl(path, token, photos[i], { contentType: "image/jpeg", upsert: false }),
        ));
        if (results.some((result) => result.error)) throw new Error("upload");
        jobId = batch.jobId;
        setUploaded(jobId);
      }
      setBusy("parse");
      const data = await post<{ jobId: string; review: PhotoReview }>("parse", { paperId, jobId });
      setChoices(data.review.rows.map((row) => ({
        index: row.index, studentId: row.studentId, marks: row.marks, confirmed: false, skip: false,
      })));
      setDraft(data);
      setPhotos([]);
      setUploaded(null);
    } catch (e) {
      if (e instanceof Error && ["upload", "parse", "stale", "roster"].includes(e.message)) setUploaded(null);
      setError(problemOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function finish(operation: "apply" | "discard") {
    if (!draft || busy || (operation === "apply" && !canSave)) return;
    setBusy(operation);
    setError(null);
    try {
      await post(operation, {
        paperId, jobId: draft.jobId,
        ...(operation === "apply" ? { choices } : {}),
      });
      setDraft(null);
      setChoices([]);
      setRetrySave(false);
      if (operation === "apply") {
        setSaved(true);
        router.refresh();
      }
    } catch (e) {
      if (operation === "apply" && (!(e instanceof Error) || !["review", "stale", "sealed", "save", "not_found"].includes(e.message))) {
        setRetrySave(true);
        setError(problems.retry_save);
      } else setError(problemOf(e));
    } finally {
      setBusy(null);
    }
  }

  const canSave = draft !== null && finalPhotoEntries(draft.review, choices, rule) !== null;
  const useCount = new Map<string, number>();
  for (const choice of choices) if (choice.studentId && !choice.skip) useCount.set(choice.studentId, (useCount.get(choice.studentId) ?? 0) + 1);
  const missing = draft?.review.students.filter((s) => !useCount.has(s.id)) ?? [];
  function change(index: number, patch: Partial<PhotoChoice>) {
    setChoices((current) => current.map((choice) => choice.index === index ? { ...choice, ...patch } : choice));
  }

  return <div className="space-y-3">
    {error && <Card><p role="alert">{tx(error)}</p></Card>}
    {saved ? <Card>
      <p role="status" className="mb-3">{tx(p("Marks saved as a draft. Open the paper to check or submit it.", "अंकों का मसौदा सहेजा गया। जाँचने या भेजने के लिए पेपर खोलें।"))}</p>
      <Btn variant="pri" href={backHref}>{tx(p("Back to marks", "अंकों पर वापस"))}</Btn>
    </Card> : !draft ? <Card>
      <p className="mb-3">{tx(p("Photograph the marks list. The app reads it; you check the marks and save.", "अंकों की सूची की फ़ोटो लें। ऐप उसे पढ़ता है; अंक आप जाँचकर सहेजते हैं।"))}</p>
      <CameraCapture files={photos} onChange={(next) => { setPhotos(next); setUploaded(null); setError(null); }} disabled={busy !== null} />
      <div className="mt-3">
        <Btn variant="pri" disabled={!photos.length || busy !== null} onClick={() => void read()}>
          {busy === "upload" ? tx(p("Uploading…", "अपलोड हो रहा है…")) :
           busy === "parse" ? tx(p("Reading marks…", "अंक पढ़े जा रहे हैं…")) : tx(p("Read marks", "अंक पढ़ें"))}
        </Btn>
      </div>
    </Card> : <Card>
      <AiReviewCard busy={busy !== null} canSave={canSave} onSave={() => void finish("apply")}
        onDiscard={retrySave ? undefined : () => void finish("discard")}
        saveLabel={busy === "apply" ? tx(p("Saving…", "सहेज रहे हैं…")) : tx(p("Save reviewed marks", "जाँचे हुए अंक सहेजें"))}>
        <p>{tx(p("Compare every row with the paper. Fix the highlighted rows or skip them. A blank is not an absence.", "हर पंक्ति पेपर से मिलाएँ। चिह्नित पंक्तियाँ ठीक करें या छोड़ दें। खाली का मतलब अनुपस्थित नहीं है।"))}</p>
        {!draft.review.rows.length && <p role="status">{tx(p("No marks rows were found. Discard and try a clearer photo.", "अंकों की पंक्ति नहीं मिली। हटाकर साफ़ फ़ोटो लें।"))}</p>}
        <div className="space-y-2">
          {draft.review.rows.map((row, i) => {
            const choice = choices[i];
            if (!choice) return null;
            const badMark = !readPhotoMark(choice.marks, rule);
            const duplicate = choice.studentId !== null && (useCount.get(choice.studentId) ?? 0) > 1;
            const warn = !choice.skip && (row.issues.length > 0 || badMark || duplicate);
            const locked = busy !== null || retrySave;
            return <fieldset key={row.index} className="space-y-2 rounded-lg border p-3" disabled={locked}
              style={{ borderColor: warn ? "var(--warn)" : "var(--bd)" }}>
              <legend className="px-1">{tx(p("Row " + (i + 1), "पंक्ति " + (i + 1)))}</legend>
              <p dir="auto" className="break-words">{[row.roll, row.name, row.marks].map((part) => part || "—").join(" · ")}</p>
              {warn && <p className="text-sm">{[
                ...row.issues, ...(badMark ? ["mark" as const] : []), ...(duplicate ? ["duplicate" as const] : []),
              ].filter((value, index, all) => all.indexOf(value) === index).map((issue) => tx(issueLabels[issue])).join(" · ")}</p>}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="grid min-w-0 gap-1">
                  <span>{tx(p("Student", "विद्यार्थी"))}</span>
                  <select value={choice.studentId ?? ""} disabled={choice.skip} style={{ background: "var(--card)", borderColor: "var(--bd)" }}
                    className="min-w-0 rounded-md border p-2" onChange={(e) => change(i, { studentId: e.target.value || null, confirmed: false })}>
                    <option value="">{tx(p("Choose from the class", "कक्षा से चुनें"))}</option>
                    {draft.review.students.map((s) => <option key={s.id} value={s.id}>{s.roll ? s.roll + " · " : ""}{s.name}</option>)}
                  </select>
                </label>
                <label className="grid min-w-0 gap-1">
                  <span>{tx(p("Mark / " + max + " or AB", "अंक / " + max + " या AB"))}</span>
                  <input value={choice.marks} maxLength={160} disabled={choice.skip} aria-invalid={!choice.skip && badMark}
                    style={{ background: "var(--card)", borderColor: "var(--bd)" }} className="min-w-0 rounded-md border p-2"
                    onChange={(e) => change(i, { marks: e.target.value, confirmed: false })} />
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                {row.issues.length > 0 && !choice.skip && <label className="flex min-h-10 items-center gap-2">
                  <input type="checkbox" checked={choice.confirmed} onChange={(e) => change(i, { confirmed: e.target.checked })} />
                  {tx(p("I checked this row", "मैंने यह पंक्ति जाँची"))}
                </label>}
                <label className="flex min-h-10 items-center gap-2">
                  <input type="checkbox" checked={choice.skip} onChange={(e) => change(i, { skip: e.target.checked })} />
                  {tx(p("Skip row", "पंक्ति छोड़ें"))}
                </label>
              </div>
            </fieldset>;
          })}
        </div>
        {missing.length > 0 && <details open>
          <summary>{tx(p("Students not included (" + missing.length + ")", "शामिल नहीं (" + missing.length + ")"))}</summary>
          <ul className="ml-5 list-disc">{missing.map((student) => <li key={student.id}>{student.roll ? student.roll + " · " : ""}{student.name}</li>)}</ul>
          <p className="mt-1">{tx(p("Their marks stay as they were.", "उनके अंक जैसे हैं वैसे रहेंगे।"))}</p>
        </details>}
      </AiReviewCard>
    </Card>}
  </div>;
}
