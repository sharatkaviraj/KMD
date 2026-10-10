import type { AudienceFamily } from "@/modules/whatsapp/vx/domain/reminders";

import type { BatchRow, RuleRow } from "./data";

export type RunView = {
  runId: string;
  name: string;
  startedAt: string;
  messaged: number;
  delivered: number;
  read: number;
  failed: number;
  familiesPaid: number;
  moneyCollected: number;
  moneyQuoted: number;
  source: string;
};

export type RunDetail = {
  run: RunView;
  notDelivered: { studentId: string; studentName: string; error: string | null }[];
  byClass: { classLabel: string; messaged: number; quoted: number }[];
};

export type RemindersView = "list" | "wizard" | "sending" | "results" | "empty";

export type RemindersProps = {
  today: string;
  sessionLabel: string;
  view: RemindersView;
  step: 1 | 2 | 3;
  runs: RunView[];
  batches: BatchRow[];
  rules: RuleRow[];
  audience: AudienceFamily[];
  batch: BatchRow | null;
  result: RunDetail | null;
  ruleOpen: string | null;
  perms: { queue: boolean; rules: boolean };
};

export type { BatchRow, RuleRow };
