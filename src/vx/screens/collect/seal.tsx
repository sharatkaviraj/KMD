"use client";

import { useId } from "react";

import { mc } from "@/messages/collect";
import { schoolProfile } from "@/platform/config/school";

/** Speckle positions for the ink texture: a fixed sequence, so every seal looks the same. */
const DOTS = (() => {
  const out: Array<[number, number, number]> = [];
  let x = 7;
  const next = () => (x = (x * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 140; i += 1) out.push([next() * 200, next() * 200, 0.6 + next() * 1.6]);
  return out;
})();

/** "05·11·2026". */
export function stampDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}·${m}·${y}`;
}

/**
 * The school's seal, inked (one inline SVG — no image request, no library).
 * The words round its edge are the school's name and FEE RECEIVED; the centre
 * says PAID with the Hindi underneath and the payment date.
 */
export function Seal({ date }: { date: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ring = `${schoolProfile.shortName.toUpperCase()} ★ ${mc.sealRing.en} ★`;
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <path id={`${id}p`} d="M100,100 m-71,0 a71,71 0 1,1 142,0 a71,71 0 1,1 -142,0" />
        <filter id={`${id}f`}>
          <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves={2} seed={4} />
          <feDisplacementMap in="SourceGraphic" scale={2.6} />
        </filter>
        <mask id={`${id}m`}>
          <rect width="200" height="200" fill="#fff" />
          <g fill="#000" opacity=".55">
            {DOTS.map(([cx, cy, r], i) => (
              <circle key={i} cx={cx.toFixed(1)} cy={cy.toFixed(1)} r={r.toFixed(2)} />
            ))}
          </g>
        </mask>
      </defs>
      <g filter={`url(#${id}f)`} mask={`url(#${id}m)`} fill="none" stroke="currentColor">
        <circle cx="100" cy="100" r="95" strokeWidth="5.5" />
        <circle cx="100" cy="100" r="86" strokeWidth="1.6" />
        <circle cx="100" cy="100" r="56" strokeWidth="1.8" />
        <text fontFamily="Source Serif 4,Georgia,serif" fontSize="13.2" fontWeight="700" letterSpacing="1.55" fill="currentColor" stroke="none">
          <textPath href={`#${id}p`}>{ring}</textPath>
        </text>
        <text x="100" y="99" textAnchor="middle" fontFamily="Source Serif 4,Georgia,serif" fontSize="33" fontWeight="700" letterSpacing="3" fill="currentColor" stroke="none">
          {mc.sealPaid.en}
        </text>
        <text x="100" y="119" textAnchor="middle" fontFamily="ui-monospace,Consolas,monospace" fontSize="11.5" fontWeight="600" fill="currentColor" stroke="none">
          {stampDate(date)}
        </text>
        <text x="100" y="137" textAnchor="middle" fontFamily="Noto Sans Devanagari,sans-serif" fontSize="12" fontWeight="600" fill="currentColor" stroke="none">
          {mc.sealPaid.hi}
        </text>
      </g>
    </svg>
  );
}
