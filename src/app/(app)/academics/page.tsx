import type { Metadata } from "next";

import { requirePermission } from "@/platform/auth/current-staff";
import { AcadHome } from "@/vx/screens/academics/home";
import { param } from "@/vx/screens/academics/ui";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Academics · Today" };

/** The academic coordinator's Today (AcadHome). The old hub is at /academics/setup. */
export default async function AcademicsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("academics:view", "/academics");
  const sp = await searchParams;
  return <AcadHome staff={staff} view={param(sp.view)} sheet={param(sp.sheet)} marks={param(sp.marks)} what={param(sp.what)} who={param(sp.who)} />;
}
