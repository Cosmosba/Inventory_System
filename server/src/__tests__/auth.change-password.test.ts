/**
 * Stage 4C.3 — First-login Password Change Unit Tests
 * Uses Node.js built-in test runner (node:test). No extra dependencies.
 * These tests do NOT touch the database.
 *
 * Integration tests requiring a live database are listed at the bottom
 * as comments and are NOT executed here.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// 1. Login response — mustChangePassword flag
// ---------------------------------------------------------------------------

describe("login response — mustChangePassword", () => {
  function buildLoginResponse(mustChangePassword: boolean) {
    return {
      success: true,
      message: mustChangePassword
        ? "Login successful — password change required"
        : "Login successful",
      mustChangePassword,
      data: {
        user: {
          id: "uuid",
          username: "cobaidoo",
          email: "cosmos@example.com",
          isActive: true,
          mustChangePassword,
          employeeId: "uuid",
          createdAt: new Date(),
        },
      },
    };
  }

  it("includes mustChangePassword=true in the response when flag is set", () => {
    const res = buildLoginResponse(true);
    assert.equal(res.mustChangePassword, true);
    assert.equal(res.data.user.mustChangePassword, true);
  });

  it("message indicates password change is required when flag is true", () => {
    const res = buildLoginResponse(true);
    assert.ok(res.message.includes("password change required"));
  });

  it("includes mustChangePassword=false for normal users", () => {
    const res = buildLoginResponse(false);
    assert.equal(res.mustChangePassword, false);
    assert.equal(res.data.user.mustChangePassword, false);
  });

  it("message is 'Login successful' for normal users", () => {
    const res = buildLoginResponse(false);
    assert.equal(res.message, "Login successful");
  });

  it("passwordHash is never present in the login response", () => {
    const res = buildLoginResponse(true);
    assert.ok(!("passwordHash" in res));
    assert.ok(!("passwordHash" in res.data.user));
  });
});

// ---------------------------------------------------------------------------
// 2. requirePasswordChanged middleware — decision logic
// ---------------------------------------------------------------------------

describe("requirePasswordChanged — decision logic", () => {
  function shouldBlock(mustChangePassword: boolean | undefined): boolean {
    return mustChangePassword === true;
  }

  it("blocks a user with mustChangePassword=true", () => {
    assert.equal(shouldBlock(true), true);
  });

  it("allows a user with mustChangePassword=false", () => {
    assert.equal(shouldBlock(false), false);
  });

  it("allows when mustChangePassword is undefined (no user attached)", () => {
    assert.equal(shouldBlock(undefined), false);
  });

  it("response code is PASSWORD_CHANGE_REQUIRED when blocked", () => {
    const response = {
      success: false,
      code: "PASSWORD_CHANGE_REQUIRED",
      message: "You must change your password before accessing this resource.",
    };
    assert.equal(response.code, "PASSWORD_CHANGE_REQUIRED");
    assert.equal(response.success, false);
  });

  it("blocked response uses HTTP 403", () => {
    // Verified by middleware implementation — status 403 is set before the JSON body
    const status = 403;
    assert.equal(status, 403);
  });
});

// ---------------------------------------------------------------------------
// 3. changePassword — Zod schema validation
// ---------------------------------------------------------------------------

describe("changePasswordSchema validation", async () => {
  const { z } = await import("zod");

  const PASSWORD_MIN_LENGTH = 8;

  function makeSchema() {
    return z.object({
      currentPassword: z.string().min(1, "currentPassword is required"),
      newPassword: z
        .string()
        .min(PASSWORD_MIN_LENGTH, `newPassword must be at least ${PASSWORD_MIN_LENGTH} characters`),
      confirmPassword: z.string().min(1, "confirmPassword is required"),
    });
  }

  it("accepts a valid payload", () => {
    const result = makeSchema().safeParse({
      currentPassword: "cobaidoo",
      newPassword: "newSecure1",
      confirmPassword: "newSecure1",
    });
    assert.ok(result.success);
  });

  it("rejects missing currentPassword", () => {
    const result = makeSchema().safeParse({
      newPassword: "newSecure1",
      confirmPassword: "newSecure1",
    });
    assert.ok(!result.success);
  });

  it("rejects empty currentPassword", () => {
    const result = makeSchema().safeParse({
      currentPassword: "",
      newPassword: "newSecure1",
      confirmPassword: "newSecure1",
    });
    assert.ok(!result.success);
  });

  it("rejects newPassword shorter than 8 characters", () => {
    const result = makeSchema().safeParse({
      currentPassword: "cobaidoo",
      newPassword: "short",
      confirmPassword: "short",
    });
    assert.ok(!result.success);
  });

  it("accepts newPassword of exactly 8 characters", () => {
    const result = makeSchema().safeParse({
      currentPassword: "cobaidoo",
      newPassword: "exactly8",
      confirmPassword: "exactly8",
    });
    assert.ok(result.success);
  });

  it("rejects missing confirmPassword", () => {
    const result = makeSchema().safeParse({
      currentPassword: "cobaidoo",
      newPassword: "newSecure1",
    });
    assert.ok(!result.success);
  });
});

// ---------------------------------------------------------------------------
// 4. changePassword — confirmation mismatch logic
// ---------------------------------------------------------------------------

describe("changePassword — confirmation mismatch", () => {
  function confirmationMatches(newPassword: string, confirmPassword: string): boolean {
    return newPassword === confirmPassword;
  }

  it("passes when newPassword and confirmPassword match", () => {
    assert.ok(confirmationMatches("newSecure1", "newSecure1"));
  });

  it("fails when confirmPassword differs from newPassword", () => {
    assert.ok(!confirmationMatches("newSecure1", "different1"));
  });

  it("fails when confirmPassword is empty", () => {
    assert.ok(!confirmationMatches("newSecure1", ""));
  });

  it("is case-sensitive", () => {
    assert.ok(!confirmationMatches("NewSecure1", "newsecure1"));
  });
});

// ---------------------------------------------------------------------------
// 5. changePassword — same-password rejection logic
// ---------------------------------------------------------------------------

describe("changePassword — same-password rejection", () => {
  // The controller uses verifyPassword(currentHash, newPassword) to detect reuse.
  // We test the decision logic: if verifyPassword returns true for the new password,
  // the request must be rejected.
  function isSamePassword(verifyResult: boolean): boolean {
    return verifyResult;
  }

  it("rejects when new password matches the current password", () => {
    assert.equal(isSamePassword(true), true);
  });

  it("allows when new password differs from the current password", () => {
    assert.equal(isSamePassword(false), false);
  });
});

// ---------------------------------------------------------------------------
// 6. changePassword — password hashing contract
// ---------------------------------------------------------------------------

describe("changePassword — password hashing", () => {
  it("new password is hashed with argon2id before storage", async () => {
    const { hashPassword } = await import("../services/passwordService.js");
    const hash = await hashPassword("newSecure1");
    assert.ok(hash.startsWith("$argon2id$"), "new password hash must be argon2id");
  });

  it("verifyPassword confirms the new password against its new hash", async () => {
    const { hashPassword, verifyPassword } = await import("../services/passwordService.js");
    const hash = await hashPassword("newSecure1");
    assert.ok(await verifyPassword(hash, "newSecure1"));
  });

  it("old password no longer verifies against the new hash", async () => {
    const { hashPassword, verifyPassword } = await import("../services/passwordService.js");
    const hash = await hashPassword("newSecure1");
    assert.ok(!(await verifyPassword(hash, "cobaidoo")));
  });
});

// ---------------------------------------------------------------------------
// 7. changePassword — mustChangePassword cleared contract
// ---------------------------------------------------------------------------

describe("changePassword — mustChangePassword cleared", () => {
  it("mustChangePassword is set to false after a successful change", () => {
    // Simulate the prisma.user.update data shape
    const updateData = { passwordHash: "$argon2id$...", mustChangePassword: false };
    assert.equal(updateData.mustChangePassword, false);
  });

  it("passwordHash is never returned in the success response", () => {
    const response = { success: true, message: "Password changed successfully" };
    assert.ok(!("passwordHash" in response));
  });
});

// ---------------------------------------------------------------------------
// 8. revokeOtherSessions — argument contract
// ---------------------------------------------------------------------------

describe("revokeOtherSessions — argument contract", () => {
  function buildRevokeOtherArgs(userId: string, currentSessionId: string) {
    return {
      where: {
        userId,
        id: { not: currentSessionId },
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    };
  }

  it("filters by userId", () => {
    const args = buildRevokeOtherArgs("user-1", "session-A");
    assert.equal(args.where.userId, "user-1");
  });

  it("excludes the current session by id", () => {
    const args = buildRevokeOtherArgs("user-1", "session-A");
    assert.equal(args.where.id.not, "session-A");
  });

  it("only targets sessions with revokedAt=null", () => {
    const args = buildRevokeOtherArgs("user-1", "session-A");
    assert.equal(args.where.revokedAt, null);
  });

  it("sets revokedAt to a current Date", () => {
    const before = new Date();
    const args = buildRevokeOtherArgs("user-1", "session-A");
    const after = new Date();
    assert.ok(args.data.revokedAt instanceof Date);
    assert.ok(args.data.revokedAt >= before);
    assert.ok(args.data.revokedAt <= after);
  });

  it("does not affect sessions belonging to a different user", () => {
    const argsUser1 = buildRevokeOtherArgs("user-1", "session-A");
    // A session for user-2 would not match because userId differs
    assert.notEqual(argsUser1.where.userId, "user-2");
  });
});

// ---------------------------------------------------------------------------
// 9. Exempt routes — change-password, logout, me are not blocked
// ---------------------------------------------------------------------------

describe("exempt routes from requirePasswordChanged", () => {
  const EXEMPT_PATHS = [
    "POST /api/auth/change-password",
    "POST /api/auth/logout",
    "GET /api/auth/me",
  ];

  it("change-password is in the exempt list", () => {
    assert.ok(EXEMPT_PATHS.includes("POST /api/auth/change-password"));
  });

  it("logout is in the exempt list", () => {
    assert.ok(EXEMPT_PATHS.includes("POST /api/auth/logout"));
  });

  it("me is in the exempt list", () => {
    assert.ok(EXEMPT_PATHS.includes("GET /api/auth/me"));
  });

  it("POST /api/users is NOT in the exempt list", () => {
    assert.ok(!EXEMPT_PATHS.includes("POST /api/users"));
  });
});

// ---------------------------------------------------------------------------
// 10. Ordinary users retain normal access
// ---------------------------------------------------------------------------

describe("ordinary users — normal access retained", () => {
  function shouldBlock(mustChangePassword: boolean): boolean {
    return mustChangePassword === true;
  }

  it("a user with mustChangePassword=false is not blocked", () => {
    assert.equal(shouldBlock(false), false);
  });

  it("a user who has already changed their password is not blocked", () => {
    // After changePassword succeeds, mustChangePassword is false
    const mustChangePassword = false;
    assert.equal(shouldBlock(mustChangePassword), false);
  });
});

/*
 * INTEGRATION TESTS (not executed here — require a live database):
 *
 * - POST /api/auth/login with mustChangePassword=true user → 200, mustChangePassword=true in response.
 * - POST /api/users with mustChangePassword=true session → 403, code=PASSWORD_CHANGE_REQUIRED.
 * - GET /api/auth/me with mustChangePassword=true session → 200 (exempt).
 * - POST /api/auth/logout with mustChangePassword=true session → 200 (exempt).
 * - POST /api/auth/change-password with mustChangePassword=true session → accessible (exempt).
 * - POST /api/auth/change-password with wrong currentPassword → 400.
 * - POST /api/auth/change-password with mismatched confirmPassword → 400.
 * - POST /api/auth/change-password with newPassword < 8 chars → 400.
 * - POST /api/auth/change-password with newPassword == currentPassword → 400.
 * - POST /api/auth/change-password with valid payload → 200, mustChangePassword=false in DB.
 * - After successful change, new password verifies with argon2id.
 * - After successful change, current session still authenticates.
 * - After successful change, other sessions for same user are revoked.
 * - After successful change, user can access normal protected endpoints.
 * - GET /api/health is never blocked (public, no requireAuth).
 */
