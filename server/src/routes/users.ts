import { Router } from "express";
import { validateOrigin } from "../middleware/validateOrigin.js";
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
  validateOrigin,
  requireAuth,
  requirePasswordChanged,
  requirePermission("users.create"),
  createUserAccount
);

// ── List / search users ─────────────────────────────���────────────────────────
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
  validateOrigin,
  requireAuth,
  requirePasswordChanged,
  requirePermission("users.activate"),
  activateUserHandler
);

// ── Deactivate user ──────────────────────────────────────────────────────────
router.patch(
  "/:userId/deactivate",
  validateOrigin,
  requireAuth,
  requirePasswordChanged,
  requirePermission("users.deactivate"),
  deactivateUserHandler
);

// ── Reset password ───────────────────────────────────────────────────────────
router.post(
  "/:userId/reset-password",
  validateOrigin,
  requireAuth,
  requirePasswordChanged,
  requirePermission("users.reset_password"),
  resetPassword
);

export default router;
