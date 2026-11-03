import { describe, expect, it } from "vitest";

import { appliedConcessions } from "@/vx/screens/admin/student360-source";
import { photoFileName, zoomAt } from "@/vx/ui/photo-viewer";

// Synthetic fee settings only.
const base = {
  studentTypeOverride: null, studentStatusLabel: "Old", tuitionOverride: null, transportOverride: null,
  discountAmount: 0, lateFeeWaiverAmount: 0, otherAdjustmentHead: null, otherAdjustmentAmount: null,
  overrideReason: null, overrideNotes: null, conventionalDiscountPolicyIds: [], conventionalDiscountLabels: [],
  conventionalDiscountReason: null, conventionalDiscountNotes: null, conventionalDiscountFamilyGroupLabel: null,
  conventionalDiscountFamilyGroupId: null, conventionalDiscountManualOverrideReason: null,
  tuitionBeforeConventionalDiscount: 12000, tuitionAfterConventionalDiscount: 12000,
};

describe("appliedConcessions (review P05)", () => {
  it("lists nothing when no setting changes the fee", () => {
    expect(appliedConcessions(base)).toEqual([]);
  });

  it("names a policy concession with its effect and reason, and each set override", () => {
    const rows = appliedConcessions({
      ...base,
      conventionalDiscountLabels: ["Synthetic Sibling Policy"], conventionalDiscountReason: "Two children enrolled", conventionalDiscountFamilyGroupLabel: "Test family",
      tuitionAfterConventionalDiscount: 10800, discountAmount: 500, transportOverride: 0, overrideReason: "Office decision",
    });
    expect(rows.map((row) => (typeof row.label === "string" ? row.label : row.label.en))).toEqual(["Synthetic Sibling Policy", "Additional discount", "Transport set specially"]);
    expect(rows[0]).toEqual(expect.objectContaining({ reason: "Two children enrolled · Test family" }));
    expect(String(rows[0].effect)).toContain("→");
    expect(rows[1].reason).toBe("Office decision");
  });

  it("keeps a zero override, which is a real setting, and skips a zero adjustment", () => {
    const rows = appliedConcessions({ ...base, tuitionOverride: 0, otherAdjustmentHead: "Books", otherAdjustmentAmount: 0 });
    expect(rows).toHaveLength(1);
  });
});

describe("photo viewer helpers (review P04)", () => {
  it("never zooms out past fit, and fit is always centred", () => {
    expect(zoomAt({ scale: 2, x: 40, y: -10 }, 0.5)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("caps zoom and keeps the point under the finger still", () => {
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 99).scale).toBe(5);
    const view = zoomAt({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: 50 });
    // The point (100, 50) maps to the same screen spot before and after.
    expect(100 * view.scale + view.x).toBeCloseTo(100 * 2 + -100);
    expect(view).toEqual({ scale: 2, x: -100, y: -50 });
  });

  it("names the saved file after the child, without path characters", () => {
    expect(photoFileName("Aarav / Test:1")).toBe("Aarav Test 1 photo.jpg");
    expect(photoFileName("   ")).toBe("student photo.jpg");
  });
});
