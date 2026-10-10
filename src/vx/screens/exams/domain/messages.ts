import { p, type Pair } from "@/vx/text";

/*
 * Words that leave the app: a reminder to a teacher with her marks link, a
 * suggested remark for a report card. Built here so they can be tested and
 * so the preview and the copied text are the same string.
 */

/** A WhatsApp click-to-chat URL. Indian 10-digit numbers get the 91 prefix. */
export function waLink(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  const number = digits.length === 10 ? `91${digits}` : digits.length === 12 && digits.startsWith("91") ? digits : "";
  const base = number ? `https://wa.me/${number}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}

export function reminderLines(input: {
  teacherName: string;
  examName: string;
  pending: string[];
  dueLabel: string;
  link: string | null;
  from: string;
}): string[] {
  const lines = [
    `Namaste ${input.teacherName} ji,`,
    `${input.examName} marks are due by ${input.dueLabel}.`,
    input.pending.length ? `Still to fill: ${input.pending.join(", ")}.` : "Please check your marks once.",
  ];
  if (input.link) lines.push(`Your marks link (no login needed): ${input.link}`);
  lines.push(`— ${input.from}`);
  return lines;
}

export function reminderText(input: Parameters<typeof reminderLines>[0]): string {
  return reminderLines(input).join("\n");
}

export type RemarkSuggestion = { text: Pair; source: "marks" | "attendance" | "subjects"; basis: string };

/**
 * First drafts of a report-card remark from what the school already knows —
 * the term's marks, attendance, and the child's strongest and weakest
 * subjects. The teacher taps one and may change the words; it is a starting
 * line, not a judgement. Every suggestion is a pair, so the card can print it
 * in both languages.
 */
export function suggestRemarks(input: {
  percent: number | null;
  attendancePct: number | null;
  strongest: string | null;
  weakest: string | null;
}): RemarkSuggestion[] {
  const out: RemarkSuggestion[] = [];
  const pct = input.percent;
  if (pct !== null) {
    const basis = `${Math.round(pct)}%`;
    if (pct >= 85) {
      out.push({ text: p("Excellent work this term. Keep it up.", "इस सत्र में उत्कृष्ट काम। ऐसे ही बनाए रखें।"), source: "marks", basis });
      out.push({ text: p("A keen learner who sets a good example in class.", "सीखने को उत्सुक, कक्षा में अच्छा उदाहरण।"), source: "marks", basis });
    } else if (pct >= 65) {
      out.push({ text: p("Good progress this term. More reading at home will help.", "इस सत्र में अच्छी प्रगति। घर पर और पढ़ना मदद करेगा।"), source: "marks", basis });
      out.push({ text: p("Sincere and hard-working; can aim even higher.", "ईमानदार और मेहनती; और ऊँचा लक्ष्य रख सकते हैं।"), source: "marks", basis });
    } else if (pct >= 40) {
      out.push({ text: p("Making progress. Regular practice at home will help a lot.", "प्रगति हो रही है। घर पर नियमित अभ्यास बहुत मदद करेगा।"), source: "marks", basis });
      out.push({ text: p("Tries hard; needs to revise each day's work.", "मेहनत करते हैं; रोज़ का काम दोहराना ज़रूरी है।"), source: "marks", basis });
    } else {
      out.push({ text: p("Needs steady support at home and at school this term.", "इस सत्र घर और स्कूल में नियमित सहारे की ज़रूरत है।"), source: "marks", basis });
      out.push({ text: p("Please meet the class teacher to plan extra practice.", "अतिरिक्त अभ्यास की योजना के लिए कृपया कक्षा अध्यापक से मिलें।"), source: "marks", basis });
    }
  }
  if (input.strongest && input.weakest && input.strongest !== input.weakest) {
    out.push({
      text: p(`Strong in ${input.strongest}; more practice in ${input.weakest} will help.`, `${input.strongest} में अच्छा; ${input.weakest} में और अभ्यास मदद करेगा।`),
      source: "subjects",
      basis: input.strongest,
    });
  }
  const att = input.attendancePct;
  if (att !== null) {
    const basis = `${Math.round(att)}%`;
    if (att >= 85) out.push({ text: p("Regular and on time — a very good habit. Keep it up.", "नियमित और समय पर — बहुत अच्छी आदत, ऐसे ही रखें।"), source: "attendance", basis });
    else if (att < 75) out.push({ text: p("Please make sure attendance improves next term.", "कृपया अगले सत्र में उपस्थिति बढ़ाएँ।"), source: "attendance", basis });
  }
  return out;
}

/** What is stored for a picked suggestion: English, then Hindi, one per line. */
export function remarkText(pair: Pair): string {
  return pair.hi && pair.hi !== pair.en ? `${pair.en}\n${pair.hi}` : pair.en;
}

/** "Ms. Rao" → "Rao" is not what a remark wants; the first word of a child's name is. */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}
