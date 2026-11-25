import { Router } from "express";
import { validateOrigin } from "../middleware/validateOrigin.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePasswordChanged } from "../middleware/requirePasswordChanged.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  listEmployeesHandler,
  getEmployeeByIdHandler,
  createEmployeeHandler,
  updateEmployeeHandler,
  changeEmployeeStatusHandler,
  transferEmployeeHandler,
} from "../controllers/employeeController.js";

const router = Router();

router.get(
  "/",
  requireAuth,
  requirePasswordChanged,
  requirePermission("employees.view"),
  listEmployeesHandler
);

router.get(
  "/:employeeId",
  requireAuth,
  requirePasswordChanged,
  requirePermission("employees.view"),
  getEmployeeByIdHandler
);

router.post(
  "/",
  validateOrigin,
  requireAuth,
  requirePasswordChanged,
  requirePermission("employees.create"),
  createEmployeeHandler
);

router.patch(
  "/:employeeId",
  validateOrigin,
  requireAuth,
  requirePasswordChanged,
  requirePermission("employees.update"),
  updateEmployeeHandler
);

router.patch(
  "/:employeeId/status",
  validateOrigin,
  requireAuth,
  requirePasswordChanged,
  requirePermission("employees.change_status"),
  changeEmployeeStatusHandler
);

router.post(
  "/:employeeId/transfer",
  validateOrigin,
  requireAuth,
  requirePasswordChanged,
  requirePermission("employees.transfer"),
  transferEmployeeHandler
);

export default router;
