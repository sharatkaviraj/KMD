import type { NoticeLanguage } from "@/modules/whatsapp/domain/campaigns";
import {
  schoolNoticeCampaignName,
  SCHOOL_NOTICES,
  type SchoolNoticeKind,
} from "@/modules/whatsapp/domain/school-notices";

/**
 * The school-notice template bodies, exactly as submitted to Meta.
 *
 * Every one is UTILITY: each names a specific child (or a household's
 * children) and tells their parent something about that child's school day.
 * General announcements to "all parents" are the shape Meta re-categorises as
 * MARKETING, at about 7.5× the cost — which is why even the closure notice is
 * addressed to named children rather than broadcast.
 *
 * Every body carries one button, Call office. Like the fee bodies, nothing in
 * `ui/` or a client file may import this module.
 */

export type SchoolNoticeValues = {
  /** One child's name, or the household's students line on a closure. */
  studentName: string;
  studentClass: string;
  /** The batch's fields, by `SchoolNoticeField.name`, already formatted. */
  fields: Record<string, string>;
};

export type SchoolNoticeTemplate = {
  kind: SchoolNoticeKind;
  language: NoticeLanguage;
  campaignName: string;
  slotOrder: readonly string[];
  body: string;
  metaSamples: readonly string[];
  buildParams(values: SchoolNoticeValues): string[];
};

const SCHOOL_LINE: Record<NoticeLanguage, string> = {
  en: "Shri Veer Patta Sr. Sec. School",
  hi: "श्री वीर पत्ता सी. सै. स्कूल",
};

type Parts = {
  title: string;
  lines: readonly string[];
  text: string;
};

const BODIES: Record<SchoolNoticeKind, Record<NoticeLanguage, Parts>> = {
  absent_today: {
    en: {
      title: "Absence alert",
      lines: ["Student: {{1}}", "Class: {{2}}", "Date: {{3}}"],
      text: "Your ward was marked absent in school on the date above. If this is unexpected, or to inform the school about leave, please tap Call office.",
    },
    hi: {
      title: "अनुपस्थिति सूचना",
      lines: ["विद्यार्थी: {{1}}", "कक्षा: {{2}}", "तिथि: {{3}}"],
      text: 'आपका बच्चा उपरोक्त तिथि को विद्यालय में अनुपस्थित दर्ज किया गया है। यदि यह अपेक्षित नहीं है, या अवकाश की सूचना देनी हो, तो कृपया "कार्यालय को कॉल करें" बटन दबाएँ।',
    },
  },
  exam_schedule: {
    en: {
      title: "Examination schedule",
      lines: ["Student: {{1}}", "Class: {{2}}", "Examination: {{3}}", "Starts on: {{4}}", "Reporting time: {{5}}"],
      text: "Please make sure your ward reaches school on time with the admit card and stationery. The full timetable is available from the class teacher.",
    },
    hi: {
      title: "परीक्षा कार्यक्रम",
      lines: ["विद्यार्थी: {{1}}", "कक्षा: {{2}}", "परीक्षा: {{3}}", "प्रारंभ तिथि: {{4}}", "उपस्थिति का समय: {{5}}"],
      text: "कृपया सुनिश्चित करें कि आपका बच्चा प्रवेश पत्र और लेखन सामग्री के साथ समय पर विद्यालय पहुँचे। पूरी समय-सारणी कक्षा अध्यापक से प्राप्त की जा सकती है।",
    },
  },
  ptm: {
    en: {
      title: "Parent-teacher meeting",
      lines: ["Student: {{1}}", "Class: {{2}}", "Date: {{3}}", "Time: {{4}}"],
      text: "You are requested to attend the parent-teacher meeting at school to discuss your ward's progress with the class teacher.",
    },
    hi: {
      title: "अभिभावक-शिक्षक बैठक",
      lines: ["विद्यार्थी: {{1}}", "कक्षा: {{2}}", "तिथि: {{3}}", "समय: {{4}}"],
      text: "आपसे अनुरोध है कि अपने बच्चे की प्रगति पर कक्षा अध्यापक से चर्चा के लिए विद्यालय में अभिभावक-शिक्षक बैठक में अवश्य पधारें।",
    },
  },
  school_closed: {
    en: {
      title: "School closed notice",
      lines: ["For: {{1}}", "Closed on: {{2}}", "Reason: {{3}}", "School reopens on: {{4}}"],
      text: "Classes will not be held on the date above. For any query, please tap Call office.",
    },
    hi: {
      title: "विद्यालय अवकाश सूचना",
      lines: ["विद्यार्थी: {{1}}", "अवकाश तिथि: {{2}}", "कारण: {{3}}", "विद्यालय पुनः खुलने की तिथि: {{4}}"],
      text: 'उपरोक्त तिथि को कक्षाएँ नहीं लगेंगी। किसी भी जानकारी हेतु कृपया "कार्यालय को कॉल करें" बटन दबाएँ।',
    },
  },
};

const SAMPLES: Record<SchoolNoticeKind, Record<NoticeLanguage, readonly string[]>> = {
  absent_today: {
    en: ["Aaradhya Gurjar", "Class 2", "27-10-2026"],
    hi: ["Aaradhya Gurjar", "Class 2", "27-10-2026"],
  },
  exam_schedule: {
    en: ["Aaradhya Gurjar", "Class 2", "Half-yearly examination", "02-12-2026", "8:00 AM"],
    hi: ["Aaradhya Gurjar", "Class 2", "अर्धवार्षिक परीक्षा", "02-12-2026", "प्रातः 8:00 बजे"],
  },
  ptm: {
    en: ["Aaradhya Gurjar", "Class 2", "14-11-2026", "10:00 AM to 1:00 PM"],
    hi: ["Aaradhya Gurjar", "Class 2", "14-11-2026", "प्रातः 10:00 से दोपहर 1:00 बजे"],
  },
  school_closed: {
    en: ["Aaradhya Gurjar · Class 2", "09-11-2026", "Diwali holidays", "12-11-2026"],
    hi: ["Aaradhya Gurjar · Class 2", "09-11-2026", "दीपावली अवकाश", "12-11-2026"],
  },
};

function compose(parts: Parts, language: NoticeLanguage): string {
  return [`*${parts.title}*`, SCHOOL_LINE[language], "", ...parts.lines, "", parts.text].join("\n");
}

/** Never empty — WhatsApp refuses an empty parameter. */
function filled(value: string | undefined): string {
  const text = String(value ?? "").trim();
  return text || "—";
}

function paramsFor(kind: SchoolNoticeKind, values: SchoolNoticeValues): string[] {
  const f = values.fields;
  switch (kind) {
    case "absent_today":
      return [filled(values.studentName), filled(values.studentClass), filled(f.date)];
    case "exam_schedule":
      return [
        filled(values.studentName),
        filled(values.studentClass),
        filled(f.examName),
        filled(f.startsOn),
        filled(f.reportingTime),
      ];
    case "ptm":
      return [filled(values.studentName), filled(values.studentClass), filled(f.date), filled(f.time)];
    case "school_closed":
      return [filled(values.studentName), filled(f.closedOn), filled(f.reason), filled(f.reopensOn)];
  }
}

export const SCHOOL_NOTICE_TEMPLATES: readonly SchoolNoticeTemplate[] = SCHOOL_NOTICES.flatMap(
  (definition) =>
    (["hi", "en"] as const).map((language): SchoolNoticeTemplate => {
      const parts = BODIES[definition.kind][language];
      return {
        kind: definition.kind,
        language,
        campaignName: schoolNoticeCampaignName(definition.kind, language),
        slotOrder: parts.lines.map((line) => line.split(":")[0]!.trim()),
        body: compose(parts, language),
        metaSamples: SAMPLES[definition.kind][language],
        buildParams: (values) => paramsFor(definition.kind, values),
      };
    }),
);

export function schoolNoticeTemplate(
  kind: SchoolNoticeKind,
  language: NoticeLanguage,
): SchoolNoticeTemplate {
  return (
    SCHOOL_NOTICE_TEMPLATES.find((entry) => entry.kind === kind && entry.language === language) ??
    SCHOOL_NOTICE_TEMPLATES[0]!
  );
}
