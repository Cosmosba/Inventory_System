import crypto from "crypto";
import prisma from "../config/database.js";
import { env } from "../utils/env.js";

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<CreatedSession> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + env.SESSION_DURATION_HOURS * 60 * 60 * 1000
  );

  await prisma.userSession.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      lastAccessedAt: now,
    },
  });

  return { token, expiresAt };
}

export async function validateSession(token: string) {
  const tokenHash = hashToken(token);
  const now = new Date();

  const session = await prisma.userSession.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (session.expiresAt <= now) return null;
  if (!session.user) return null;

  return session;
}

export function hashTokenForLookup(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function touchSession(sessionId: string, now: Date): Promise<void> {
  await prisma.userSession.update({
    where: { id: sessionId },
    data: { lastAccessedAt: now },
  });
}

/**
 * Revoke a session identified by its raw token.
 * Safe to call when the session is missing, already revoked, or expired —
 * all of those cases are treated as a no-op.
 * Never logs the raw token.
 */
export async function revokeSessionByToken(token: string): Promise<void> {
  const tokenHash = hashToken(token);

  await prisma.userSession.updateMany({
    where: {
      tokenHash,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revoke all active sessions for a user except the one identified by
 * currentSessionId. Used after a password change to invalidate stale sessions.
 */
export async function revokeOtherSessions(
  userId: string,
  currentSessionId: string
): Promise<void> {
  await prisma.userSession.updateMany({
    where: {
      userId,
      id: { not: currentSessionId },
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revoke ALL active sessions for a user, with no exceptions.
 * Used after an administrator password reset so the target user must
 * re-authenticate with the new credentials.
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revoke ALL active sessions for a user inside an existing transaction.
 * Accepts a transaction-scoped Prisma client so the revocation participates
 * in the caller's transaction and rolls back with it on failure.
 */
export async function revokeAllSessionsTx(
  userId: string,
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
): Promise<void> {
  await tx.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
