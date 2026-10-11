import { attentionFor, type AttentionFacts } from "@/modules/home/domain/attention";
import type { OverviewFacts } from "@/modules/home/domain/overview";
import { allowedFor, workspacesFor } from "@/platform/config/navigation";

export const attentionFacts: AttentionFacts = {
  registersOutstanding: 7, schoolOpenToday: true, classesTotal: 19,
  absencesToday: 2, pendingSubmissions: 12, failedJobs: 1,
};
export const overviewFacts: OverviewFacts = {
  registersIn: 12, classesTotal: 19, staffPresent: 28, staffTotal: 30,
  coverArranged: 4, coverNeeded: 6, coverPublished: true, examsOpen: 2,
  round: null, roundUnavailable: false,
};
export const adminFixture = {
  attention: attentionFor("admin", attentionFacts, { canMarkOnBehalf: true }),
  overview: { facts: overviewFacts, round: { id: "synthetic-round", titleHi: "टेस्ट जानकारी चक्र", titleEn: "Synthetic information round", answered: 42, members: 60 } },
  workspaces: workspacesFor("admin"),
  destinations: allowedFor("admin").filter(item => item.href !== "/dashboard"),
  day: { hi: "बुधवार, 30 सितम्बर 2026", en: "Wednesday, 30 September 2026" },
  testData: true,
  displayName: "Test administrator",
  sessionLabel: "TEST-2026-27",
  schoolHour: 9,
};
export const longWorkspaces = adminFixture.workspaces.map(workspace => ({ ...workspace,
  label: { hi: "स्कूल का विस्तृत कार्यक्षेत्र और सभी आवश्यक सेवाएँ", en: "School workspace with a deliberately long readable name LongUnbrokenWorkspaceLabelForWrapping" },
}));
// Authored fixture labels stay synthetic; no student/staff record is represented.
