import { notFound } from "next/navigation";
import { CheckCircle2, MessageSquare } from "lucide-react";

import { AuthoredText } from "@/ui/authored-text";
import { m } from "@/messages";
import { dayLabel } from "@/platform/dates";
import { getSchoolName } from "@/platform/env";
import {
  primary,
  type Language,
  type Localized,
} from "@/platform/i18n/language";
import {
  clientIp,
  limitByIp,
  limitByToken,
  limitUnknownToken,
} from "@/modules/collection/data/rate-limit";
import { resolveStaffToken } from "@/modules/collection/data/requests-repo";
import { Panel, PanelRow } from "@/ui/panel";
import { StateCard } from "@/ui/states";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "VPPS One",
  robots: { index: false, follow: false },
};

/**
 * Everything currently open for one teacher, on one durable link.
 *
 * A round of collection used to mean the office sending one WhatsApp message
 * per teacher per request. This is what makes the next round cost none: she
 * keeps one URL, and whatever the school is asking for appears on it.
 *
 * **A menu of her own work, and nothing else.** No other teacher's requests,
 * nothing closed, no navigation past the list. The scope comes from the staff
 * member the token's own request names — never from anything in the URL — and
 * every entry has been through the same check a `/r/` link goes through.
 */
export default async function StaffTokenPage(props: PageProps<"/t/[token]">) {
  const { token } = await props.params;
  const ip = await clientIp();

  const byIp = await limitByIp(ip);
  if (!byIp.allowed) notFound();

  const byToken = await limitByToken(token);
  if (!byToken.allowed) notFound();

  const resolved = await resolveStaffToken(token);

  if (!resolved) {
    await limitUnknownToken(ip);
    notFound();
  }

  // Every request on this list belongs to the same person, so the first one's
  // language is hers.
  const language = resolved.requests[0]?.language ?? "both";

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pb-8">
      <header className="-mx-4 mb-4 bg-nav px-4 py-3 text-nav-foreground">
        <div className="mx-auto max-w-md">
          <h1 className="truncate text-[17px] font-semibold">
            {primary(m.linkYourRequests, language)}
          </h1>
          <p className="mt-0.5 truncate text-[12px] text-nav-muted">
            {resolved.staffName} · {getSchoolName()}
          </p>
        </div>
      </header>

      {resolved.requests.length === 0 ? (
        // "Nothing is waiting for you" is good news, and the atlas's empty
        // state says so with a tick rather than with a grey box.
        <StateCard
          icon={CheckCircle2}
          title={m.linkNoRequests}
          language={language}
        />
      ) : (
        <Panel
          title={m.linkYourRequests}
          description={countOfPairs(resolved.requests.length, language)}
          language={language}
        >
          {resolved.requests.map((request) => (
            <PanelRow
              key={request.id}
              href={`/r/${request.token}`}
              icon={MessageSquare}
              title={
                <AuthoredText
                  value={{ hi: request.titleHi, en: request.titleEn }}
                  language={language}
                />
              }
              detail={[
                request.classLabel,
                request.dueDate
                  ? `${primary(m.linkDueBy, language)} ${primary(dayLabel(request.dueDate), language)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
        </Panel>
      )}
    </main>
  );
}

/** "3 to do", in whichever language the link is being read in. */
function countOfPairs(count: number, language: Language): Localized {
  const text = `${count} ${primary(m.linkToDo, language)}`;
  return { hi: text, en: text };
}
