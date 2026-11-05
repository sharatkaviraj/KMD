"use client";

import dynamic from "next/dynamic";
import type { CSSProperties } from "react";

import { useReadyDrafts } from "./ready-store";

const Card = dynamic(() => import("./ready").then((m) => m.ReadyForYou), { ssr: false });

/** "Ready for you" (D-418), fetched only when the app has prepared something for this person. */
export function ReadyForYou(props: { order?: number; wrap?: CSSProperties }) {
  const { drafts } = useReadyDrafts();
  return drafts.length ? <Card {...props} /> : null;
}

/** The cover duty's AI plan (D-324, D-418), fetched when the duty sheet opens; Today itself does not carry it. */
export const LazyCoverAssist = dynamic(() => import("./cover-assist").then((m) => m.CoverAssist), { ssr: false });
