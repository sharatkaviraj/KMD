import type { DesignView } from "../design.fixture";

import { views as calendar } from "./academics/calendar";
import { views as exams } from "./academics/exams";
import { views as timetable } from "./academics/timetable";

/*
 * Academics: Exams, Timetable and Calendar, one view per design frame
 * (docs/design-handoff/screenshots/{academics,r-academic,r-exam}). Each
 * module's views live beside this file in `academics/`, which the fixture's
 * glob does not pick up on its own.
 */

// Sheets and dialogs portal into `#vx-layer`, which the production shell
// renders and the fixture's shell does not; add it before anything draws.
if (typeof document !== "undefined" && !document.getElementById("vx-layer")) {
  const layer = document.createElement("div");
  layer.id = "vx-layer";
  layer.className = "vxt vx-layer";
  document.body.appendChild(layer);
}

export const views: Record<string, DesignView> = { ...exams, ...timetable, ...calendar };
