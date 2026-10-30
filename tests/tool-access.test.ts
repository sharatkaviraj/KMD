import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D-346: on a production database the QA tools are confined to test accounts.
 * `toolAccountAccess` is the one check; passwordless test sign-in asks it
 * before any magic-link token is minted. Synthetic ids, mocked clients,
 * nothing fetched.
 */

const mocks = vi.hoisted(() => ({
  environment: { value: "production" as "dev" | "production" },
  profile: { result: { data: null as unknown, error: null as unknown } },
  users: { list: [] as Array<{ id: string; email: string }>, error: null as unknown },
  eq: vi.fn(),
  listUsers: vi.fn(),
  generateLink: vi.fn(),
  verifyOtp: vi.fn(),
  toolAccess: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/platform/deployment/marker", () => ({ readEffectiveEnvironment: async () => mocks.environment.value }));
vi.mock("@/platform/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: (column: string, value: string) => {
          mocks.eq(column, value);
          return query;
        },
        maybeSingle: async () => mocks.profile.result,
      };
      return query;
    },
    auth: {
      admin: {
        listUsers: async (args: { page: number; perPage: number }) => {
          mocks.listUsers(args);
          return mocks.users.error
            ? { data: { users: [] }, error: mocks.users.error }
            : { data: { users: args.page === 1 ? mocks.users.list : [] }, error: null };
        },
        generateLink: mocks.generateLink,
      },
    },
  }),
}));

import { toolAccountAccess } from "@/platform/deployment/tool-access";

const USER = "00000000-0000-4000-8000-000000000a01";
const PROFILE = "00000000-0000-4000-8000-000000000b01";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.environment.value = "production";
  mocks.profile.result = { data: null, error: null };
  mocks.users = { list: [], error: null };
});

describe("toolAccountAccess", () => {
  it("lets any account through on a dev database without reading a profile", async () => {
    mocks.environment.value = "dev";
    expect(await toolAccountAccess({ userId: USER })).toEqual({ ok: true });
    expect(mocks.eq).not.toHaveBeenCalled();
  });

  it("on production admits a test account, looked up by staff profile id", async () => {
    mocks.profile.result = { data: { is_test_account: true }, error: null };
    expect(await toolAccountAccess({ staffProfileId: PROFILE })).toEqual({ ok: true });
    expect(mocks.eq).toHaveBeenCalledWith("id", PROFILE);
  });

  it("on production admits a test account, looked up by auth user id", async () => {
    mocks.profile.result = { data: { is_test_account: true }, error: null };
    expect(await toolAccountAccess({ userId: USER })).toEqual({ ok: true });
    expect(mocks.eq).toHaveBeenCalledWith("user_id", USER);
  });

  it("on production refuses a real account", async () => {
    mocks.profile.result = { data: { is_test_account: false }, error: null };
    expect((await toolAccountAccess({ staffProfileId: PROFILE })).ok).toBe(false);
  });

  it("fails closed: a read error, no row, or no id at all is refused", async () => {
    mocks.profile.result = { data: { is_test_account: true }, error: { message: "boom" } };
    expect((await toolAccountAccess({ userId: USER })).ok).toBe(false);
    mocks.profile.result = { data: null, error: null };
    expect((await toolAccountAccess({ userId: USER })).ok).toBe(false);
    expect((await toolAccountAccess({})).ok).toBe(false);
    expect(mocks.eq).toHaveBeenCalledTimes(2);
  });

  it("resolves an email to its auth user without minting anything", async () => {
    mocks.users.list = [{ id: USER, email: "QA.Admin@qa.vpps.local" }];
    mocks.profile.result = { data: { is_test_account: true }, error: null };
    expect(await toolAccountAccess({ email: "qa.admin@qa.vpps.local" })).toEqual({ ok: true });
    expect(mocks.eq).toHaveBeenCalledWith("user_id", USER);
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("refuses an email it cannot find, or cannot list", async () => {
    expect((await toolAccountAccess({ email: "nobody@qa.vpps.local" })).ok).toBe(false);
    mocks.users.error = { message: "down" };
    expect((await toolAccountAccess({ email: "qa.admin@qa.vpps.local" })).ok).toBe(false);
    expect(mocks.eq).not.toHaveBeenCalled();
  });
});

describe("testSignInAction on a production database", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({ redirect: mocks.redirect }));
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("@/platform/auth/test-accounts", () => ({
      testSignInEnabled: () => true,
      TEST_ACCOUNTS: [{ key: "admin", email: "qa.admin@qa.vpps.local" }],
    }));
    vi.doMock("@/platform/deployment/tool-access", () => ({ toolAccountAccess: mocks.toolAccess }));
    vi.doMock("@/platform/supabase/server", () => ({ createClient: async () => ({ auth: { verifyOtp: mocks.verifyOtp } }) }));
    vi.doMock("@/platform/auth/admit", () => ({ admitSignedInUser: vi.fn() }));
  });
  afterEach(() => {
    vi.doUnmock("next/navigation");
    vi.doUnmock("@/platform/auth/test-accounts");
    vi.doUnmock("@/platform/deployment/tool-access");
    vi.doUnmock("@/platform/supabase/server");
    vi.doUnmock("@/platform/auth/admit");
  });

  const form = () => {
    const data = new FormData();
    data.set("key", "synthetic-key");
    data.set("account", "admin");
    return data;
  };

  it("refuses a non-test account before minting a token or verifying one", async () => {
    mocks.toolAccess.mockResolvedValue({ ok: false, reason: "production" });
    const { testSignInAction } = await import("@/app/login/actions");
    await expect(testSignInAction(form())).rejects.toThrow("REDIRECT /login?error=profile");
    expect(mocks.toolAccess).toHaveBeenCalledWith({ email: "qa.admin@qa.vpps.local" });
    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("mints only after the account is cleared", async () => {
    mocks.toolAccess.mockResolvedValue({ ok: true });
    mocks.generateLink.mockResolvedValue({ data: { properties: {} }, error: { message: "stop here" } });
    const { testSignInAction } = await import("@/app/login/actions");
    await expect(testSignInAction(form())).rejects.toThrow("REDIRECT /login?error=link");
    expect(mocks.generateLink).toHaveBeenCalledTimes(1);
    expect(mocks.toolAccess.mock.invocationCallOrder[0]).toBeLessThan(mocks.generateLink.mock.invocationCallOrder[0]);
  });
});
