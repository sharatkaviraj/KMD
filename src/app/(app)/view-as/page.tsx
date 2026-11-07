import { notFound } from "next/navigation";

import { getSignedInStaff } from "@/platform/auth/current-staff";
import { LanguageProvider } from "@/platform/i18n/use-language";
import { agoP } from "@/vx/format";
import { loadViewAsChoices } from "@/vx/screens/view-as/data";
import { ViewAsScreen } from "@/vx/screens/view-as/view-as-screen";
import { VxPage } from "@/vx/ui/page";
import { getViewer } from "@/vx/view-as";

export const runtime = "nodejs";

export const metadata = { title: "See One as a person" };

/**
 * See One as a person (D-544): the administrator picks a member of staff and
 * One opens as that person sees it, look-only.
 *
 * Decided on the person actually signed in (`getSignedInStaff`): while a
 * person is being looked at, the request's staff member is that person, and
 * this page is where the administrator changes person or goes back. It is
 * drawn in the administrator's own language, whatever the person reads in.
 * Anybody else gets the not-found page: the feature is not advertised.
 */
export default async function ViewAsPage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const actor = await getSignedInStaff();
  if (!actor || actor.role !== "admin" || !actor.isActive || actor.smokeLab) notFound();

  const [{ people, recent }, viewer, params] = await Promise.all([loadViewAsChoices(actor), getViewer(), searchParams]);
  const now = new Date();
  const subject = viewer.person ? viewer.staff : null;
  const current = subject
    ? { id: subject.id, name: subject.displayName, role: subject.role, photo: people.find((x) => x.id === subject.id)?.photo ?? null }
    : null;
  const focus = typeof params.who === "string" && people.some((x) => x.id === params.who) ? params.who : null;

  return (
    <LanguageProvider language={actor.language}>
      <VxPage label="See One as a person">
        <ViewAsScreen people={people} recent={recent.map((r) => ({ ...r, when: agoP(r.startedAt, now) }))} current={current} focus={focus} />
      </VxPage>
    </LanguageProvider>
  );
}
