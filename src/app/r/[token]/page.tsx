import { createHash } from "node:crypto";
import { notFound } from "next/navigation";

import { AuthoredText } from "@/ui/authored-text";
import { m } from "@/messages";
import { dayLabel } from "@/platform/dates";
import { countOf, flat, primary, t } from "@/platform/i18n/language";
import {
  clientIp,
  limitByIp,
  limitByToken,
  limitUnknownToken,
} from "@/modules/collection/data/rate-limit";
import { resolveToken, rollForRequest } from "@/modules/collection/data/requests-repo";
import { completeness } from "@/modules/collection/domain/requests";
import { RequestForm } from "@/modules/collection/ui/request-form";
import { getSchoolName } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "VPPS One",
  // A token link must never end up in a search index. It is a capability.
  robots: { index: false, follow: false },
};

/**
 * The only page a teacher ever sees.
 *
 * No shell, no navigation, no menu: a link opens exactly one class and exactly
 * the fields the office asked for. Authorization is resolved in
 * `requests-repo.ts` and nowhere else.
 *
 * **Every rejection renders the same 404** — unknown token, draft, or
 * deliberately closed. Telling a stranger "that link exists but is closed" is
 * telling them their guess was right.
 *
 * A passed due date is *not* a rejection. The deadline stays visible and she
 * can keep working: a teacher finishing on Sunday what was due Friday is the
 * normal case, and a link that locked itself would turn her work into a phone
 * call to the office.
 */
export default async function TokenRequestPage(props: PageProps<"/r/[token]">) {
  const { token } = await props.params;
  const ip = await clientIp();

  // Charged before any lookup, so a guess costs no database read.
  const byIp = await limitByIp(ip);
  if (!byIp.allowed) notFound();

  const byToken = await limitByToken(token);
  if (!byToken.allowed) notFound();

  const request = await resolveToken(token);

  if (!request) {
    await limitUnknownToken(ip);
    notFound();
  }

  const language = request.language;
  const roll = await rollForRequest(request);
  await createAdminClient().rpc("mark_teacher_task_opened", { p_id: request.id, p_staff: null, p_token: null, p_request_token: token });
  const done = completeness(roll, request.fields);

  const asking = request.fields
    .map((field) => (language === "en" ? field.labelEn : field.labelHi))
    .join(" · ");

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pb-4">
      <header className="sticky top-0 z-10 -mx-4 mb-3 bg-nav px-4 py-3 text-nav-foreground">
        <div className="mx-auto max-w-md">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="truncate text-[17px] font-semibold">
              <AuthoredText
                value={{ hi: request.titleHi, en: request.titleEn }}
                language={language}
              />
            </h1>
            {request.dueDate ? (
              <p className="shrink-0 text-[12px] opacity-90">
                {primary(m.linkDueBy, language)}{" "}
                {primary(dayLabel(request.dueDate), language)}
              </p>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-nav-muted">
            {request.classLabel} · {asking}
          </p>
          <p className="mt-0.5 text-[12px] text-nav-muted">
            {countOf(done.answered, done.expected, language)}{" "}
            {primary(m.collectionAnswered, language)}
          </p>
        </div>
      </header>

      {/* The office's own sentence about why this list is what it is. Without
          it, nine names under a heading that says "Class 8" reads as a broken
          list rather than a deliberate subset. */}
      {request.reasonEn || request.reasonHi ? (
        <aside
          role="note"
          className="mb-3 rounded-xl border border-warning/30 bg-warning-soft px-3.5 py-3 text-[13px] leading-5 text-warning-soft-foreground"
        >
          {language === "en"
            ? (request.reasonEn ?? request.reasonHi)
            : (request.reasonHi ?? request.reasonEn)}
        </aside>
      ) : null}

      <RequestForm
        draftScope={createHash("sha256").update(token).digest("hex")}
        sessionLabel={request.sessionLabel}
        token={token}
        fields={request.fields}
        roll={roll}
        language={language}
      />

      <footer className="pt-2 text-center text-[11px] text-subtle-foreground">
        {flat(t(getSchoolName(), getSchoolName()), language)}
      </footer>
    </main>
  );
}
