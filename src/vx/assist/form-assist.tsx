"use client";

import { useRef } from "react";

import type { FormField } from "@/modules/assist/domain/tasks";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { useToast } from "@/vx/ui/overlays";

import { PROBLEM_TEXT, useAssistTask, useOnline } from "./client";
import { useAssistOffers } from "./context";
import { AssistProblemLine, AssistSuggestion } from "./parts";

const SAY = {
  scan: p("Fill from a photo of the paper form", "कागज़ी फ़ॉर्म की फ़ोटो से भरें"),
  scanSub: p("Take a clear photo of the whole form. AI reads it and fills the boxes; you check each one.", "पूरे फ़ॉर्म की साफ़ फ़ोटो लें। AI पढ़कर खाने भरेगा; आप हर एक जाँचें।"),
  reading: p("Reading the form…", "फ़ॉर्म पढ़ रहे हैं…"),
  found: p("Read from the form", "फ़ॉर्म से पढ़ा गया"),
  fill: p("Fill these in", "ये भर दें"),
  check: p("check", "जाँचें"),
  photoNote: p("The photo is sent to the AI to read and is not kept by VPPS One.", "फ़ोटो पढ़ने के लिए AI को भेजी जाती है; VPPS One इसे नहीं रखता।"),
  badPhoto: p("That photo could not be opened. Try another one.", "यह फ़ोटो नहीं खुली। दूसरी फ़ोटो लें।"),
  camera: p("Take a photo", "फ़ोटो खींचें"),
  gallery: p("Choose from gallery", "गैलरी से चुनें"),
};

export const FORM_FIELD_LABELS: Record<FormField, Pair> = {
  fullName: p("Child’s name", "बच्चे का नाम"),
  nameHi: p("Name in Hindi", "हिंदी में नाम"),
  dob: p("Date of birth", "जन्म तिथि"),
  gender: p("Gender", "लिंग"),
  classLabel: p("Class", "कक्षा"),
  previousSchool: p("Previous school", "पिछला विद्यालय"),
  fatherName: p("Father’s name", "पिता का नाम"),
  motherName: p("Mother’s name", "माता का नाम"),
  phone: p("Mobile", "मोबाइल"),
  address: p("Address", "पता"),
  village: p("Village / area", "गाँव / क्षेत्र"),
};

export type FormValues = Partial<Record<FormField, { value: string; sure: boolean }>>;

/** A phone photo shrunk to at most 1600 px and re-encoded as JPEG: small enough to send, sharp enough to read. */
async function shrink(file: File): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const url = canvas.toDataURL("image/jpeg", 0.82);
    const data = url.split(",", 2)[1] ?? "";
    return data.length > 100 ? data : null;
  } catch {
    return null;
  }
}

/**
 * On the admission form (D-324): photograph the paper form and AI fills the
 * boxes it can read, flagging the ones that were hard to read. Every value
 * lands in the wizard's own boxes; the office checks them and goes on as
 * before. Nothing is saved until the wizard's own Save.
 */
export function FormScan({ classes, onApply }: { classes: readonly string[]; onApply: (values: FormValues) => void }) {
  const { tx } = useVx();
  const toast = useToast();
  const offer = useAssistOffers("form");
  const read = useAssistTask("form.read");
  const input = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const online = useOnline();
  if (!offer) return null;

  const working = read.state.kind === "working";
  const ready = read.state.kind === "ready" ? read.state.value.values : null;

  async function pick(file: File | undefined, box: HTMLInputElement) {
    if (!file) return;
    const data = await shrink(file);
    // The same photo picked again still fires a change.
    box.value = "";
    if (!data) {
      read.reset();
      toast.show({ text: tx(SAY.badPhoto), tone: "bad" });
      return;
    }
    void read.run({ image: { mediaType: "image/jpeg", data }, classes: classes.slice(0, 60).map((c) => c.slice(0, 40)) });
  }

  // A hidden file box per way in: the camera opens straight away on a phone,
  // the gallery takes a photo already taken (often on a parent's phone, sent on WhatsApp).
  const picker = (camera: boolean) => (
    <label className="tap btn sec" aria-disabled={working || !online} style={{ position: "relative", height: "auto", minHeight: 48, whiteSpace: "normal", opacity: working || !online ? 0.55 : 1, cursor: working ? "progress" : "pointer" }}>
      <Ic n={camera ? "camera" : "image"} size={18} />
      {tx(camera ? SAY.camera : SAY.gallery)}
      <input
        ref={camera ? cameraInput : input}
        type="file"
        accept="image/*"
        {...(camera ? { capture: "environment" as const } : {})}
        disabled={working || !online}
        onChange={(e) => void pick(e.target.files?.[0], e.currentTarget)}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
      />
    </label>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!ready ? (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", border: "1px dashed var(--acc)", background: "var(--accs)", color: "var(--accfg)" }}>
          <span style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <Ic n={working ? "refresh" : !online ? "wifiOff" : "sparkle"} size={18} className={working ? "as-spin" : undefined} style={{ marginTop: 2 }} />
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontWeight: 700 }}>{tx(working ? SAY.reading : SAY.scan)}</span>
              <span className="as-note" style={{ color: "var(--fg)", opacity: 0.8 }}>{tx(!online ? PROBLEM_TEXT.offline : SAY.scanSub)}</span>
            </span>
          </span>
          {!working ? (
            <div className="as-pick">
              {picker(true)}
              {picker(false)}
            </div>
          ) : null}
        </div>
      ) : null}
      {read.state.kind === "problem" ? <AssistProblemLine problem={read.state.problem} onClose={read.reset} /> : null}
      {ready ? (
        <AssistSuggestion
          title={SAY.found}
          privacy={false}
          useLabel={SAY.fill}
          onUse={() => {
            const values: FormValues = {};
            for (const v of ready) values[v.field] = { value: v.value, sure: v.sure };
            onApply(values);
            read.decide("kept");
          }}
          onDiscard={() => read.decide("discarded")}
        >
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
            {ready.map((v) => (
              <li key={v.field} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <span style={{ color: "var(--mut)" }}>{tx(FORM_FIELD_LABELS[v.field])}:</span>
                <b>{v.value}</b>
                {!v.sure ? <span className="pill" style={{ height: 22, padding: "0 8px", fontSize: 11, background: "var(--warns)", color: "var(--warnfg)" }}>{tx(SAY.check)}</span> : null}
              </li>
            ))}
          </ul>
          <span className="as-note">{tx(SAY.photoNote)}</span>
        </AssistSuggestion>
      ) : null}
    </div>
  );
}
