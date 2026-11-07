"use client";
import dynamic from "next/dynamic";

/*
 * The certificate card on a child's page (D-542), loaded after the page has
 * drawn: it reads its requests after the first paint anyway, so it does not
 * belong in the JavaScript the child's page starts with. Today's card of the
 * teacher's own requests is drawn on the server (certificates-today.tsx).
 */

export const StudentCertificateCardLazy = dynamic(() => import("./certificates").then((m) => m.StudentCertificateCard), {
  ssr: false,
  // Holds the card's place so the page does not jump when it arrives.
  loading: () => <div className="card cert-card" aria-hidden="true" style={{ order: 2, minHeight: 132 }} />,
});
