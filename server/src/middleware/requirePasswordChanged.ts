import type { Request, Response, NextFunction } from "express";

/**
 * Blocks access to normal protected endpoints for users whose
 * mustChangePassword flag is true.
 *
 * Must be used after requireAuth (which populates req.user).
 *
 * Exempt routes (handled in auth router without this middleware):
 *   POST /api/auth/change-password
 *   POST /api/auth/logout
 *   GET  /api/auth/me
 */
export function requirePasswordChanged(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.user?.mustChangePassword) {
    res.status(403).json({
      success: false,
      code: "PASSWORD_CHANGE_REQUIRED",
      message: "You must change your password before accessing this resource.",
    });
    return;
  }
  next();
}
