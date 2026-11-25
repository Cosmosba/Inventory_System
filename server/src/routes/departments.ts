import { Router } from "express";
import { validateOrigin } from "../middleware/validateOrigin.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePasswordChanged } from "../middleware/requirePasswordChanged.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  listDepartmentsHandler,
  getDepartmentByIdHandler,
  createDepartmentHandler,
  updateDepartmentHandler,
} from "../controllers/departmentController.js";

const router = Router();

router.get(
  "/",
  requireAuth,
  requirePasswordChanged,
  requirePermission("departments.view"),
  listDepartmentsHandler
);

router.get(
  "/:departmentId",
  requireAuth,
  requirePasswordChanged,
  requirePermission("departments.view"),
  getDepartmentByIdHandler
);

router.post(
  "/",
  validateOrigin,
  requireAuth,
  requirePasswordChanged,
  requirePermission("departments.create"),
  createDepartmentHandler
);

router.patch(
  "/:departmentId",
  validateOrigin,
  requireAuth,
  requirePasswordChanged,
  requirePermission("departments.update"),
  updateDepartmentHandler
);

export default router;
