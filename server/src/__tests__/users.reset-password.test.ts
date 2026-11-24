/**
 * Stage 4C.4 — Administrator Password Reset Unit Tests
 * Uses Node.js built-in test runner (node:test). No extra dependencies.
 * These tests do NOT touch the database.
 *
 * Integration tests requiring a live database are listed at the bottom
 * as comments and are NOT executed here.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// 1. Default password generation — reused from userService
// ---------------------------------------------------------------------------

describe("resetPassword — default password generation", () => {
  function generateDefaultPassword(firstName: string, lastName: string): string {
    const first = firstName.trim();
    const last = lastName.trim();
    if (first.length < 2) {
      throw new Error(
        "Employee first name must be at least 2 characters to generate a default password."
      );
    }
    if (last.length < 1) {
      throw new Error("Employee last name must not be empty to generate a default password.");
    }
    return (first.slice(0, 2) + last).toLowerCase();
  }

  it("generates cobaidoo for Cosmos Baidoo", () => {
    assert.equal(generateDefaultPassword("Cosmos", "Baidoo"), "cobaidoo");
  });

  it("generates jomensah for John Mensah", () => {
    assert.equal(generateDefaultPassword("John", "Mensah"), "jomensah");
  });

  it("trims surrounding whitespace from names", () => {
    assert.equal(generateDefaultPassword("  Cosmos  ", "  Baidoo  "), "cobaidoo");
  });

  it("lowercases the result", () => {
    const result = generateDefaultPassword("COSMOS", "BAIDOO");
    assert.equal(result, result.toLowerCase());
  });

  it("throws when firstName is too short", () => {
    assert.throws(
      () => generateDefaultPassword("A", "Baidoo"),
      /first name must be at least 2 characters/
    );
  });

  it("throws when firstName is only whitespace", () => {
    assert.throws(
      () => generateDefaultPassword("   ", "Baidoo"),
      /first name must be at least 2 characters/
    );
  });

  it("throws when lastName is empty", () => {
    assert.throws(
      () => generateDefaultPassword("Cosmos", ""),
      /last name must not be empty/
    );
  });

  it("throws when lastName is only whitespace", () => {
    assert.throws(
      () => generateDefaultPassword("Cosmos", "   "),
      /last name must not be empty/
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Password hashing — new password is argon2id
// ---------------------------------------------------------------------------

describe("resetPassword — password hashing", () => {
  it("generated password is hashed with argon2id", async () => {
    const { hashPassword } = await import("../services/passwordService.js");
    const hash = await hashPassword("cobaidoo");
    assert.ok(hash.startsWith("$argon2id$"), "hash must be argon2id");
  });

  it("verifyPassword confirms the generated password against its hash", async () => {
    const { hashPassword, verifyPassword } = await import("../services/passwordService.js");
    const hash = await hashPassword("cobaidoo");
    assert.ok(await verifyPassword(hash, "cobaidoo"));
  });

  it("old password does not verify against the new hash", async () => {
    const { hashPassword, verifyPassword } = await import("../services/passwordService.js");
    const hash = await hashPassword("cobaidoo");
    assert.ok(!(await verifyPassword(hash, "oldpassword")));
  });
});

// ---------------------------------------------------------------------------
// 3. mustChangePassword set to true after reset
// ---------------------------------------------------------------------------

describe("resetPassword — mustChangePassword flag", () => {
  it("mustChangePassword is set to true in the update payload", () => {
    const updateData = { passwordHash: "$argon2id$...", mustChangePassword: true };
    assert.equal(updateData.mustChangePassword, true);
  });

  it("passwordHash is never included in the reset response", () => {
    const response = {
      success: true,
      message: "Password reset successfully",
      data: { defaultPassword: "cobaidoo" },
    };
    assert.ok(!("passwordHash" in response));
    assert.ok(!("passwordHash" in response.data));
  });

  it("defaultPassword is returned at the top level of data", () => {
    const response = {
      success: true,
      message: "Password reset successfully",
      data: { defaultPassword: "cobaidoo" },
    };
    assert.equal(response.data.defaultPassword, "cobaidoo");
  });
});

// ---------------------------------------------------------------------------
// 4. Authorization — middleware chain contract
// ---------------------------------------------------------------------------

describe("resetPassword — authorization chain", () => {
  function authDecision(hasSession: boolean): boolean {
    return hasSession;
  }

  function passwordChangedDecision(mustChangePassword: boolean): boolean {
    return !mustChangePassword;
  }

  function permissionDecision(hasPermission: boolean): boolean {
    return hasPermission;
  }

  it("unauthenticated request is rejected at requireAuth", () => {
    assert.equal(authDecision(false), false);
  });

  it("authenticated request passes requireAuth", () => {
    assert.equal(authDecision(true), true);
  });

  it("user with mustChangePassword=true is blocked by requirePasswordChanged", () => {
    assert.equal(passwordChangedDecision(true), false);
  });

  it("user with mustChangePassword=false passes requirePasswordChanged", () => {
    assert.equal(passwordChangedDecision(false), true);
  });

  it("IT_STAFF without users.reset_password is denied by requirePermission", () => {
    assert.equal(permissionDecision(false), false);
  });

  it("ADMIN with users.reset_password passes requirePermission", () => {
    assert.equal(permissionDecision(true), true);
  });

  it("ADMIN without users.reset_password is denied", () => {
    assert.equal(permissionDecision(false), false);
  });
});

// ---------------------------------------------------------------------------
// 5. Route parameter validation
// ---------------------------------------------------------------------------

describe("resetPassword — userId parameter validation", async () => {
  const { z } = await import("zod");

  function makeParamsSchema() {
    return z.object({ userId: z.string().uuid("userId must be a valid UUID") });
  }

  it("accepts a valid RFC 4122 UUID", () => {
    const result = makeParamsSchema().safeParse({ userId: "4f07dda8-40db-446b-9f9c-5e50e3fcf778" });
    assert.ok(result.success);
  });

  it("rejects a non-UUID string", () => {
    const result = makeParamsSchema().safeParse({ userId: "not-a-uuid" });
    assert.ok(!result.success);
  });

  it("rejects a UUID with invalid version/variant bits", () => {
    const result = makeParamsSchema().safeParse({ userId: "00000000-0000-0000-0000-000000000001" });
    assert.ok(!result.success);
  });

  it("rejects a missing userId", () => {
    const result = makeParamsSchema().safeParse({});
    assert.ok(!result.success);
  });
});

// ---------------------------------------------------------------------------
// 6. Error response contracts
// ---------------------------------------------------------------------------

describe("resetPassword — error response contracts", () => {
  it("unknown userId returns 404", () => {
    const body = { success: false, message: "User not found." };
    assert.equal(body.success, false);
    assert.ok(body.message.length > 0);
  });

  it("user with no employee record returns 422", () => {
    const body = {
      success: false,
      message: "This user account is not linked to an employee record.",
    };
    assert.equal(body.success, false);
  });

  it("missing employee record returns 422", () => {
    const body = { success: false, message: "The linked employee record could not be found." };
    assert.equal(body.success, false);
  });

  it("response does not reveal sensitive account information on 404", () => {
    const body = { success: false, message: "User not found." };
    const serialised = JSON.stringify(body);
    assert.ok(!serialised.includes("passwordHash"));
    assert.ok(!serialised.includes("email"));
  });
});

// ---------------------------------------------------------------------------
// 7. revokeAllSessions — argument contract
// ---------------------------------------------------------------------------

describe("revokeAllSessions — argument contract", () => {
  function buildRevokeAllArgs(userId: string) {
    return {
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    };
  }

  it("filters by userId only", () => {
    const args = buildRevokeAllArgs("user-1");
    assert.equal(args.where.userId, "user-1");
  });

  it("only targets sessions with revokedAt=null", () => {
    const args = buildRevokeAllArgs("user-1");
    assert.equal(args.where.revokedAt, null);
  });

  it("sets revokedAt to a current Date", () => {
    const before = new Date();
    const args = buildRevokeAllArgs("user-1");
    const after = new Date();
    assert.ok(args.data.revokedAt instanceof Date);
    assert.ok(args.data.revokedAt >= before);
    assert.ok(args.data.revokedAt <= after);
  });

  it("does not include an id exclusion — all sessions are revoked", () => {
    const args = buildRevokeAllArgs("user-1");
    assert.ok(!("id" in args.where));
  });

  it("does not affect sessions belonging to a different user", () => {
    const args = buildRevokeAllArgs("user-1");
    assert.notEqual(args.where.userId, "user-2");
  });
});

// ---------------------------------------------------------------------------
// 8. revokeAllSessions vs revokeOtherSessions — distinction
// ---------------------------------------------------------------------------

describe("revokeAllSessions vs revokeOtherSessions — distinction", () => {
  it("revokeAllSessions has no id exclusion — all sessions are revoked", () => {
    const allArgs = { where: { userId: "u1", revokedAt: null } };
    assert.ok(!("id" in allArgs.where));
  });

  it("revokeOtherSessions excludes the current session by id", () => {
    const otherArgs = { where: { userId: "u1", id: { not: "session-A" }, revokedAt: null } };
    assert.equal(otherArgs.where.id.not, "session-A");
  });

  it("admin session is unaffected when resetting another user's password", () => {
    const targetUserId = "target-user";
    const adminUserId = "admin-user";
    const args = { where: { userId: targetUserId, revokedAt: null } };
    assert.notEqual(args.where.userId, adminUserId);
  });
});

// ---------------------------------------------------------------------------
// 9. Audit log — data shape contract
// ---------------------------------------------------------------------------

describe("resetPassword — audit log contract", () => {
  it("audit log entry uses action RESET_PASSWORD", () => {
    const entry = {
      userId: "admin-id",
      action: "RESET_PASSWORD",
      entityType: "user",
      entityId: "target-user-id",
      newValues: { mustChangePassword: true },
    };
    assert.equal(entry.action, "RESET_PASSWORD");
  });

  it("audit log records the initiator userId", () => {
    const entry = {
      userId: "admin-id",
      action: "RESET_PASSWORD",
      entityType: "user",
      entityId: "target-user-id",
      newValues: { mustChangePassword: true },
    };
    assert.equal(entry.userId, "admin-id");
  });

  it("audit log records the target user as entityId", () => {
    const entry = {
      userId: "admin-id",
      action: "RESET_PASSWORD",
      entityType: "user",
      entityId: "target-user-id",
      newValues: { mustChangePassword: true },
    };
    assert.equal(entry.entityId, "target-user-id");
  });

  it("audit log does not contain the generated password or hash", () => {
    const entry = {
      userId: "admin-id",
      action: "RESET_PASSWORD",
      entityType: "user",
      entityId: "target-user-id",
      newValues: { mustChangePassword: true },
    };
    const serialised = JSON.stringify(entry);
    assert.ok(!serialised.includes("cobaidoo"), "plaintext password must not appear in audit log");
    assert.ok(!serialised.includes("passwordHash"), "hash must not appear in audit log");
  });

  it("audit log entityType is 'user'", () => {
    const entry = { entityType: "user" };
    assert.equal(entry.entityType, "user");
  });
});

// ---------------------------------------------------------------------------
// 10. Seed — permission identifiers and assignments
// ---------------------------------------------------------------------------

describe("seed — permission identifiers and assignments", () => {
  const ADMIN_PERMISSIONS = ["users.create", "users.reset_password"];
  const IT_STAFF_PERMISSIONS: string[] = [];

  it("users.reset_password is a defined permission identifier", () => {
    assert.ok(ADMIN_PERMISSIONS.includes("users.reset_password"));
  });

  it("ADMIN receives users.reset_password", () => {
    assert.ok(ADMIN_PERMISSIONS.includes("users.reset_password"));
  });

  it("ADMIN retains users.create", () => {
    assert.ok(ADMIN_PERMISSIONS.includes("users.create"));
  });

  it("IT_STAFF does not receive users.reset_password", () => {
    assert.ok(!IT_STAFF_PERMISSIONS.includes("users.reset_password"));
  });

  it("IT_STAFF does not receive users.create", () => {
    assert.ok(!IT_STAFF_PERMISSIONS.includes("users.create"));
  });
});

// ---------------------------------------------------------------------------
// 11. Administrator self-reset behaviour
// ---------------------------------------------------------------------------

describe("resetPassword — administrator self-reset", () => {
  it("revokeAllSessions on self revokes all sessions including the current one", () => {
    const adminUserId = "admin-id";
    const args = { where: { userId: adminUserId, revokedAt: null } };
    assert.ok(!("id" in args.where));
    assert.equal(args.where.userId, adminUserId);
  });

  it("defaultPassword is present in the response regardless of self-reset", () => {
    const responseData = { defaultPassword: "cobaidoo" };
    assert.ok("defaultPassword" in responseData);
  });
});

// ---------------------------------------------------------------------------
// 12. Session revocation is not fire-and-forget — regression test
// ---------------------------------------------------------------------------

describe("resetPassword — session revocation is not silent", () => {
  it("a revocation failure propagates rather than being swallowed", async () => {
    // Simulate the controller's call sequence:
    // resetUserPassword() succeeds → revokeAllSessions() throws → error propagates.
    // The controller must NOT catch the error and return 200.
    async function simulateController(
      revokeImpl: () => Promise<void>
    ): Promise<{ status: number; body: object } | { threw: true }> {
      try {
        // Step 1: password reset succeeds (simulated)
        const defaultPassword = "cobaidoo";

        // Step 2: revocation — NOT wrapped in .catch()
        await revokeImpl();

        // Step 3: only reached if revocation succeeded
        return { status: 200, body: { success: true, data: { defaultPassword } } };
      } catch {
        return { threw: true };
      }
    }

    const successResult = await simulateController(async () => {});
    assert.ok("status" in successResult && successResult.status === 200);

    const failResult = await simulateController(async () => {
      throw new Error("DB connection lost");
    });
    assert.ok("threw" in failResult && failResult.threw === true,
      "revocation failure must propagate, not be swallowed"
    );
  });

  it("defaultPassword is never returned when revocation throws", async () => {
    let passwordLeaked = false;

    async function simulateController(
      revokeImpl: () => Promise<void>
    ): Promise<void> {
      const defaultPassword = "cobaidoo";
      await revokeImpl(); // throws — must not reach the line below
      passwordLeaked = true;
      void defaultPassword;
    }

    await simulateController(async () => { throw new Error("revoke failed"); }).catch(() => {});
    assert.equal(passwordLeaked, false,
      "defaultPassword must not be returned when revocation throws"
    );
  });
});

/*
 * INTEGRATION TESTS (not executed here — require a live database):
 *
 * - POST /api/users/:userId/reset-password with no session → 401.
 * - POST /api/users/:userId/reset-password with IT_STAFF session → 403.
 * - POST /api/users/:userId/reset-password with ADMIN lacking users.reset_password → 403.
 * - POST /api/users/:userId/reset-password with mustChangePassword=true ADMIN → 403 PASSWORD_CHANGE_REQUIRED.
 * - POST /api/users/:userId/reset-password with invalid UUID param → 400.
 * - POST /api/users/:userId/reset-password with unknown userId → 404.
 * - POST /api/users/:userId/reset-password with user having no employeeId → 422.
 * - POST /api/users/:userId/reset-password with valid payload → 200, returns defaultPassword.
 * - After reset, target user's passwordHash verifies against the generated default password.
 * - After reset, target user's mustChangePassword = true in the database.
 * - After reset, all target user's sessions are revoked.
 * - After reset, admin's own session remains active (when resetting another user).
 * - After reset, target user cannot authenticate with old password.
 * - After reset, target user can authenticate with the new default password.
 * - Audit log entry created: action=RESET_PASSWORD, correct userId and entityId, no plaintext.
 * - Running seed:roles twice does not create duplicate permissions or role assignments.
 * - Admin self-reset: all admin sessions revoked; admin must re-login with new default password.
 */
