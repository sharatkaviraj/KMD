import type { AttendanceStatus, AttendanceTally } from "@/modules/attendance/domain/attendance";
import type { Pair } from "@/vx/text";

export type VoiceResult =
  | { kind: "clarify"; reason: "unsupported" | "target" | "register" | "mark" | "schedule" | "cover" }
  | { kind: "attendance_answer"; classLabel: string; day: string; saved: boolean; student: string | null; status: AttendanceStatus | null; tally: AttendanceTally | null; absent: { name: string; roll: string | null }[] | null }
  | { kind: "period_answer"; day: string; periods: number[]; requested: number | null }
  | { kind: "available_teachers"; day: string; period: number; teachers: string[] }
  | { kind: "attendance_mark"; classLabel: string; day: string; tally: AttendanceTally; changes: { name: string; roll: string | null; status: AttendanceStatus }[]; reason: string | null; correction: boolean }
  | { kind: "single_mark"; classLabel: string; student: string; roll: string | null; exam: Pair; subject: Pair; mark: number | null; max: number; previous: string | null }
  | { kind: "student_note"; classLabel: string; student: string; roll: string | null; category: Pair; note: string }
  | { kind: "substitution"; classLabel: string; day: string; period: number; teacher: string; substitute: string; subject: string };

export type VoiceReview = { jobId: string; transcript: string; result: VoiceResult; confirmation: string | null };
