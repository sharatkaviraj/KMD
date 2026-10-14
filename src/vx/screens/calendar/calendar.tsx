import type { CurrentStaff } from "@/platform/auth/current-staff";
import { WHATSAPP_MESSAGE_COST_RUPEES } from "@/modules/whatsapp/domain/run-measurement";

import { loadCalendar } from "./load";
import { buildCalendar, type CalendarParams } from "./model";
import { CalendarView } from "./view";

/*
 * School calendar (SCREENS "Calendar"). One calendar for the school:
 * holidays and vacations from `academic_calendar_days` (the register and
 * the timetable close on them) and events from `calendar_events`.
 * States: `?view=` month | agenda | holidays | day, `?event=<id>`,
 * `?holiday=<day>`, and `?sheet=` add | notify. Every state is a URL.
 *
 * Read (load.ts) → shaped (model.ts, pure) → drawn (view.tsx), so the design
 * fixture draws the same view from the frames' sample records.
 */

type Props = { staff: CurrentStaff; view?: string; month?: string; day?: string; eventId?: string; sheet?: string; holiday?: string; hide?: string; kind?: string };

export async function SchoolCalendar({ staff, ...params }: Props) {
  const asked: CalendarParams = params;
  const data = await loadCalendar(staff, asked);
  const model = data ? buildCalendar(data, asked, WHATSAPP_MESSAGE_COST_RUPEES) : ({ screen: "closed", language: staff.language } as const);
  return <CalendarView model={model} />;
}
