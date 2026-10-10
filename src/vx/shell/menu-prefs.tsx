"use client";

import { Card } from "@/vx/ui/primitives";

import { LangButton, ThemeButton } from "./sidebar";

/** Theme and language on the phone Menu page. */
export function MenuPrefs() {
  return (
    <Card style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ flex: 1, fontWeight: 600 }}>Appearance and language</span>
      <ThemeButton tone="page" />
      <LangButton tone="page" />
    </Card>
  );
}
