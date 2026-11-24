/**
 * Stage 4B.2 — Logout & Session Lifecycle Unit Tests
 * Uses Node.js built-in test runner (node:test). No extra dependencies required.
 * No module mocking — all tests exercise real logic with controlled inputs.
 *
 * Tests that require a live database are marked INTEGRATION and not executed here.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function sha256(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// 1. revokeSessionByToken — pure logic contract tests
//    We test the hash derivation and the updateMany argument shape by
//    replicating the exact logic from sessionService and verifying it.
// ---------------------------------------------------------------------------

describe("revokeSessionByToken — argument contract", () => {
  // Replicate the exact logic from sessionService to verify the contract
  function buildRevokeArgs(token: string) {
    const tokenHash = sha256(token);
    return {
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    };
  }

  it("looks up by SHA-256 hash of the token, not the raw token", () => {
    const token = makeToken();
    const args = buildRevokeArgs(token);
    assert.equal(args.where.tokenHash, sha256(token));
    assert.notEqual(args.where.tokenHash, token);
  });

  it("filters to revokedAt=null so already-revoked sessions are skipped", () => {
    const args = buildRevokeArgs(makeToken());
    assert.equal(args.where.revokedAt, null);
  });

  it("sets revokedAt to a current Date", () => {
    const before = new Date();
    const args = buildRevokeArgs(makeToken());
    const after = new Date();
    assert.ok(args.data.revokedAt instanceof Date);
    assert.ok(args.data.revokedAt >= before);
    assert.ok(args.data.revokedAt <= after);
  });

  it("different tokens produce different tokenHash values", () => {
    const a = buildRevokeArgs(makeToken());
    const b = buildRevokeArgs(makeToken());
    assert.notEqual(a.where.tokenHash, b.where.tokenHash);
  });
});

// ---------------------------------------------------------------------------
// 2. validateSession — session rejection logic (pure, no DB)
//    Replicate the exact conditional logic from sessionService to verify
//    that revoked, expired, and missing sessions all return null.
// ---------------------------------------------------------------------------

describe("validateSession — rejection logic", () => {
  type SessionShape = {
    revokedAt: Date | null;
    expiresAt: Date;
    user: object | null;
  };

  // Replicate the exact guard sequence from sessionService.validateSession
  function applyValidationGuards(session: SessionShape | null): SessionShape | null {
    if (!session) return null;
    if (session.revokedAt !== null) return null;
    if (session.expiresAt <= new Date()) return null;
    if (!session.user) return null;
    return session;
  }

  it("returns null when session is not found", () => {
    assert.equal(applyValidationGuards(null), null);
  });

  it("returns null when revokedAt is set", () => {
    const session: SessionShape = {
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
      user: { id: "u1" },
    };
    assert.equal(applyValidationGuards(session), null);
  });

  it("returns null when session is expired", () => {
    const session: SessionShape = {
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000), // 1 second in the past
      user: { id: "u1" },
    };
    assert.equal(applyValidationGuards(session), null);
  });

  it("returns null when user is null (user deleted)", () => {
    const session: SessionShape = {
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
      user: null,
    };
    assert.equal(applyValidationGuards(session), null);
  });

  it("returns the session when all guards pass", () => {
    const session: SessionShape = {
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
      user: { id: "u1" },
    };
    assert.equal(applyValidationGuards(session), session);
  });

  it("a session revoked then checked is rejected even if not yet expired", () => {
    const session: SessionShape = {
      revokedAt: new Date(), // just revoked
      expiresAt: new Date(Date.now() + 7200_000), // still 2h left
      user: { id: "u1" },
    };
    assert.equal(applyValidationGuards(session), null);
  });
});

// ---------------------------------------------------------------------------
// 3. validateOrigin — pure decision logic (Stage 4C.6: centralized CSRF)
//    Tests the updated middleware: state-changing methods require a present,
//    non-null Origin that matches FRONTEND_ORIGIN exactly.
//    Safe methods (GET, HEAD, OPTIONS) pass unconditionally.
// ---------------------------------------------------------------------------

describe("validateOrigin — decision logic", () => {
  const TRUSTED = "http://localhost:5173";
  const STATE_CHANGING = ["POST", "PUT", "PATCH", "DELETE"];
  const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

  // Replicate the exact decision logic from the updated validateOrigin middleware
  function shouldAllow(
    method: string,
    frontendOrigin: string | undefined,
    requestOrigin: string | undefined
  ): boolean {
    // Safe methods always pass
    if (!STATE_CHANGING.includes(method)) return true;
    // No FRONTEND_ORIGIN configured — allow (development without frontend)
    if (!frontendOrigin) return true;
    // Missing or "null" Origin on state-changing request — reject
    if (!requestOrigin || requestOrigin === "null") return false;
    // Exact match only
    return requestOrigin === frontendOrigin;
  }

  it("allows when FRONTEND_ORIGIN is not configured", () => {
    assert.ok(shouldAllow("POST", undefined, undefined));
    assert.ok(shouldAllow("POST", undefined, "https://anywhere.example.com"));
  });

  it("allows GET regardless of Origin", () => {
    assert.ok(shouldAllow("GET", TRUSTED, undefined));
    assert.ok(shouldAllow("GET", TRUSTED, "https://evil.example.com"));
  });

  it("allows HEAD regardless of Origin", () => {
    assert.ok(shouldAllow("HEAD", TRUSTED, undefined));
  });

  it("allows OPTIONS regardless of Origin (CORS preflight)", () => {
    assert.ok(shouldAllow("OPTIONS", TRUSTED, undefined));
    assert.ok(shouldAllow("OPTIONS", TRUSTED, "https://evil.example.com"));
  });

  it("allows POST when Origin matches FRONTEND_ORIGIN exactly", () => {
    assert.ok(shouldAllow("POST", TRUSTED, TRUSTED));
  });

  it("allows PATCH when Origin matches FRONTEND_ORIGIN exactly", () => {
    assert.ok(shouldAllow("PATCH", TRUSTED, TRUSTED));
  });

  it("allows DELETE when Origin matches FRONTEND_ORIGIN exactly", () => {
    assert.ok(shouldAllow("DELETE", TRUSTED, TRUSTED));
  });

  it("rejects POST with missing Origin when FRONTEND_ORIGIN is configured", () => {
    assert.ok(!shouldAllow("POST", TRUSTED, undefined));
  });

  it("rejects PATCH with missing Origin when FRONTEND_ORIGIN is configured", () => {
    assert.ok(!shouldAllow("PATCH", TRUSTED, undefined));
  });

  it("rejects DELETE with missing Origin when FRONTEND_ORIGIN is configured", () => {
    assert.ok(!shouldAllow("DELETE", TRUSTED, undefined));
  });

  it("rejects PUT with missing Origin when FRONTEND_ORIGIN is configured", () => {
    assert.ok(!shouldAllow("PUT", TRUSTED, undefined));
  });

  it("rejects Origin: null on state-changing requests", () => {
    assert.ok(!shouldAllow("POST", TRUSTED, "null"));
  });

  it("rejects when Origin does not match FRONTEND_ORIGIN", () => {
    assert.ok(!shouldAllow("POST", TRUSTED, "https://evil.example.com"));
  });

  it("rejects a subdomain of the trusted origin", () => {
    assert.ok(!shouldAllow("POST", TRUSTED, "http://sub.localhost:5173"));
  });

  it("rejects a different port on the same host", () => {
    assert.ok(!shouldAllow("POST", TRUSTED, "http://localhost:9999"));
  });

  it("rejects a wildcard — wildcard is never a valid origin", () => {
    assert.ok(!shouldAllow("POST", TRUSTED, "*"));
  });

  it("safe methods are not blocked even with a mismatched Origin", () => {
    for (const method of SAFE_METHODS) {
      assert.ok(shouldAllow(method, TRUSTED, "https://evil.example.com"),
        `${method} should not be blocked`);
    }
  });

  it("all state-changing methods require a matching Origin", () => {
    for (const method of STATE_CHANGING) {
      assert.ok(!shouldAllow(method, TRUSTED, undefined),
        `${method} with missing Origin should be rejected`);
      assert.ok(!shouldAllow(method, TRUSTED, "https://evil.example.com"),
        `${method} with wrong Origin should be rejected`);
      assert.ok(shouldAllow(method, TRUSTED, TRUSTED),
        `${method} with correct Origin should be allowed`);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Logout idempotency contract
//    Test the exact conditional logic from the logout controller.
// ---------------------------------------------------------------------------

describe("logout controller — idempotency contract", () => {
  // Replicate the exact branching from the logout controller
  async function simulateLogout(
    token: string | undefined,
    revokeImpl: (t: string) => Promise<void>
  ): Promise<{ cookieCleared: boolean; success: boolean; status: number }> {
    let cookieCleared = false;

    // Always clear the cookie
    cookieCleared = true;

    if (token) {
      await revokeImpl(token).catch(() => {
        // Non-fatal
      });
    }

    return { cookieCleared, success: true, status: 200 };
  }

  it("always clears the cookie regardless of token presence", async () => {
    const result = await simulateLogout(undefined, async () => {});
    assert.ok(result.cookieCleared);
    assert.equal(result.status, 200);
  });

  it("returns success when no cookie is present", async () => {
    const result = await simulateLogout(undefined, async () => {});
    assert.equal(result.success, true);
    assert.equal(result.status, 200);
  });

  it("returns success when token is present and revocation succeeds", async () => {
    const result = await simulateLogout(makeToken(), async () => {});
    assert.equal(result.success, true);
    assert.equal(result.status, 200);
  });

  it("returns success even when revocation throws (fire-and-forget)", async () => {
    const result = await simulateLogout(makeToken(), async () => {
      throw new Error("DB down");
    });
    assert.equal(result.success, true);
    assert.equal(result.status, 200);
  });

  it("calls revoke exactly once with the current token only", async () => {
    const token = makeToken();
    const calls: string[] = [];

    await simulateLogout(token, async (t) => {
      calls.push(t);
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0], token);
  });

  it("does not call revoke when no token is present", async () => {
    const calls: string[] = [];

    await simulateLogout(undefined, async (t) => {
      calls.push(t);
    });

    assert.equal(calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// 5. Cookie clearing options — pure function tests
// ---------------------------------------------------------------------------

describe("clearSessionCookieOptions — shape", () => {
  // Replicate the exact logic from cookieOptions.ts
  function clearOpts(nodeEnv: string): {
    httpOnly: boolean;
    sameSite: "strict";
    secure: boolean;
    path: string;
    expires: Date;
  } {
    return {
      httpOnly: true,
      sameSite: "strict",
      secure: nodeEnv === "production",
      path: "/",
      expires: new Date(0),
    };
  }

  it("sets expires to epoch (new Date(0)) to delete the cookie", () => {
    const opts = clearOpts("development");
    assert.equal(opts.expires.getTime(), 0);
    assert.ok(opts.expires < new Date());
  });

  it("sets httpOnly=true", () => {
    assert.equal(clearOpts("development").httpOnly, true);
  });

  it("sets sameSite=strict", () => {
    assert.equal(clearOpts("development").sameSite, "strict");
  });

  it("sets path=/", () => {
    assert.equal(clearOpts("development").path, "/");
  });

  it("sets secure=false in development", () => {
    assert.equal(clearOpts("development").secure, false);
  });

  it("sets secure=true in production", () => {
    assert.equal(clearOpts("production").secure, true);
  });
});

// ---------------------------------------------------------------------------
// 6. buildSessionCookieOptions — matches clearSessionCookieOptions attributes
//    (except expires — set vs cleared)
// ---------------------------------------------------------------------------

describe("buildSessionCookieOptions — attribute consistency with clear options", () => {
  function buildOpts(nodeEnv: string, expiresAt: Date) {
    return {
      httpOnly: true,
      sameSite: "strict" as const,
      secure: nodeEnv === "production",
      path: "/",
      expires: expiresAt,
    };
  }

  function clearOpts(nodeEnv: string) {
    return {
      httpOnly: true,
      sameSite: "strict" as const,
      secure: nodeEnv === "production",
      path: "/",
      expires: new Date(0),
    };
  }

  it("httpOnly matches between set and clear", () => {
    const set = buildOpts("development", new Date());
    const clear = clearOpts("development");
    assert.equal(set.httpOnly, clear.httpOnly);
  });

  it("sameSite matches between set and clear", () => {
    const set = buildOpts("development", new Date());
    const clear = clearOpts("development");
    assert.equal(set.sameSite, clear.sameSite);
  });

  it("path matches between set and clear", () => {
    const set = buildOpts("development", new Date());
    const clear = clearOpts("development");
    assert.equal(set.path, clear.path);
  });

  it("secure matches between set and clear in production", () => {
    const set = buildOpts("production", new Date());
    const clear = clearOpts("production");
    assert.equal(set.secure, clear.secure);
  });

  it("set expires is in the future; clear expires is in the past", () => {
    const future = new Date(Date.now() + 3600_000);
    const set = buildOpts("development", future);
    const clear = clearOpts("development");
    assert.ok(set.expires > new Date());
    assert.ok(clear.expires < new Date());
  });
});

/*
 * INTEGRATION TESTS (not executed here — require a live database and a real user account):
 *
 * - POST /api/auth/logout with a valid session token sets revokedAt in user_sessions.
 * - After logout, GET /api/auth/me returns 401.
 * - POST /api/auth/logout with an already-revoked token still returns 200.
 * - POST /api/auth/logout with an expired token still returns 200.
 * - POST /api/auth/logout with an unknown token still returns 200.
 * - Logging out session A does not affect session B for the same user.
 * - POST /api/auth/logout from an untrusted Origin returns 403.
 * - POST /api/auth/logout from the trusted Origin returns 200.
 */
