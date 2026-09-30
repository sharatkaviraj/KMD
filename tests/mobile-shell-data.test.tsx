import { describe, expect, it, vi } from "vitest";
import { DashboardShell } from "@/ui/shell/dashboard-shell";
import { getShellPulse } from "@/modules/dashboard/data/shell-metrics";
import { getFeePolicyForSession } from "@/modules/fees/domain/queries";

vi.mock("@/modules/dashboard/data/shell-metrics", () => ({
  EMPTY_SHELL_PULSE: { todayTotalAmount: 0, todayReceiptCount: 0, overdueStudentCount: 0, todayWrittenOffAmount: 0 },
  getShellPulse: vi.fn(async () => ({ todayTotalAmount: 0, todayReceiptCount: 0, overdueStudentCount: 0, todayWrittenOffAmount: 0 })),
}));
vi.mock("@/modules/fees/domain/queries", () => ({ getFeePolicyForSession: vi.fn(async () => ({ receiptPrefix: "TEST" })) }));
vi.mock("@/modules/fees/platform/session-context/switcher", () => ({ getSessionSwitcherData: vi.fn(async () => ({ activeSessionLabel: "2026-27", availableSessions: [] })) }));
vi.mock("@/ui/shell/office-sync-listener", () => ({ OfficeSyncListener: () => null }));
vi.mock("@/ui/shell/app-topbar", () => ({ AppTopBar: () => null }));
vi.mock("@/ui/shell/shell-session-pill", () => ({ ShellSessionPill: () => null, ShellSessionPillSkeleton: () => null }));
vi.mock("@/ui/shell/mobile-bottom-nav", () => ({ MobileBottomNav: () => null }));
vi.mock("@/ui/shell/sidebar-nav", () => ({ SidebarNav: () => null }));
vi.mock("@/ui/shell/session-switch-overlay", () => ({ SessionSwitchOverlayMount: () => null }));
vi.mock("@/ui/shell/locale-switcher", () => ({ LocaleSwitcher: () => null }));
vi.mock("@/platform/env", () => ({ isLocaleSwitcherEnabled: () => false }));

const base = { children: null, staffEmail: "synthetic@example.invalid", staffRole: "teacher" as const, viewSessionLabel: "2026-27", viewSessionIsTest: true };

describe("role-aware workspace shell read budget", () => {
  it("does not start financial summary or policy reads outside the native fee workspace", () => {
    vi.mocked(getShellPulse).mockClear();
    vi.mocked(getFeePolicyForSession).mockClear();
    DashboardShell({ ...base, showFeeMetrics: false });
    expect(getShellPulse).not.toHaveBeenCalled();
    expect(getFeePolicyForSession).not.toHaveBeenCalled();
  });
  it("retains the existing summary reads for authorized fee roles", () => {
    vi.mocked(getShellPulse).mockClear();
    vi.mocked(getFeePolicyForSession).mockClear();
    DashboardShell({ ...base, staffRole: "accountant", showFeeMetrics: true });
    expect(getShellPulse).toHaveBeenCalledExactlyOnceWith("2026-27");
    expect(getFeePolicyForSession).toHaveBeenCalledExactlyOnceWith("2026-27");
  });
});
