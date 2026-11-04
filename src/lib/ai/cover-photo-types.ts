import type { z } from "zod";
import type { substitutionPhoto } from "@/lib/ai/photo-schema";

export const COVER_PHOTO_ACTION = "substitution-photo";
export const COVER_PHOTO_UNDO_MS = 120_000;

export type CoverPhoto = z.infer<typeof substitutionPhoto.validate>;
export type CoverPhotoIssue = "source_date" | "unclear" | "teacher" | "period" | "lesson" |
  "complex" | "duplicate" | "existing" | "closed" | "substitute" | "unavailable" | "double_booked";

export type CoverPhotoReview = {
  rows: {
    index: number; source: CoverPhoto["rows"][number]; issue: CoverPhotoIssue | null;
    suggestions: { label: string; href: string }[];
  }[];
};

export type CoverPhotoResult = {
  jobId: string;
  review: CoverPhotoReview;
  applied: number[];
  undoUntil: string | null;
  undone?: boolean;
  applyBlocked?: "review_only" | "stale";
};
