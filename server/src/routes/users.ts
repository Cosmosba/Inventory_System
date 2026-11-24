import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePasswordChanged } from "../middleware/requirePasswordChanged.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  createUserAccount,
  resetPassword,
  listUsersHandler,
  getUserByIdHandler,
  activateUserHandler,
  deactivateUserHandler,
} from "../controllers/userController.js";

const router = Router();

// ── Create user ─────────────────────────────────────────────────────────────
router.post(
  "/",
  requireAuth,
  requirePasswordChanged,
  requirePermission("users.create"),
  createUserAccount
);

// ── List / search users ──────────────────────────────────────────────────────
router.get(
  "/",
  requireAuth,
  requirePasswordChanged,
  requirePermission("users.view"),
  listUsersHandler
);

// ── Get single user ──────────────────────────────────────────────────────────
router.get(
  "/:userId",
  requireAuth,
  requirePasswordChanged,
  requirePermission("users.view"),
  getUserByIdHandler
);

// ── Activate user ────────────────────────────────────────────────────────────
router.patch(
  "/:userId/activate",
  requireAuth,
  requirePasswordChanged,
  requirePermission("users.activate"),
  activateUserHandler
);

// ── Deactivate user ──────────────────────────────────────────────────────────
router.patch(
  "/:userId/deactivate",
  requireAuth,
  requirePasswordChanged,
  requirePermission("users.deactivate"),
  deactivateUserHandler
);

// ── Reset password ───────────────────────────────────────────────────────────
router.post(
  "/:userId/reset-password",
  requireAuth,
  requirePasswordChanged,
  requirePermission("users.reset_password"),
  resetPassword
);

export default router;
