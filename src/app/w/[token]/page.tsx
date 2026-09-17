import { notFound, redirect } from "next/navigation";

import {
  clientIp,
  limitByIp,
  limitUnknownToken,
} from "@/modules/collection/data/rate-limit";
import {
  resolveStaffToken,
  resolveToken,
} from "@/modules/collection/data/requests-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "VPPS One",
  robots: { index: false, follow: false },
};

/**
 * Where the button on a WhatsApp template message lands.
 *
 * A template's URL button is approved with its base URL baked in, and the app
 * may only append one value at send time. Whether a "/" inside that value
 * survives Meta and the provider is a question that costs several
 * re-approvals to get wrong — so the value is a bare token and **this route
 * works out what it names**: one request (`/r/`) or a teacher's durable list
 * (`/t/`). It redirects and does nothing else.
 *
 * **No authorization happens here, and none may be added.** Both pages it
 * sends a teacher to resolve the token themselves, exactly as they do when she
 * taps a link the office pasted by hand — a closed request still renders their
 * 404 there. This route only has to be unable to say anything they would not:
 * an unknown token 404s here the same way, and a known one reveals nothing
 * beyond a redirect she was sent on purpose.
 *
 * Rate limited by IP before either lookup, so a guess costs no database read.
 */
export default async function WhatsappLandingPage(props: PageProps<"/w/[token]">) {
  const { token } = await props.params;
  const ip = await clientIp();

  const byIp = await limitByIp(ip);
  if (!byIp.allowed) notFound();

  // A teacher's durable list is the better landing when the token names a
  // request that belongs to one — she sees everything outstanding rather than
  // only the thing this particular message was about.
  const staff = await resolveStaffToken(token);
  if (staff) redirect(`/t/${token}`);

  const request = await resolveToken(token);
  if (request) redirect(`/r/${token}`);

  await limitUnknownToken(ip);
  notFound();
}
