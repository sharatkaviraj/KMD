import { notFound } from "next/navigation";

import { testSignInAction } from "@/app/login/actions";
import { TEST_ACCOUNTS, testSignInEnabled } from "@/platform/auth/test-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = { title: "Test accounts", robots: { index: false, follow: false } };

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  office: "Office",
  accountant: "Accountant",
  fee_collector: "Fee collector",
  academic_coordinator: "Academic coordinator",
  exam_coordinator: "Exam coordinator",
  teacher: "Teacher",
  view_only: "View only",
};

/**
 * One tap to sign in as any QA role, no password (UI-63). Reachable only with
 * the secret key in the link, and only while the app is on the dev database.
 */
export default async function TestAccountsPage(props: PageProps<"/login/test">) {
  const { key } = await props.searchParams;
  if (!testSignInEnabled(key)) notFound();

  return (
    <div className="vx" style={{ minHeight: "100dvh", background: "var(--bg)", color: "var(--fg)", display: "flex", justifyContent: "center", padding: "32px 16px" }}>
      <main style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 className="serif" style={{ margin: 0, fontSize: 26, fontWeight: 600 }}>Test accounts</h1>
        <p style={{ margin: 0, color: "var(--mut)", lineHeight: 1.5 }}>
          Sign in as any role on the test database without a password. Only test accounts are listed, and this page stops working when the app moves to the live database.
        </p>
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {TEST_ACCOUNTS.map((account, i) => (
            <form key={account.key} action={testSignInAction} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderTop: i === 0 ? 0 : "1px solid var(--bd)" }}>
              <input type="hidden" name="account" value={account.key} />
              <input type="hidden" name="key" value={key as string} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <strong>{ROLE_LABEL[account.role] ?? account.role}{account.key !== account.role ? ` · ${account.key}` : ""}</strong>
                <span style={{ fontSize: 13, color: "var(--mut)", overflowWrap: "anywhere" }}>{account.email}</span>
              </span>
              <button type="submit" className="tap btn pri">Sign in</button>
            </form>
          ))}
        </div>
      </main>
    </div>
  );
}
