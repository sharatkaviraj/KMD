import { redirect } from "next/navigation";

export const runtime = "nodejs";

/** Interim: the redesigned screen replaces this redirect (docs/ui/PROGRESS.md). */
export default function Page() {
  redirect("/academics");
}
