import type { DesignView } from "../design.fixture";

import { academicViews } from "./coordinators-academic.views";
import { examViews } from "./coordinators-exam.views";

/*
 * The coordinators' apps: the academic coordinator (AcadHome, AcadProgress,
 * AcadAttendance) and the exam coordinator (ExamHome, ExamPlan, ExamResults).
 * One view per design frame, keyed by the frame's name.
 */
export const views: Record<string, DesignView> = { ...academicViews, ...examViews };
