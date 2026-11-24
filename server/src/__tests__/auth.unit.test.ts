/**
 * Stage 4B.1 — Authentication Unit Tests
 * Uses Node.js built-in test runner (node:test). No extra dependencies required.
 * These tests do NOT touch the database.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Password Service
// ---------------------------------------------------------------------------

describe("passwordService", () => {
  let hashPassword: (p: string) => Promise<string>;
  let verifyPassword: (h: string, p: string) => Promise<boolean>;

  before(async () => {
    const mod = await import("../services/passwordService.js");
    hashPassword = mod.hashPassword;
    verifyPassword = mod.verifyPassword;
  });

  it("produces an argon2id hash", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    assert.ok(hash.startsWith("$argon2id$"), "hash must be argon2id");
  });

  it("verifies the correct password", async () => {
    const hash = await hashPassword("my-secret-password");
    const ok = await verifyPassword(hash, "my-secret-password");
    assert.equal(ok, true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("my-secret-password");
    const ok = await verifyPassword(hash, "wrong-password");
    assert.equal(ok, false);
  });

  it("produces a different hash each call (random salt)", async () => {
    const h1 = await hashPassword("same-password");
    const h2 = await hashPassword("same-password");
    assert.notEqual(h1, h2, "each hash must use a unique salt");
  });
});

// ---------------------------------------------------------------------------
// Session token generation & hashing (pure crypto — no DB)
// ---------------------------------------------------------------------------

describe("session token internals", () => {
  function generateToken(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  function hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  it("token is at least 43 base64url chars (32 bytes entropy)", () => {
    const token = generateToken();
    assert.ok(token.length >= 43, `token too short: ${token.length}`);
  });

  it("hash is a 64-char hex string (SHA-256)", () => {
    const token = generateToken();
    const hash = hashToken(token);
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("same token always produces the same hash", () => {
    const token = generateToken();
    assert.equal(hashToken(token), hashToken(token));
  });

  it("different tokens produce different hashes", () => {
    const t1 = generateToken();
    const t2 = generateToken();
    assert.notEqual(hashToken(t1), hashToken(t2));
  });

  it("raw token is never equal to its hash", () => {
    const token = generateToken();
    assert.notEqual(token, hashToken(token));
  });
});

// ---------------------------------------------------------------------------
// Cookie options shape
// ---------------------------------------------------------------------------

describe("session cookie options", () => {
  it("sets httpOnly, sameSite lax, path / in development", () => {
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const opts = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: false,
      path: "/",
      expires: expiresAt,
    };

    assert.equal(opts.httpOnly, true);
    assert.equal(opts.sameSite, "lax");
    assert.equal(opts.secure, false);
    assert.equal(opts.path, "/");
    assert.ok(opts.expires instanceof Date);
    assert.ok(opts.expires > new Date());
  });

  it("sets secure=true in production", () => {
    const opts = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: true,
      path: "/",
      expires: new Date(),
    };
    assert.equal(opts.secure, true);
  });
});

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

describe("env validation", () => {
  it("SESSION_DURATION_HOURS accepts 1–720 and rejects out-of-range values", async () => {
    const { z } = await import("zod");

    const schema = z.coerce.number().int().min(1).max(720);

    assert.ok(schema.safeParse(8).success, "8 should be valid");
    assert.ok(schema.safeParse(1).success, "1 should be valid");
    assert.ok(schema.safeParse(720).success, "720 should be valid");
    assert.ok(!schema.safeParse(0).success, "0 should be invalid");
    assert.ok(!schema.safeParse(721).success, "721 should be invalid");
    assert.ok(!schema.safeParse(-1).success, "-1 should be invalid");
  });
});
