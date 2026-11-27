import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePasswordChanged } from "../middleware/requirePasswordChanged.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  assignAssetHandler,
  returnAssetHandler,
  listAssignmentsHandler,
  getAssignmentByIdHandler,
  listAssetAssignmentsHandler,
} from "../controllers/assignmentController.js";

const router = Router();

router.get(
  "/",
  requireAuth,
  requirePasswordChanged,
  requirePermission("assignments.view"),
  listAssignmentsHandler
);

// Asset-scoped assignment history must be registered before /:assignmentId so
// that Express does not match the literal segment "asset" as an assignmentId.
router.get(
  "/asset/:assetId",
  requireAuth,
  requirePasswordChanged,
  requirePermission("assignments.view"),
  listAssetAssignmentsHandler
);

router.get(
  "/:assignmentId",
  requireAuth,
  requirePasswordChanged,
  requirePermission("assignments.view"),
  getAssignmentByIdHandler
);

router.post(
  "/",
  requireAuth,
  requirePasswordChanged,
  requirePermission("assignments.assign"),
  assignAssetHandler
);

router.post(
  "/:assignmentId/return",
  requireAuth,
  requirePasswordChanged,
  requirePermission("assignments.return"),
  returnAssetHandler
);

export default router;
