"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

import type { ParentNotesCard as Card } from "./parent-notes-card";

/**
 * The Parents' notes card (D-600) in its own chunk, fetched only when there
 * is a parent's note to show. `/teach/attendance` counts `/teach`'s chunk
 * in its first load, the tightest budget in One (`check:bundles`), and most
 * mornings a class has no note, so most mornings this costs nothing. The
 * server still draws it, so it arrives with the page.
 */
const ParentNotesCard = dynamic(() => import("./parent-notes-card").then((m) => m.ParentNotesCard));

export function ParentNotesLazy(props: ComponentProps<typeof Card>) {
  return <ParentNotesCard {...props} />;
}
