import type { Request, Response } from "express";
import { z } from "zod";
import prisma from "../config/database.js";
import { hashPassword, verifyPassword } from "../services/passwordService.js";
import { createSession, revokeSessionByToken, revokeOtherSessions } from "../services/sessionService.js";
import { env } from "../utils/env.js";
import { buildSessionCookieOptions, clearSessionCookieOptions } from "../utils/cookieOptions.js";

const loginSchema = z.object({
  identifier: z.string().min(1, "identifier is required"),
  password: z.string().min(1, "password is required"),
});

function safeUser(user: {
  id: string;
  username: string;
  email: string;
  isActive: boolean;
  mustChangePassword: boolean;
  employeeId: string | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    employeeId: user.employeeId,
    createdAt: user.createdAt,
  };
}

export async function login(req: Request, res: Response): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { identifier, password } = parsed.data;

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ username: identifier }, { email: identifier }],
    },
    select: {
      id: true,
      username: true,
      email: true,
      passwordHash: true,
      isActive: true,
      mustChangePassword: true,
      employeeId: true,
      createdAt: true,
    },
  });

  // Perform a dummy verify when user not found to prevent timing attacks
  const DUMMY_HASH =
    "$argon2id$v=19$m=65536,t=3,p=4$dummysaltdummysalt$dummyhashvaluedummyhashvaluedummyhashvalue";

  const passwordValid = user
    ? await verifyPassword(user.passwordHash, password).catch(() => false)
    : await verifyPassword(DUMMY_HASH, password).catch(() => false);

  if (!user || !passwordValid) {
    res.status(401).json({ success: false, message: "Invalid credentials" });
    return;
  }

  // NOTE: isActive is checked here. Users with isActive=false are rejected.
  if (!user.isActive) {
    res.status(401).json({ success: false, message: "Invalid credentials" });
    return;
  }

  const { token, expiresAt } = await createSession(user.id);

  res.cookie(env.SESSION_COOKIE_NAME, token, buildSessionCookieOptions(expiresAt));

  res.status(200).json({
    success: true,
    message: user.mustChangePassword ? "Login successful — password change required" : "Login successful",
    mustChangePassword: user.mustChangePassword,
    data: { user: safeUser(user) },
  });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const token: string | undefined = req.cookies?.[env.SESSION_COOKIE_NAME];

  // Always clear the cookie and return success — logout is idempotent.
  res.clearCookie(env.SESSION_COOKIE_NAME, clearSessionCookieOptions());

  if (token) {
    // Fire-and-forget: revocation failure must not prevent the cookie from
    // being cleared or the success response from being sent.
    await revokeSessionByToken(token).catch(() => {
      // Non-fatal — session will expire naturally.
    });
  }

  res.status(200).json({ success: true, message: "Logged out successfully" });
}

export async function me(req: Request, res: Response): Promise<void> {
  // req.user is guaranteed by requireAuth middleware
  res.status(200).json({
    success: true,
    data: { user: req.user },
  });
}

// ---------------------------------------------------------------------------
// Password policy
// Minimum 8 characters. No existing policy was found in the codebase;
// this is the minimum established for Stage 4C.3.
// ---------------------------------------------------------------------------
export const PASSWORD_MIN_LENGTH = 8;

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "currentPassword is required"),
  newPassword: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `newPassword must be at least ${PASSWORD_MIN_LENGTH} characters`),
  confirmPassword: z.string().min(1, "confirmPassword is required"),
});

export async function changePassword(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  const sessionId = req.sessionId;

  if (!userId || !sessionId) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return;
  }

  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { currentPassword, newPassword, confirmPassword } = parsed.data;

  if (confirmPassword !== newPassword) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: { confirmPassword: ["Passwords do not match"] },
    });
    return;
  }

  // Fetch the current hash — never returned in any response
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (!user) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return;
  }

  const currentPasswordValid = await verifyPassword(user.passwordHash, currentPassword).catch(
    () => false
  );

  if (!currentPasswordValid) {
    res.status(400).json({ success: false, message: "Current password is incorrect" });
    return;
  }

  // Reject reuse of the current password
  const isSamePassword = await verifyPassword(user.passwordHash, newPassword).catch(() => false);
  if (isSamePassword) {
    res.status(400).json({
      success: false,
      message: "New password must differ from the current password",
    });
    return;
  }

  const newHash = await hashPassword(newPassword);

  // Atomically update the password and clear the flag
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newHash, mustChangePassword: false },
  });

  // Revoke all other sessions; keep the current one active
  await revokeOtherSessions(userId, sessionId).catch(() => {
    // Non-fatal: log silently, do not fail the request
  });

  res.status(200).json({ success: true, message: "Password changed successfully" });
}
