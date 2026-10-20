export const runtime = "nodejs";

export const metadata = { title: "Smoke run ended", robots: { index: false, follow: false } };

const WHY: Record<string, string> = {
  expired: "This pass or its run has expired.",
  revoked: "This pass was revoked.",
  run_closed: "This smoke run has been closed.",
  profile: "This test account has no usable profile. Ask the admin to run the pool set-up again.",
  unavailable: "Sign-in could not be completed. Try the pass again in a minute.",
  signed_in: "This browser is signed in as a member of staff. Sign out first, or use a separate browser profile for the agent.",
};

/**
 * Where a Smoke Lab agent lands when its pass no longer works. Plain on
 * purpose: agents read it, and it is reached signed out. Test tool only, in
 * English (it is never shown to school staff).
 */
export default async function SmokeEnded(props: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await props.searchParams;
  return (
    <main style={{ maxWidth: 520, margin: "48px auto", padding: "0 16px", fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 24 }}>Smoke run ended</h1>
      <p>{WHY[reason ?? ""] ?? "This pass is not valid."}</p>
      <p>Nothing more can be done with this account until an admin issues a new pass on the Smoke Lab page.</p>
    </main>
  );
}
