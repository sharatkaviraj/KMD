"use client";
import dynamic from "next/dynamic";

/*
 * The teacher's certificate cards (D-542), loaded after the page has drawn.
 * Both read their requests after the first paint anyway, and on Today the
 * card hides itself until a teacher has asked for something, so neither
 * belongs in the JavaScript every teacher's screen starts with.
 */

export const MyCertificateRequestsLazy = dynamic(() => import("./certificates").then((m) => m.MyCertificateRequests), { ssr: false });

export const StudentCertificateCardLazy = dynamic(() => import("./certificates").then((m) => m.StudentCertificateCard), {
  ssr: false,
  // Holds the card's place so the page does not jump when it arrives.
  loading: () => <div className="card cert-card" aria-hidden="true" style={{ order: 2, minHeight: 132 }} />,
});
