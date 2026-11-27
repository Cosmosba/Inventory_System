import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePasswordChanged } from "../middleware/requirePasswordChanged.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  openMaintenanceHandler,
  updateMaintenanceHandler,
  resolveMaintenanceHandler,
  cancelMaintenanceHandler,
  listMaintenanceHandler,
  listAssetMaintenanceHandler,
  getMaintenanceByIdHandler,
} from "../controllers/maintenanceController.js";

const router = Router();

router.get(
  "/",
  requireAuth,
  requirePasswordChanged,
  requirePermission("maintenance.view"),
  listMaintenanceHandler
);

// Asset-scoped maintenance history must be registered before /:maintenanceId so
// that Express does not match the literal segment "asset" as a maintenanceId.
// See Stage 5.5 D-01 for the original route-ordering defect and its fix.
router.get(
  "/asset/:assetId",
  requireAuth,
  requirePasswordChanged,
  requirePermission("maintenance.view"),
  listAssetMaintenanceHandler
);

router.get(
  "/:maintenanceId",
  requireAuth,
  requirePasswordChanged,
  requirePermission("maintenance.view"),
  getMaintenanceByIdHandler
);

router.post(
  "/",
  requireAuth,
  requirePasswordChanged,
  requirePermission("maintenance.create"),
  openMaintenanceHandler
);

// Resolve and cancel sub-routes MUST be registered before /:maintenanceId PATCH.
// Express matches routes in registration order; the generic /:maintenanceId would
// otherwise intercept requests to /:maintenanceId/resolve and /:maintenanceId/cancel
// before they reach the correct handlers.
router.patch(
  "/:maintenanceId/resolve",
  requireAuth,
  requirePasswordChanged,
  requirePermission("maintenance.close"),
  resolveMaintenanceHandler
);

router.patch(
  "/:maintenanceId/cancel",
  requireAuth,
  requirePasswordChanged,
  requirePermission("maintenance.close"),
  cancelMaintenanceHandler
);

router.patch(
  "/:maintenanceId",
  requireAuth,
  requirePasswordChanged,
  requirePermission("maintenance.update"),
  updateMaintenanceHandler
);

export default router;
