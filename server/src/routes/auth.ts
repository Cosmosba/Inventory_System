import { Router } from "express";
import rateLimit from "express-rate-limit";
import { login, logout, me, changePassword } from "../controllers/authController.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { validateOrigin } from "../middleware/validateOrigin.js";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many login attempts. Try again later." },
  skipSuccessfulRequests: false,
});

const router = Router();

router.post("/login", validateOrigin, loginLimiter, login);
router.post("/logout", validateOrigin, logout);
router.get("/me", requireAuth, me);

// Accessible to users with mustChangePassword = true — no requirePasswordChanged here.
router.post("/change-password", validateOrigin, requireAuth, changePassword);

export default router;
