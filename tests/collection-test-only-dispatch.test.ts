import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageSend } from "@/modules/collection/domain/messages";
import type { ParentSendGate } from "@/platform/messaging/parent-send-gate";

/**
 * Test-only parent sending (owner, 31 Oct) reaches One's own parent messages
 * too (`/collection`, `vppsone.message_sends`). The dispatcher used to stop at
 * `parent_dispatch` itself, before the gate's allowlist was ever asked, so
 * One's `_v7` notices could not be checked on the approved numbers. Now it
 * lets a test-only send through to the provider, and the parent-send gate —
 * the real `checkParentSend`, wired in below — refuses every number not in
 * `message_test_recipients`, even from a real admin in a real session.
 * Numbers here are test values (rule 6).
 */

const ALLOWLISTED = "9000000001";
const REAL_PARENT = "9876543210";

const state = vi.hoisted(() => ({
  mode: "test_only" as "on" | "test_only" | "off",
  provider: "aisensy" as string,
  row: {} as Record<string, unknown>,
  transport: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/platform/env", () => ({
  getOptionalEnvVar: (key: string) => (key === "MESSAGE_PROVIDER" ? state.provider : undefined),
  getVppsOneEnvironment: () => "dev",
  getSiteUrl: () => "https://one.example.test",
}));
vi.mock("@/platform/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/platform/auth/current-staff", () => ({ getCurrentStaff: async () => ({ userId: "qa-real-admin" }) }));
vi.mock("@/modules/teacher-tasks/data/delivery-routing", () => ({ managedTasksForRequests: async () => new Set() }));
vi.mock("@/modules/collection/data/parent-messages-repo", () => ({
  categoryFor: () => "general",
  markStale: vi.fn(),
  parentDispatchMode: async () => state.mode,
  parentDispatchSwitch: async () => state.mode === "on",
  parentPolicies: async () => [
    { category: "general", approvalRequired: false, autoRecipients: "qa", autoTrigger: "qa", autoContent: "qa", autoCorrection: "qa" },
  ],
  snapshotNow: vi.fn(),
  staleness: async () => ({ reasons: [], extras: { category: "general", snapshot: null, approved_at: null } }),
}));
// AiSensy's choke point, with the REAL gate and a reader in the shape the
// migration leaves: parent_dispatch off, test-only on, one allowlisted number.
vi.mock("@/modules/whatsapp/data/aisensy", async () => {
  const { checkParentSend } = await import("@/platform/messaging/parent-send-gate");
  return {
    sendAisensyCampaignMessage: async (args: { campaignName: string; destination: string; gate: object }) => {
      const verdict = await checkParentSend(
        { ...(args.gate as ParentSendGate), campaignName: args.campaignName, destination: args.destination },
        {
          parentDispatchOn: async () => state.mode === "on",
          parentDispatchTestOnly: async () => state.mode === "test_only",
          dispatchCategories: async () => ["general"],
          absentNoticeOwner: async () => "native",
          isTestAccount: async () => false,
          isTestRecipient: async (phone: string) => phone === `+91${ALLOWLISTED}`,
        },
        { VPPSONE_ENV: "live" },
      );
      if (!verdict.ok) return { ok: false, status: 0, error: `Not sent: ${verdict.reason}`, refused: true, refusalCode: verdict.code };
      state.transport.push(args.destination);
      return { ok: true, status: 200, messageId: "aisensy-qa" };
    },
  };
});
vi.mock("@/platform/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      let patch: Record<string, unknown> = {};
      const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      const q = {
        update(p: Record<string, unknown>) { patch = p; return q; },
        select() { return q; },
        eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
        neq(k: string, v: unknown) { filters.push((r) => r[k] !== v); return q; },
        is(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
        in(k: string, v: unknown[]) { filters.push((r) => v.includes(r[k])); return q; },
        async maybeSingle() { return { data: filters.every((f) => f(state.row)) ? { ...state.row } : null, error: null }; },
        then(resolve: (v: unknown) => void) {
          const match = filters.every((f) => f(state.row));
          if (match) Object.assign(state.row, patch);
          return Promise.resolve(resolve({ data: match ? [{ id: state.row.id }] : [], error: null }));
        },
      };
      return q;
    },
  }),
}));

import { dispatch } from "@/modules/collection/data/messages-repo";

function parentSend(toPhone: string): MessageSend {
  return {
    id: `qa-${toPhone}`, audience: "parent", status: "queued", providerMessageId: null, templateId: "qa-template",
    templateCode: "vppsone_general_v7", toPhone, toName: "QA", renderedHi: "QA", renderedEn: "QA", variables: [],
    requestId: null, taskId: null, sessionLabel: "2026-27",
  } as unknown as MessageSend;
}

beforeEach(() => {
  state.mode = "test_only";
  state.provider = "aisensy";
  state.transport = [];
});

function rowFor(send: MessageSend) {
  state.row = { id: send.id, status: "queued", provider_message_id: null, template_id: send.templateId, to_phone: send.toPhone, rendered_hi: send.renderedHi, rendered_en: send.renderedEn };
}

describe("/collection parent messages in test-only mode", () => {
  it("refuses a real parent's number, from a real admin in a real session", async () => {
    const send = parentSend(REAL_PARENT);
    rowFor(send);
    const result = await dispatch(send);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/test-only mode/);
    expect(state.transport).toEqual([]);
  });

  it("lets an allowlisted number through to AiSensy", async () => {
    const send = parentSend(ALLOWLISTED);
    rowFor(send);
    const result = await dispatch(send);
    expect(result).toEqual({ ok: true, providerMessageId: "aisensy-qa" });
    expect(state.transport).toEqual([`+91${ALLOWLISTED}`]);
  });

  it("both switches off: nothing reaches the provider, as before (D-10)", async () => {
    state.mode = "off";
    const send = parentSend(ALLOWLISTED);
    rowFor(send);
    const result = await dispatch(send);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/D-10/);
    expect(state.transport).toEqual([]);
  });

  it("test-only never goes through the mock, which no gate checks", async () => {
    state.provider = "mock";
    const send = parentSend(ALLOWLISTED);
    rowFor(send);
    const result = await dispatch(send);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/only through the AiSensy gate/);
    expect(state.row.provider_message_id).toBeNull();
  });
});
