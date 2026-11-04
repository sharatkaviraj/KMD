"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { COVER_PHOTO_ACTION, type CoverPhotoIssue, type CoverPhotoResult } from "@/lib/ai/cover-photo-types";
import { AI_INPUT_BUCKET } from "@/lib/ai/media-limits";
import { CameraCapture } from "@/lib/ai/ui/camera-capture";
import { createClient } from "@/platform/supabase/client";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { Btn, Card, Pill } from "@/vx/ui/primitives";

const labels: Record<CoverPhotoIssue, ReturnType<typeof p>> = {
  source_date: p("The written date is missing or different.", "लिखी हुई तारीख़ नहीं मिली या अलग है।"),
  unclear: p("Check the handwriting or teacher grouping.", "लिखावट या शिक्षक की पंक्तियाँ जाँचें।"),
  teacher: p("Check the absent teacher’s name or initials.", "अनुपस्थित शिक्षक का नाम या संक्षिप्त नाम जाँचें।"),
  period: p("Check the period number.", "पीरियड संख्या जाँचें।"),
  lesson: p("Check this class and period against the timetable.", "समय-सारणी में यह कक्षा और पीरियड जाँचें।"),
  complex: p("A shared lesson or timetable clash needs review.", "साझा पीरियड या समय-सारणी का टकराव जाँचें।"),
  duplicate: p("This lesson appears more than once.", "यह पीरियड एक से अधिक बार लिखा है।"),
  existing: p("This lesson already has a cover teacher.", "इस पीरियड की व्यवस्था पहले से है।"),
  closed: p("This period is too close to its start or has already begun.", "यह पीरियड जल्द शुरू होगा या शुरू हो चुका है।"),
  substitute: p("Check the substitute’s name or choose a teacher.", "व्यवस्था शिक्षक का नाम जाँचें या शिक्षक चुनें।"),
  unavailable: p("The written substitute is unavailable for this lesson.", "लिखे हुए शिक्षक इस पीरियड में उपलब्ध नहीं हैं।"),
  double_booked: p("A teacher is booked for another cover in this period.", "इस पीरियड में शिक्षक की दूसरी व्यवस्था है।"),
};

const problems = {
  quota: p("Today’s photo limit is reached.", "आज की फ़ोटो सीमा पूरी हो गई।"),
  upload: p("Could not upload the photo. Check your connection and try again.", "फ़ोटो अपलोड नहीं हुई। इंटरनेट जाँचकर फिर कोशिश करें।"),
  parse: p("Could not read the register. Try a clearer photo.", "रजिस्टर पढ़ा नहीं गया। साफ़ फ़ोटो लेकर फिर कोशिश करें।"),
  timetable: p("A published timetable is needed for this day.", "इस दिन की प्रकाशित समय-सारणी चाहिए।"),
  stale: p("This cover plan changed. Refresh the day and check the current assignments.", "व्यवस्था बदल गई है। पेज रीफ़्रेश करके वर्तमान व्यवस्था जाँचें।"),
  expired: p("The two-minute Undo window has ended.", "वापस लेने की दो मिनट की अवधि समाप्त हो गई।"),
  retry_save: p("The result could not be confirmed. Retry this action.", "नतीजे की पुष्टि नहीं हुई। यही काम फिर करें।"),
  denied: p("Switch back to your own role to use photo cover.", "फ़ोटो से व्यवस्था करने के लिए अपनी भूमिका पर लौटें।"),
  unavailable: p("The photo reader is unavailable right now.", "फ़ोटो पढ़ने की सुविधा अभी उपलब्ध नहीं है।"),
};

type Operation = "upload" | "parse" | "apply" | "discard";
async function post<T>(operation: Operation, body: object): Promise<T> {
  const response = await fetch("/api/ai/" + COVER_PHOTO_ACTION + "/" + operation, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok !== true) throw new Error(data?.code ?? "unavailable");
  return data as T;
}

function errorCode(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return Object.hasOwn(problems, code) ? code as keyof typeof problems : "unavailable";
}

export function CoverPhotoPanel({ day, initial }: { day: string; initial: CoverPhotoResult | null }) {
  const { tx } = useVx();
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(initial));
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [job, setJob] = useState<string | null>(null);
  const [result, setResult] = useState(initial);
  const [busy, setBusy] = useState<Operation | null>(null);
  const [error, setError] = useState<keyof typeof problems | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const deadline = result?.undoUntil;
  const canUndo = Boolean(deadline && !result?.undone && seconds !== 0 && error !== "stale" && error !== "expired");

  useEffect(() => {
    if (!deadline) return;
    const tick = () => setSeconds(Math.max(0, Math.ceil((Date.parse(deadline) - Date.now()) / 1000)));
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [deadline]);

  async function read() {
    if (!photos.length || busy) return;
    setError(null);
    let id = job;
    try {
      if (!id) {
        setBusy("upload");
        const batch = await post<{ jobId: string; uploads: { path: string; token: string }[] }>("upload", { day, pages: photos.length });
        const bucket = createClient().storage.from(AI_INPUT_BUCKET);
        const uploads = await Promise.all(batch.uploads.map(({ path, token }, i) =>
          bucket.uploadToSignedUrl(path, token, photos[i], { contentType: "image/jpeg", upsert: false }),
        ));
        if (uploads.some((entry) => entry.error)) throw new Error("upload");
        id = batch.jobId;
        setJob(id);
      }
      setBusy("parse");
      const next = await post<CoverPhotoResult>("parse", { day, jobId: id });
      setResult(next);
      setPhotos([]);
      setJob(null);
      setSeconds(null);
      if (next.applied.length) router.refresh();
    } catch (cause) {
      const code = errorCode(cause);
      if (code === "upload" || code === "parse") setJob(null);
      setError(code);
    } finally {
      setBusy(null);
    }
  }

  async function finish(operation: "apply" | "discard") {
    if (!result || busy) return;
    setBusy(operation);
    setError(null);
    try {
      if (operation === "apply") {
        const undone = await post<CoverPhotoResult>(operation, { day, jobId: result.jobId, mode: "undo" });
        setResult(undone);
        router.refresh();
      } else {
        if (!result.applied.length) await post(operation, { day, jobId: result.jobId });
        setResult(null);
      }
    } catch (cause) {
      setError(errorCode(cause));
    } finally {
      setBusy(null);
    }
  }

  return <Card as="section" aria-label={tx(p("Substitution photo", "व्यवस्था रजिस्टर की फ़ोटो"))} className="mt-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold">{tx(p("Substitution photo", "व्यवस्था रजिस्टर की फ़ोटो"))}</h2>
      <Btn variant="sec" disabled={Boolean(busy) || canUndo} onClick={() => setOpen(!open)}>
        {open ? tx(p("Hide photo tools", "फ़ोटो के विकल्प छिपाएँ")) : tx(p("Open photo tools", "फ़ोटो के विकल्प खोलें"))}
      </Btn>
    </div>
    {open && <>
      {error && <p role="alert" className="break-words">{tx(problems[error])}</p>}
      {!result ? <>
        <p className="text-sm">{tx(p(
          "Use a sample register and keep the written date visible. VPPS One checks each row against the test timetable.",
          "नमूना रजिस्टर लें और लिखी तारीख़ फ़ोटो में रखें। VPPS One हर पंक्ति को परीक्षण समय-सारणी से मिलाता है।",
        ))}</p>
        <CameraCapture files={photos} disabled={Boolean(busy)} onChange={(next) => { setPhotos(next); setJob(null); setError(null); }} />
        <Btn variant="pri" disabled={!photos.length || Boolean(busy)} onClick={() => void read()}>
          {busy === "upload" ? tx(p("Uploading…", "अपलोड हो रहा है…")) :
            busy === "parse" ? tx(p("Reading register…", "रजिस्टर पढ़ा जा रहा है…")) : tx(p("Read register", "रजिस्टर पढ़ें"))}
        </Btn>
      </> : <>
        <div role="status" className="space-y-1 text-sm">
          {result.undone ? <p>{tx(p("Photo assignments were undone.", "फ़ोटो से की गई व्यवस्थाएँ वापस ली गईं।"))}</p> :
            result.applied.length > 0 ? <p>{tx(p(
              result.applied.length + " assignments saved. WhatsApp notices wait at least two minutes.",
              result.applied.length + " व्यवस्थाएँ सहेजी गईं। WhatsApp सूचनाएँ कम से कम दो मिनट रुकेंगी।",
            ))}</p> : <p>{tx(p("No assignments saved.", "कोई व्यवस्था सहेजी नहीं गई।"))}</p>}
          {result.applyBlocked === "review_only" && <p>{tx(p("Automatic assignment is off for this trial.", "इस परीक्षण में अपने आप व्यवस्था करना बंद है।"))}</p>}
          {result.applyBlocked === "stale" && <p>{tx(p("Check the current cover plan before using these rows.", "इन पंक्तियों का उपयोग करने से पहले वर्तमान व्यवस्था जाँचें।"))}</p>}
          {!result.review.rows.length && <p>{tx(p("No rows were read for this date.", "इस तारीख़ की कोई पंक्ति पढ़ी नहीं गई।"))}</p>}
        </div>
        {canUndo && <Btn variant="danger" disabled={Boolean(busy)} onClick={() => void finish("apply")}>
          {tx(p("Undo photo assignments", "फ़ोटो की व्यवस्थाएँ वापस लें"))}
          {seconds !== null && <span aria-hidden="true">{seconds}s</span>}
        </Btn>}
        {!!result.review.rows.length && <ol className="space-y-2 text-sm">
          {result.review.rows.map(({ index, source, issue, suggestions }) => <li key={index} className="rounded-lg border border-border p-3 break-words">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{source.period || "—"} · {source.classLabel || "—"}</span>
              {result.applied.includes(index) && !result.undone ? <Pill tone="ok">{tx(p("Saved", "सहेजा गया"))}</Pill> :
                issue ? <Pill tone="warn">{tx(p("Review", "जाँचें"))}</Pill> : null}
            </div>
            <p>{source.absentTeacher || "—"} → {source.substitute || "—"}</p>
            {source.sourceDate && <p className="text-subtle-foreground">{source.sourceDate}</p>}
            {issue && <p>{tx(labels[issue])}</p>}
            {suggestions.length > 0 && <div className="mt-2 space-y-1">
              <p>{tx(p("Choose a free teacher to review", "जाँच के लिए उपलब्ध शिक्षक चुनें"))}</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map(({ label, href }) => <Btn key={href} href={href} variant="sec">{label}</Btn>)}
              </div>
            </div>}
          </li>)}
        </ol>}
        <div className="flex flex-wrap gap-2">
          <Btn variant="sec" href={`/substitutions/arrange?day=${day}`}>{tx(p("Open cover planner", "व्यवस्था योजना खोलें"))}</Btn>
          {!canUndo && <Btn variant="ghost" disabled={Boolean(busy)} onClick={() => void finish("discard")}>
            {tx(p("Clear photo result", "फ़ोटो का नतीजा हटाएँ"))}
          </Btn>}
        </div>
      </>}
    </>}
  </Card>;
}
