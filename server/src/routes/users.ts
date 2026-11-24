import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePasswordChanged } from "../middleware/requirePasswordChanged.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { createUserAccount, resetPassword } from "../controllers/userController.js";

const router = Router();

router.post(
  "/",
  requireAuth,
  requirePasswordChanged,
  requirePermission("users.create"),
  createUserAccount
);

router.post(
  "/:userId/reset-password",
  requireAuth,
  requirePasswordChanged,
  requirePermission("users.reset_password"),
  resetPassword
);

export default router;
