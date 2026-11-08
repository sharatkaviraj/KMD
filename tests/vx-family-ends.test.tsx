// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "@/platform/i18n/use-language";
import type { FamilyPreview } from "@/platform/fees-bridge/family-command-contracts";
import type { BridgeFamilyChild, BridgeFamilyGroup } from "@/platform/fees-bridge/screen-read-contracts";

import { render, screen, userEvent, waitFor } from "./support/dom-testing-lite";

/*
 * Taking the second-last child out of a family deletes the family (D-561).
 * The save re-renders the family page without it before the answer reaches
 * the sheet, and the page used to swap itself for "This family was not
 * found", taking the sheet with it (live, 8 Nov 2026). The page must hold the
 * family while a change it started is saving, let the sheet say "This family
 * has ended", and land on the families list. Test names and ids only.
 */

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", async (original) => ({ ...((await original()) as Record<string, unknown>), useRouter: () => router }));
vi.mock("@/ui/feedback/cue", () => ({ cue: () => {} }));

const actions = vi.hoisted(() => ({
  preview: vi.fn(),
  save: vi.fn(),
  find: vi.fn(async () => ({ ok: true, children: [] as Array<{ id: string; name: string; classLabel: string; hasPhoto: boolean }> })),
}));
vi.mock("@/app/(app)/families/actions", () => ({
  previewFamilyChangeAction: actions.preview,
  saveFamilyChangeAction: actions.save,
  findFamilyChildrenAction: actions.find,
}));

import { FamilyScreen } from "@/vx/screens/families/family-screen";

const G = "eeeeeeee-0000-4000-8000-0000000000aa";
const [A, B] = ["00000001-0000-4000-8000-000000000001", "00000002-0000-4000-8000-000000000002"];

const child = (id: string, name: string): BridgeFamilyChild => ({
  studentId: id, fullName: name, admissionNo: `TEST-${id.slice(7, 8)}`, classLabel: "Class 5 A", status: "active",
  fatherName: "Test Father", motherName: null, fatherPhone: null, motherPhone: null, villageCity: null,
  hasPhoto: false, siblingOrder: null, thirdChildCandidate: false, money: null,
});
const family: BridgeFamilyGroup = { groupId: G, label: "", guardianName: null, guardianPhone: null, children: [child(A, "Test Asha"), child(B, "Test Bina")] };

const preview: FamilyPreview = {
  sessionLabel: "TEST-2026-27",
  operation: "unlink",
  studentIds: [B],
  familyGroupId: G,
  expectedMemberIds: [A, B],
  familiesNow: 1,
  children: [A, B].map((studentId, i) => ({
    studentId, fullName: i ? "Test Bina" : "Test Asha", admissionNo: `TEST-${i}`, classLabel: "Class 5 A", status: "active",
    inThisYear: true, hasPhoto: false, familyGroupId: G, staffChild: false, thirdChildNow: false, baseTuition: null, money: null,
  })),
  after: { family: [], alone: [A, B] },
  thirdChild: { policyConfigured: true, eligibleCount: 0, recipientAfter: null, outrankedByStaffChildStudentId: null, recipientTuition: null, gains: [], loses: [] },
};

// The server side of the page: what the families list says after each render.
const server = { setFamilies: (next: BridgeFamilyGroup[]): void => void next };
function Page() {
  const [families, set] = useState<BridgeFamilyGroup[]>([family]);
  useEffect(() => {
    server.setFamilies = set;
  }, []);
  return (
    <LanguageProvider language="en">
      <FamilyScreen groupId={G} sessionLabel="TEST-2026-27" asOf={null} test families={families} canCollect={false} canOpenChildren={false} canChange />
    </LanguageProvider>
  );
}

// The shell's overlay layer, where sheets open.
beforeEach(() => {
  const layer = document.createElement("div");
  layer.id = "vx-layer";
  document.body.appendChild(layer);
});
afterEach(() => {
  vi.clearAllMocks();
  document.getElementById("vx-layer")?.remove();
});

describe("taking out the second-last child on the family page", () => {
  it("says the family has ended, not that it was not found, and goes back to the list", async () => {
    actions.preview.mockResolvedValue({ ok: true, preview });
    // As Next does: the save's answer carries the page re-rendered without the family.
    actions.save.mockImplementation(async () => {
      act(() => server.setFamilies([]));
      return { ok: true, familyGroupId: null, memberIds: [], settled: true };
    });
    render(<Page />);

    await userEvent.click(screen.getByRole("button", { name: "Take Test Bina out of this family" }));
    await userEvent.click(await screen.findByRole("button", { name: "Yes, take out" }));

    await screen.findAllByText("Done. This family has ended.");
    expect(() => screen.getByText("This family was not found")).toThrow();

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(router.push).toHaveBeenCalledWith("/families");
    await waitFor(() => screen.getByText("This family has ended"));
    expect(() => screen.getByText("This family was not found")).toThrow();
  });

  it("adding a child that folds this family into an older one keeps the sheet and lands on the joined family", async () => {
    const OLDER = "eeeeeeee-0000-4000-8000-0000000000bb";
    const C = "00000003-0000-4000-8000-000000000003";
    actions.find.mockResolvedValue({ ok: true, children: [{ id: C, name: "Test Chandu", classLabel: "Class 2 A", hasPhoto: false }] });
    actions.preview.mockResolvedValue({
      ok: true,
      preview: {
        ...preview,
        operation: "link",
        studentIds: [A, B, C],
        familyGroupId: null,
        expectedMemberIds: [A, B, C],
        familiesNow: 2,
        children: [...preview.children, { ...preview.children[0], studentId: C, fullName: "Test Chandu", familyGroupId: OLDER }],
        after: { family: [A, B, C], alone: [] },
      },
    });
    actions.save.mockImplementation(async () => {
      act(() => server.setFamilies([{ ...family, groupId: OLDER }]));
      return { ok: true, familyGroupId: OLDER, memberIds: [A, B, C], settled: true };
    });
    render(<Page />);

    await userEvent.click(screen.getByRole("button", { name: "Link another child to this family" }));
    const search = await waitFor(() => {
      const box = document.querySelector<HTMLInputElement>("#vx-layer input");
      if (!box) throw new Error("no search box");
      return box;
    });
    await userEvent.type(search, "Chandu");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Pick Test Chandu" }));
    await userEvent.click(screen.getByRole("button", { name: "Check fees" }));
    await userEvent.click(await screen.findByRole("button", { name: "Yes, link them" }));

    await screen.findAllByText("Linked! This family now has 3 children.");
    expect(() => screen.getByText("This family was not found")).toThrow();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(router.push).toHaveBeenCalledWith(`/families/${OLDER}`);
  });

  it("still says not found for a family that was never on this page's list", async () => {
    render(
      <LanguageProvider language="en">
        <FamilyScreen groupId={G} sessionLabel="TEST-2026-27" asOf={null} test families={[]} canCollect={false} canOpenChildren={false} canChange />
      </LanguageProvider>,
    );
    screen.getByText("This family was not found");
  });
});
