import type { Request, Response, NextFunction } from "express";
import { env } from "../utils/env.js";
import { validateSession, touchSession } from "../services/sessionService.js";

const TOUCH_INTERVAL_MS = 5 * 60 * 1000; // update lastAccessedAt at most every 5 minutes

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token: string | undefined = req.cookies?.[env.SESSION_COOKIE_NAME];

  if (!token) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return;
  }

  const session = await validateSession(token).catch(() => null);

  if (!session) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return;
  }

  const { user } = session;

  // Independent deactivation guard: reject even if session revocation failed.
  if (!user.isActive) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return;
  }

  req.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    employeeId: user.employeeId,
  };
  req.sessionId = session.id;

  const now = new Date();
  const msSinceLastAccess = now.getTime() - session.lastAccessedAt.getTime();
  if (msSinceLastAccess >= TOUCH_INTERVAL_MS) {
    touchSession(session.id, now).catch(() => {
      // Non-fatal: do not fail the request if the touch write fails
    });
  }

  next();
}
