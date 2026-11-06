import "server-only";

import * as m from "@/messages/pairs";
import { getCurrentStaff } from "@/platform/auth/current-staff";
import { primary, SIGNED_OUT_LANGUAGE, type Localized } from "@/platform/i18n/language";

/**
 * The browser tab's title, in the reader's own language.
 *
 * A `<title>` is one line and cannot stack, so it takes the reader's primary
 * language and never both — a bilingual title is twice as long in a tab strip
 * that is already truncating (D-37).
 *
 * This reads the staff profile, which the page it belongs to has already read,
 * so it costs nothing: `getCurrentStaff()` is cached per request.
 */
export async function pageTitle(title: Localized): Promise<string> {
  const staff = await getCurrentStaff();
  const language = staff?.language ?? SIGNED_OUT_LANGUAGE;

  // SIGNED_OUT_LANGUAGE is "both", and primary() leads with Hindi for it —
  // which is the right default for a tab nobody has claimed yet.
  return `${primary(title, language)} · ${m.appName.hi}`;
}
