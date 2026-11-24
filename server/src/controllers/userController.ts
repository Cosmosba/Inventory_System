import type { Request, Response } from "express";
import { z } from "zod";
import { createUser, resetUserPassword, UserServiceError } from "../services/userService.js";
import { revokeAllSessions } from "../services/sessionService.js";

const createUserSchema = z.object({
  username: z
    .string()
    .min(3, "username must be at least 3 characters")
    .max(100, "username must not exceed 100 characters")
    .regex(/^[a-zA-Z0-9_.-]+$/, "username may only contain letters, digits, _ . -"),
  email: z.string().email("email must be a valid email address").max(255),
  employeeId: z.string().uuid("employeeId must be a valid UUID"),
});

export async function createUserAccount(req: Request, res: Response): Promise<void> {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const result = await createUser(parsed.data);

    // Return the default password to the administrator once only.
    // It is never stored in plaintext and never appears in any other endpoint.
    res.status(201).json({
      success: true,
      message: "User account created successfully",
      data: {
        user: {
          id: result.id,
          username: result.username,
          email: result.email,
          employeeId: result.employeeId,
          isActive: result.isActive,
          mustChangePassword: result.mustChangePassword,
          createdAt: result.createdAt,
        },
        // Shown to the administrator once only — not persisted, not logged.
        defaultPassword: result.defaultPassword,
      },
    });
  } catch (err) {
    if (err instanceof UserServiceError) {
      if (err.code === "EMPLOYEE_NOT_FOUND") {
        res.status(404).json({ success: false, message: err.message });
        return;
      }
    }

    // Prisma unique constraint violation
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      const meta = (err as { meta?: { target?: string[] } }).meta;
      const fields = meta?.target ?? [];

      if (fields.includes("employeeId")) {
        res.status(409).json({
          success: false,
          message: "This employee already has a user account.",
        });
        return;
      }
      if (fields.includes("username")) {
        res.status(409).json({ success: false, message: "Username is already taken." });
        return;
      }
      if (fields.includes("email")) {
        res.status(409).json({
          success: false,
          message: "An account with this email address already exists.",
        });
        return;
      }

      res.status(409).json({ success: false, message: "Duplicate value conflict." });
      return;
    }

    throw err;
  }
}

const resetPasswordParamsSchema = z.object({
  userId: z.string().uuid("userId must be a valid UUID"),
});

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const paramsParsed = resetPasswordParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: paramsParsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { userId: targetUserId } = paramsParsed.data;
  const initiatorUserId = req.user!.id;

  try {
    const result = await resetUserPassword(targetUserId, initiatorUserId);

    // Revoke all sessions for the target user so they must re-authenticate.
    // Non-fatal: do not fail the reset if revocation encounters a transient error.
    await revokeAllSessions(targetUserId).catch(() => {});

    res.status(200).json({
      success: true,
      message: "Password reset successfully",
      data: {
        // Returned to the administrator once only — not persisted, not logged.
        defaultPassword: result.defaultPassword,
      },
    });
  } catch (err) {
    if (err instanceof UserServiceError) {
      if (err.code === "USER_NOT_FOUND") {
        res.status(404).json({ success: false, message: err.message });
        return;
      }
      if (err.code === "NO_EMPLOYEE_RECORD" || err.code === "EMPLOYEE_NOT_FOUND") {
        res.status(422).json({ success: false, message: err.message });
        return;
      }
      // generateDefaultPassword validation errors surface as plain Error instances
      // with a message matching the established pattern — re-throw as 422.
    }

    // generateDefaultPassword throws a plain Error for invalid names
    if (err instanceof Error && err.message.includes("first name")) {
      res.status(422).json({ success: false, message: err.message });
      return;
    }
    if (err instanceof Error && err.message.includes("last name")) {
      res.status(422).json({ success: false, message: err.message });
      return;
    }

    throw err;
  }
}
