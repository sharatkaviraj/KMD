"use client";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/vx/ui/overlays";

/** One task's management and delivery over Needs you, opened by `?task=` and closed back to the queue. */
export function TaskDetailSheet({ title, sub, back, children }: { title: string; sub?: string; back: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <Sheet open onClose={() => router.replace(back, { scroll: false })} title={title} sub={sub} icon="users" wide>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 8 }}>{children}</div>
    </Sheet>
  );
}
