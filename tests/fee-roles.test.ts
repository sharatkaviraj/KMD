import { describe, expect, it } from "vitest";

import { feePermissionsFor, feeRoleFor } from "@/platform/auth/fee-roles";
import { staffRoles, type StaffRole } from "@/platform/auth/permissions";
import {
  rolePermissions as feeRolePermissions,
  staffRoles as feeStaffRoles,
  type StaffRole as FeeStaffRole,
} from "@/modules/fees/platform/roles";

/**
 * The bridge between two role vocabularies, enumerated exhaustively.
 *
 * This is the file that decides what a person may do with the school's money,
 * and it is pure — no database, no request, no framework — precisely so every
 * one of its answers can be written down here rather than discovered on a
 * Tuesday at the fee desk.
 *
 * The expectations are written out rather than derived from `feeRoleFor`. A
 * test that computes its expectation from the code it is testing proves only
 * that the code equals itself.
 */
const expectedFeeRole: Record<StaffRole, FeeStaffRole> = {
  admin: "admin",
  accountant: "accountant",
  fee_collector: "fee_collector",
  teacher: "teacher",

  // Janmejay's call: office staff post payments in the fee app today, and
  // folding that app in is the moment to stop granting the power to take money
  // by job title. Posting is now granted one person at a time, as `accountant`.
  office: "view_only",

  academic_coordinator: "view_only",
  exam_coordinator: "view_only",
  view_only: "view_only",
};

/** The fee permissions that move money, as the fee app names them. */
const MONEY_MOVING = [
  "payments:write",
  "payments:adjust",
  "payments:reverse_any",
  "payments:bulk",
  "payments:waive_late_fee",
  "fees:write",
  "fees:repayment_plan",
  "finance:write",
  "finance:approve",
] as const;

describe("the fee role bridge", () => {
  it("answers for every role this app has", () => {
    for (const role of staffRoles) {
      expect(feeRoleFor(role), `${role} has no fee role`).toBe(
        expectedFeeRole[role],
      );
    }
  });

  it("only ever answers with a role the fee app knows", () => {
    for (const role of staffRoles) {
      expect(feeStaffRoles as readonly string[]).toContain(feeRoleFor(role));
    }
  });

  it("gives every role a permission set, and never an empty one", () => {
    // An empty set would be indistinguishable from "this role fell through a
    // switch", which is the failure this whole file exists to make impossible.
    for (const role of staffRoles) {
      expect(feePermissionsFor(role).length, `${role} got no fee permissions`)
        .toBeGreaterThan(0);
    }
  });

  it("hands over the fee app's own map, unmodified", () => {
    // The fee app's permission split is the product of a year of running a fee
    // desk — which acts are admin-only, why reversing a receipt is separate
    // from adjusting a ledger. Re-deriving it here would lose all of that, so
    // this asserts it is passed through rather than rebuilt.
    for (const role of staffRoles) {
      expect(feePermissionsFor(role)).toBe(feeRolePermissions[feeRoleFor(role)]);
    }
  });

  describe("who may move money", () => {
    it("is admin and accountant, and nobody else", () => {
      const canMoveMoney = staffRoles.filter((role) =>
        feePermissionsFor(role).some((permission) =>
          (MONEY_MOVING as readonly string[]).includes(permission),
        ),
      );

      expect([...canMoveMoney].sort()).toEqual(["accountant", "admin"]);
    });

    it("does not include office", () => {
      // Called out on its own because it is the one role where this changed,
      // and where a well-meaning "restore what they had before" would put it
      // back without anybody noticing the other seven were unaffected.
      expect(feePermissionsFor("office")).not.toContain("payments:write");
    });

    it("does not include fee_collector", () => {
      // It reads every fee screen. That is the whole distinction between this
      // role and the accountant, and it is invisible in the navigation — both
      // see the same tabs.
      expect(feePermissionsFor("fee_collector")).not.toContain("payments:write");
      expect(feePermissionsFor("fee_collector")).toContain("defaulters:view");
    });
  });

  it("gives the fee desk a way to read a receipt", () => {
    // Cheap, and it would have caught a bridge that mapped every role to
    // `view_only` and still passed everything above.
    for (const role of ["admin", "accountant", "fee_collector"] as const) {
      expect(feePermissionsFor(role), role).toContain("receipts:view");
    }
  });
});
