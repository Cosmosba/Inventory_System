import type { Request, Response, NextFunction } from "express";
import prisma from "../config/database.js";

/**
 * Returns middleware that checks whether the authenticated user holds a
 * specific permission through any of their assigned roles.
 *
 * Must be used after requireAuth (which populates req.user).
 */
export function requirePermission(permissionName: string) {
  return async function (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    const match = await prisma.userRole.findFirst({
      where: {
        userId,
        role: {
          permissions: {
            some: {
              permission: { name: permissionName },
            },
          },
        },
      },
    }).catch(() => null);

    if (!match) {
      res.status(403).json({ success: false, message: "Forbidden" });
      return;
    }

    next();
  };
}
