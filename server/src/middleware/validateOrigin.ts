import type { Request, Response, NextFunction } from "express";
import { env } from "../utils/env.js";

/**
 * State-changing HTTP methods that require Origin validation.
 * GET, HEAD and OPTIONS are safe methods and are not checked.
 */
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Centralized CSRF protection middleware.
 *
 * Applied to all state-changing requests (POST, PUT, PATCH, DELETE).
 *
 * Rules:
 * - GET, HEAD and OPTIONS pass through unconditionally.
 * - If FRONTEND_ORIGIN is not configured (development only — production
 *   requires it via env validation), state-changing requests are allowed
 *   through so local development without a frontend still works.
 * - State-changing requests MUST carry an Origin header that matches
 *   FRONTEND_ORIGIN exactly. A missing, null, malformed or untrusted
 *   Origin is rejected with 403.
 * - Matching is exact string equality — no substring, hostname or
 *   wildcard matching.
 * - The Host header is never used as a substitute for Origin validation.
 *
 * This is a defence-in-depth layer on top of SameSite=Strict cookies.
 */
export function validateOrigin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Safe methods — never blocked.
  if (!STATE_CHANGING_METHODS.has(req.method)) {
    next();
    return;
  }

  // FRONTEND_ORIGIN not configured — allow (development without frontend).
  // Production is prevented from reaching this branch by env validation.
  if (!env.FRONTEND_ORIGIN) {
    next();
    return;
  }

  const origin = req.headers.origin;

  // Missing, empty or "null" Origin on a state-changing request — reject.
  if (!origin || origin === "null") {
    res.status(403).json({ success: false, message: "Forbidden" });
    return;
  }

  // Exact match only — no substring, hostname or wildcard matching.
  if (origin === env.FRONTEND_ORIGIN) {
    next();
    return;
  }

  res.status(403).json({ success: false, message: "Forbidden" });
}
