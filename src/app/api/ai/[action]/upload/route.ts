import { type NextRequest } from "next/server";

import { runAiRoute } from "@/lib/ai/route";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  return runAiRoute(request, (await context.params).action, "upload");
}
