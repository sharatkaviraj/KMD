"use client";

import Image from "next/image";
import { useState } from "react";

import { schoolBrand } from "@/platform/config/school-brand";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";

/** The school's name, said by a crest that is the only identity on screen. */
export const CREST_NAME = p("Shri Veer Patta Senior Secondary School", "श्री वीर पत्ता सीनियर सेकेंडरी स्कूल");

/** The design's own crest mark, and the one Today's hero drew before the logo stood in it (D-369). */
const MONOGRAM = "VP";

/**
 * The school's logo in the design's crest (review T01).
 *
 * `named`: the crest is the only thing on screen that says which school this
 * is (Today's phone hero, beside "VPPS One", the app's name), so it is an
 * image named for the school. Without it the crest is decorative: a visible
 * school name sits beside it (sign-in, receipts, report cards, the exam
 * timetable, the WhatsApp preview, the TC preview) and saying it twice is
 * noise.
 *
 * If the logo cannot be loaded the crest shows the design's "VP" monogram in
 * the same tile, instead of an empty square or a broken-image icon. The
 * approved asset itself is unchanged (`schoolBrand.logo`).
 *
 * `still`: no pop-in — for the logo on a receipt, record or report rather than a greeting.
 */
export function Crest({ size, radius, shadow, still = false, named = false }: { size: number; radius: number; shadow?: boolean; still?: boolean; named?: boolean }) {
  const { tx } = useVx();
  const [broken, setBroken] = useState(false);
  return (
    <span
      role={named ? "img" : undefined}
      aria-label={named ? tx(CREST_NAME) : undefined}
      data-crest={broken ? "monogram" : "logo"}
      style={{
        flex: "none",
        width: size,
        height: size,
        borderRadius: radius,
        background: "#F7F6F3",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        boxShadow: shadow ? "0 20px 40px -18px rgba(0,0,0,.6)" : undefined,
        animation: still ? undefined : "xPopIn .5s var(--spring) both",
      }}
    >
      {broken ? (
        <span
          aria-hidden="true"
          style={{ color: "#082F49", fontFamily: "var(--font-display),'Source Serif 4',Georgia,serif", fontWeight: 700, fontSize: Math.round(size * 0.4), lineHeight: 1 }}
        >
          {MONOGRAM}
        </span>
      ) : (
        <Image
          src={schoolBrand.logo}
          alt=""
          width={size}
          height={size}
          sizes={`${size}px`}
          onError={() => setBroken(true)}
          style={{ width: "78%", height: "78%", objectFit: "contain" }}
        />
      )}
    </span>
  );
}
