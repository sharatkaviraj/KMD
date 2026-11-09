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
  submitHubTemplateSet: vi.fn(async () => ({ ok: true as const, sent: 22, skipped: 0, failed: [] as Array<{ name: string; problem: string }> })),
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
vi.mock("@/platform/whatsapp/service", () => ({ checkConnection: vi.fn(), retryMessage: vi.fn() }));
vi.mock("@/platform/whatsapp/store", () => ({
  readMessage: vi.fn(),
  setFeatureSwitch: state.setFeatureSwitch,
  setPracticeMode: state.setPracticeMode,
}));
vi.mock("@/modules/whatsapp/data/hub-templates", () => ({ submitHubTemplateSet: state.submitHubTemplateSet, syncHubTemplates: vi.fn() }));
vi.mock("@/modules/whatsapp/data/whatsapp-source-sync", () => ({ syncSettledToSource: vi.fn() }));

import * as actions from "@/app/(app)/settings/whatsapp/actions";

const { setFeatureAction, setPracticeModeAction, submitHubTemplatesAction } = actions;

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
  state.submitHubTemplateSet.mockClear();
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

describe("Settings → WhatsApp and the hub's templates (D-566)", () => {
  it("has no way to mark a template approved by hand: only the hub's list does that", () => {
    expect(Object.keys(actions)).not.toContain("markTemplateAction");
  });

  it("an admin sends the _v8 set for approval and is told how many went", async () => {
    const to = await landing(submitHubTemplatesAction());
    expect(to).toBe("/settings/whatsapp?note=hub_sent&sent=22&skipped=0&failed=0#hub");
    expect(state.submitHubTemplateSet).toHaveBeenCalledWith({ staffId: "staff-qa" });
    expect(noteFor("hub_sent", { sent: "22", failed: "0" })?.text.en).toBe("Sent 22 to Meta for approval. Approval shows here as soon as it comes.");
  });

  it("a practice account cannot send the school's templates to Meta", async () => {
    state.testAccount = true;
    const to = await landing(submitHubTemplatesAction());
    expect(to).toBe("/settings/whatsapp?note=hub_locked&why=test#hub");
    expect(state.submitHubTemplateSet).not.toHaveBeenCalled();
  });

  it("says what went wrong when the hub refuses, in both languages", () => {
    const note = noteFor("hub_bad", { why: "The hub refused One's key." });
    expect(note?.tone).toBe("bad");
    expect(note?.text.en).toMatch(/refused One's key/);
    expect(note?.text.hi).toMatch(/refused One's key/);
    expect(noteFor("hub_sent", { sent: "20", failed: "2", why: "bad" })?.tone).toBe("warn");
  });
});
