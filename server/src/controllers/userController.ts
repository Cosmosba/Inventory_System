import type { Request, Response } from "express";
import { z } from "zod";
import {
  createUser,
  resetUserPassword,
  listUsers,
  getUserById,
  activateUser,
  deactivateUser,
  UserServiceError,
} from "../services/userService.js";
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
    // This is not fire-and-forget: if revocation fails the error propagates
    // to the global handler (500). The password update is already committed,
    // but the administrator is informed rather than receiving a false success.
    await revokeAllSessions(targetUserId);

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

// ---------------------------------------------------------------------------
// List / search users
// ---------------------------------------------------------------------------

const PAGE_SIZE_MAX = 100;
const PAGE_SIZE_DEFAULT = 20;

const listUsersQuerySchema = z.object({
  search: z.string().max(200).optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce
    .number()
    .int()
    .min(1, "page must be at least 1")
    .default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, "pageSize must be at least 1")
    .max(PAGE_SIZE_MAX, `pageSize must not exceed ${PAGE_SIZE_MAX}`)
    .default(PAGE_SIZE_DEFAULT),
});

export async function listUsersHandler(req: Request, res: Response): Promise<void> {
  const parsed = listUsersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const result = await listUsers(parsed.data);

  res.status(200).json({
    success: true,
    data: result,
  });
}

// ---------------------------------------------------------------------------
// Get single user
// ---------------------------------------------------------------------------

const userIdParamSchema = z.object({
  userId: z.string().uuid("userId must be a valid UUID"),
});

export async function getUserByIdHandler(req: Request, res: Response): Promise<void> {
  const parsed = userIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const user = await getUserById(parsed.data.userId);
    res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    if (err instanceof UserServiceError && err.code === "USER_NOT_FOUND") {
      res.status(404).json({ success: false, message: err.message });
      return;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Activate user
// ---------------------------------------------------------------------------

export async function activateUserHandler(req: Request, res: Response): Promise<void> {
  const parsed = userIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { userId: targetUserId } = parsed.data;
  const initiatorUserId = req.user!.id;

  try {
    const { alreadyActive } = await activateUser(targetUserId, initiatorUserId);

    res.status(200).json({
      success: true,
      message: alreadyActive ? "Account is already active." : "Account activated successfully.",
    });
  } catch (err) {
    if (err instanceof UserServiceError && err.code === "USER_NOT_FOUND") {
      res.status(404).json({ success: false, message: err.message });
      return;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Deactivate user
// ---------------------------------------------------------------------------

export async function deactivateUserHandler(req: Request, res: Response): Promise<void> {
  const parsed = userIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { userId: targetUserId } = parsed.data;
  const initiatorUserId = req.user!.id;

  try {
    const { alreadyInactive } = await deactivateUser(targetUserId, initiatorUserId);

    res.status(200).json({
      success: true,
      message: alreadyInactive
        ? "Account is already inactive."
        : "Account deactivated successfully.",
    });
  } catch (err) {
    if (err instanceof UserServiceError) {
      if (err.code === "USER_NOT_FOUND") {
        res.status(404).json({ success: false, message: err.message });
        return;
      }
      if (err.code === "LAST_ADMIN") {
        res.status(409).json({ success: false, message: err.message });
        return;
      }
    }
    // Prisma P2034: serialization conflict from concurrent Serializable transactions.
    // The transaction was fully rolled back — no partial state was written.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2034"
    ) {
      res.status(409).json({
        success: false,
        code: "CONCURRENT_MODIFICATION",
        message:
          "The operation could not be completed due to a concurrent account-management change. Please retry.",
      });
      return;
    }
    throw err;
  }
}
