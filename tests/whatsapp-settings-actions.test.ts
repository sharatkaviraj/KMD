import { beforeEach, describe, expect, it, vi } from "vitest";

import { noteFor } from "@/messages/whatsapp-settings";

/**
 * Settings → WhatsApp shows its buttons to a practice account and to an admin
 * using "See One as", and both may only look (D-563). Pressing one used to
 * throw, which put the whole page behind the "Something went wrong" screen
 * (BrowserStack, Galaxy M32, 9 Nov). Now the answer is a plain note beside the
 * card, nothing is changed, and nothing else is caught.
 */

const state = vi.hoisted(() => ({
  testAccount: false,
  previewing: false,
  setPracticeMode: vi.fn(async () => true),
  setFeatureSwitch: vi.fn(async () => true),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { digest: `NEXT_REDIRECT;replace;${to};307;` });
  },
}));
vi.mock("@/platform/auth/current-staff", () => ({
  assertPermission: async () => ({ id: "staff-qa", userId: "user-qa", role: "admin" }),
}));
vi.mock("@/platform/auth/test-session-access", async () => {
  class SessionAccessDenied extends Error {}
  return {
    SessionAccessDenied,
    isSessionAccessDenied: (error: unknown) => error instanceof SessionAccessDenied,
    assertNotTestAccount: async () => {
      if (state.testAccount) throw new SessionAccessDenied("A test account cannot change what the whole school shares.");
    },
  };
});
vi.mock("@/vx/view-as", () => ({
  assertNotPreviewing: async () => {
    if (state.previewing) throw new Error("You are seeing the app as another role. Switch back to make changes.");
  },
}));
vi.mock("@/platform/env", () => ({ getSiteUrl: () => "https://one.example.test" }));
vi.mock("@/platform/whatsapp/service", () => ({ checkConnection: vi.fn(), retryMessage: vi.fn(), syncTemplates: vi.fn() }));
vi.mock("@/platform/whatsapp/store", () => ({
  readMessage: vi.fn(),
  setFeatureSwitch: state.setFeatureSwitch,
  setPracticeMode: state.setPracticeMode,
  setTemplateStatus: vi.fn(),
}));
vi.mock("@/modules/whatsapp/data/whatsapp-source-sync", () => ({ syncSettledToSource: vi.fn() }));

import { setFeatureAction, setPracticeModeAction } from "@/app/(app)/settings/whatsapp/actions";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function landing(action: Promise<void>): Promise<string> {
  const error = await action.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message).toMatch(/^NEXT_REDIRECT /);
  return message.slice("NEXT_REDIRECT ".length);
}

beforeEach(() => {
  state.testAccount = false;
  state.previewing = false;
  state.setPracticeMode.mockClear();
  state.setFeatureSwitch.mockClear();
});

describe("Settings → WhatsApp refuses in plain words", () => {
  it("a practice account pressing Turn practice off lands on a note beside that card, and nothing changes", async () => {
    state.testAccount = true;
    const to = await landing(setPracticeModeAction(form({ on: "false" })));
    expect(to).toBe("/settings/whatsapp?note=practice_locked&why=test#practice");
    expect(state.setPracticeMode).not.toHaveBeenCalled();
  });

  it("a feature switch pressed while seeing One as someone else is refused beside the feature list", async () => {
    state.previewing = true;
    const to = await landing(setFeatureAction(form({ feature: "receipt", on: "true" })));
    expect(to).toBe("/settings/whatsapp?note=feature_locked&why=preview#feature");
    expect(state.setFeatureSwitch).not.toHaveBeenCalled();
  });

  it("a real admin still changes the switch", async () => {
    const to = await landing(setPracticeModeAction(form({ on: "false" })));
    expect(to).toBe("/settings/whatsapp?note=practice_off#practice");
    expect(state.setPracticeMode).toHaveBeenCalledWith(false, "staff-qa");
  });

  it("says so in both languages, and that nothing was changed", () => {
    for (const why of ["test", "preview"]) {
      const note = noteFor("practice_locked", { why });
      expect(note?.tone).toBe("info");
      expect(note?.text.en).toMatch(/Nothing was changed\.$/);
      expect(note?.text.hi).toMatch(/कुछ नहीं बदला।$/);
    }
    expect(noteFor("practice_locked", { why: "test" })?.text.en).toMatch(/practice account/);
    expect(noteFor("feature_locked", { why: "preview" })?.text.en).toMatch(/seeing One as someone else/);
  });
});
