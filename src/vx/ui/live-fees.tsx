"use client";

import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { Banner, Section, TopBar, VxPage } from "@/vx/ui/page";
import { CouldNotRead, RetryButton } from "@/vx/ui/read-state";

/*
 * One's own fee screens for real staff on a real session read Fees itself
 * through the bridge (6 Nov 2026), instead of sending staff to the Fees app.
 * These say where the figures came from, which changes are not in One yet,
 * and, when Fees did not answer, that the figures are not lost — never the
 * local copy's numbers in their place.
 */
const W = {
  live: p("Live from Fees, read at", "Fees से लाइव, पढ़ा गया"),
  unavailable: p("Fees could not be read just now. Nothing is lost; try again in a moment.", "अभी Fees से पढ़ा नहीं जा सका। कुछ भी खोया नहीं है; थोड़ी देर में फिर कोशिश करें।"),
};

function time(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }).format(at);
}

/** "Live from Fees, read at 10:42." plus what cannot be changed from One yet. */
export function LiveFromFees({ asOf, notYet }: { asOf: string; notYet?: Pair }) {
  const { tx } = useVx();
  return (
    <Banner tone="info" action={<RetryButton />}>
      {tx(W.live)} {time(asOf)}.{notYet ? <> {tx(notYet)}</> : null}
    </Banner>
  );
}

/** The whole screen when Fees did not answer: a title, the reason and Try again. */
export function FeesScreenUnavailable({ title, crumb }: { title: Pair; crumb: string }) {
  const { tx } = useVx();
  return (
    <VxPage label={tx(title)}>
      <TopBar title={tx(title)} crumb={crumb} />
      <Section>
        <CouldNotRead message={W.unavailable} action={<RetryButton />} />
      </Section>
    </VxPage>
  );
}
