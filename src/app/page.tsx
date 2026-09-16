import { redirect } from "next/navigation";

export const runtime = "nodejs";

/**
 * There is no marketing page and never will be. `/` is a doorway: the proxy
 * has already sent a signed-out visitor to `/login`, so anyone arriving here
 * has a session and wants the app.
 */
export default function RootPage() {
  redirect("/dashboard");
}
