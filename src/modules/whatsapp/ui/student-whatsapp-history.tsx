import "server-only";

import Link from "@/ui/link";

import {
  describeAttemptResult,
  loadStudentWhatsappHistory,
} from "@/modules/whatsapp/data/fix-desk";
import { CAUSE_COPY, isFailureCause } from "@/modules/whatsapp/domain/failure-cause";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { formatDateTimeIst } from "@/platform/helpers/date";
import { cn } from "@/platform/utils";

/**
 * The last few reminders this child's family was sent, and whether they
 * arrived — on the student's own page, so whoever is talking to the parent can
 * see "WhatsApp never reached this number" without opening Reminders.
 *
 * Server-only, streamed inside `<Suspense>`: it adds no client JavaScript to a
 * route under a bundle ceiling. Renders nothing for a student never messaged.
 */
export async function StudentWhatsappHistory({ studentId }: { studentId: string }) {
  const events = await loadStudentWhatsappHistory(createAdminClient(), studentId);
  if (events.length === 0) return null;
  const failed = events[0] && (events[0].result === "failed" || events[0].result === "refused");

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-foreground">WhatsApp reminders</h2>
        {failed ? (
          <Link
            href="/fees/reminders/fix"
            className="focus-ring inline-flex min-h-11 items-center text-xs font-semibold text-accent underline-offset-2 hover:underline md:min-h-0"
          >
            Last one did not arrive · Fix
          </Link>
        ) : null}
      </div>
      <ol className="flex flex-col gap-2 border-l-2 border-border pl-3">
        {events.map((event, index) => (
          <li key={`${event.at}-${index}`} className="text-xs">
            <span className="tabular-nums text-muted-foreground">{formatDateTimeIst(event.at)}</span>{" "}
            <span
              className={cn(
                "font-semibold",
                event.result === "failed" || event.result === "refused"
                  ? "text-destructive"
                  : event.result === "delivered" || event.result === "read"
                  ? "text-success"
                  : "text-foreground",
              )}
            >
              {describeAttemptResult(event.result)}
            </span>
            {isFailureCause(event.cause) ? ` · ${CAUSE_COPY[event.cause].label}` : ""}
            {event.destination ? (
              <span className="font-mono text-muted-foreground"> · {event.destination}</span>
            ) : null}
            {event.text ? <span className="block text-muted-foreground">{event.text}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
