import type { Request, Response, NextFunction } from "express";
import { env } from "../utils/env.js";

/**
 * Validates the Origin header for state-changing requests (e.g. logout).
 *
 * Rules:
 * - If FRONTEND_ORIGIN is not configured, the check is skipped (same-origin
 *   server-side calls have no Origin header and are safe).
 * - Requests that carry an Origin header must match FRONTEND_ORIGIN exactly.
 * - Requests with no Origin header (e.g. same-origin browser navigation,
 *   server-to-server calls) are allowed through.
 *
 * This is a defence-in-depth layer on top of SameSite=Lax cookies.
 */
export function validateOrigin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!env.FRONTEND_ORIGIN) {
    next();
    return;
  }

  const origin = req.headers.origin;

  // No Origin header — not a cross-origin browser request; allow.
  if (!origin) {
    next();
    return;
  }

  if (origin === env.FRONTEND_ORIGIN) {
    next();
    return;
  }

  res.status(403).json({ success: false, message: "Forbidden" });
}
