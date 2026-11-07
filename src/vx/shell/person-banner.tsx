"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import { saveLanguageAction } from "@/app/(app)/preferences/actions";
import type { Language } from "@/platform/i18n/language";
import { VIEW_AS_DOCUMENT_FLAG } from "@/platform/supabase/view-as-browser";
import { cue } from "@/ui/feedback/cue";
import Link from "@/ui/link";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { Avatar } from "@/vx/ui/primitives";

import { languageSwitch } from "./person-language";
import { endViewAsPersonAction } from "./view-as-actions";
import "./person-banner.css";

const W = {
  seeing: p("You are seeing One as", "आप One को इनकी नज़र से देख रहे हैं"),
  lookOnly: p("Look only. Nothing you tap is saved or sent.", "सिर्फ़ देखना। आप जो भी दबाएँ, कुछ सहेजा या भेजा नहीं जाता।"),
  change: p("Change person", "व्यक्ति बदलें"),
  back: p("Back to my view", "अपने व्यू पर लौटें"),
  backing: p("Going back…", "लौट रहे हैं…"),
  region: p("Seeing One as another person", "किसी और की नज़र से One"),
};

/**
 * Across the top of every screen while an administrator sees One as a chosen
 * person (D-544), in the administrator's own language: whose screens these
 * are, that nothing is saved, and the two ways out. The screens below are in
 * the person's language; one tap switches them to the administrator's, for
 * this view only.
 *
 * While it is on the page it also marks `<html>` (`data-vx-view-as`). That
 * mark draws the amber edge round the whole screen (person-banner.css), so a
 * scrolled page still says so, and it tells the browser's own data clients
 * that the view is on, so an upload straight from the phone is refused too
 * (`platform/supabase/view-as-browser.ts`).
 */
export function PersonBanner({
  name,
  role,
  photo,
  initials,
  shown,
  own,
  mine,
}: {
  name: string;
  role: Pair;
  photo: string | null;
  initials: string;
  /** The language the screens below are drawn in. */
  shown: Language;
  /** The person's own language. */
  own: Language;
  /** The administrator's language. */
  mine: Language;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const [leaving, leave] = useTransition();
  const [switching, switchTo] = useTransition();
  const first = name.split(/\s+/)[0] || name;
  const lang = languageSwitch(shown, own, mine, first);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute(VIEW_AS_DOCUMENT_FLAG, "1");
    return () => root.removeAttribute(VIEW_AS_DOCUMENT_FLAG);
  }, []);

  const back = () => {
    cue("tap");
    leave(async () => {
      const href = await endViewAsPersonAction();
      cue("done");
      // The action has already redrawn the frame as the administrator; one push, no second load.
      router.push(href);
    });
  };

  const showIn = (to: Language) => {
    cue("select");
    switchTo(async () => {
      const fd = new FormData();
      fd.set("language", to);
      await saveLanguageAction({ status: "idle", message: null }, fd);
      router.refresh();
    });
  };

  return (
    <div className="vxp" role="region" aria-label={`${tx(W.region)}: ${name}`}>
      <div className="vxp-who">
        <span className="vxp-av">
          <Avatar text={initials} seed={name} photo={photo} size={44} />
          <span className="vxp-eye" aria-hidden="true"><Ic n="eye" size={13} /></span>
        </span>
        <span className="vxp-t">
          <span className="vxp-k">{tx(W.seeing)}</span>
          <b>
            {name} <span className="vxp-r">· {tx(role)}</span>
          </b>
          <span className="vxp-lock">
            <Ic n="lock" size={14} /> {tx(W.lookOnly)}
          </span>
        </span>
      </div>
      <div className="vxp-act">
        {lang ? (
          <button type="button" className="tap vxp-lang" disabled={switching || leaving} onClick={() => showIn(lang.to)}>
            <Ic n={switching ? "refresh" : "globe"} size={16} className={switching ? "spin" : undefined} /> {tx(lang.label)}
          </button>
        ) : null}
        <Link href="/view-as" className="tap btn sec vxp-btn" onClick={() => cue("tap")}>
          <Ic n="users" size={18} /> {tx(W.change)}
        </Link>
        <button type="button" className="tap btn pri vxp-btn" disabled={leaving} onClick={back}>
          <Ic n={leaving ? "refresh" : "undo"} size={18} className={leaving ? "spin" : undefined} /> {tx(leaving ? W.backing : W.back)}
        </button>
      </div>
    </div>
  );
}
