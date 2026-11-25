import { Router } from "express";
import { validateOrigin } from "../middleware/validateOrigin.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePasswordChanged } from "../middleware/requirePasswordChanged.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  listVendorsHandler,
  getVendorByIdHandler,
  createVendorHandler,
  updateVendorHandler,
  deactivateVendorHandler,
  activateVendorHandler,
} from "../controllers/vendorController.js";

const router = Router();

router.get(
  "/",
  requireAuth,
  requirePasswordChanged,
  requirePermission("vendors.view"),
  listVendorsHandler
);

router.get(
  "/:vendorId",
  requireAuth,
  requirePasswordChanged,
  requirePermission("vendors.view"),
  getVendorByIdHandler
);

router.post(
  "/",
  validateOrigin,
  requireAuth,
  requirePasswordChanged,
  requirePermission("vendors.create"),
  createVendorHandler
);

router.patch(
  "/:vendorId",
  validateOrigin,
  requireAuth,
  requirePasswordChanged,
  requirePermission("vendors.update"),
  updateVendorHandler
);

router.patch(
  "/:vendorId/deactivate",
  validateOrigin,
  requireAuth,
  requirePasswordChanged,
  requirePermission("vendors.deactivate"),
  deactivateVendorHandler
);

router.patch(
  "/:vendorId/activate",
  validateOrigin,
  requireAuth,
  requirePasswordChanged,
  requirePermission("vendors.update"),
  activateVendorHandler
);

export default router;
