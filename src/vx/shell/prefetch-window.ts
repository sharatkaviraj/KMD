/**
 * When a teacher on Today is about to open the register (perf fix 9): from
 * 08:00 to 10:30 in the school's time zone, whatever the phone's own zone.
 * Outside it, warming the register would be a server render nobody uses.
 */
export function inMarkingWindow(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const minutes = hour * 60 + minute;
  return minutes >= 8 * 60 && minutes < 10 * 60 + 30;
}
