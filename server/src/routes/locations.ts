import { Router } from "express";
import { validateOrigin } from "../middleware/validateOrigin.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePasswordChanged } from "../middleware/requirePasswordChanged.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  listLocationsHandler,
  getLocationByIdHandler,
  createLocationHandler,
  updateLocationHandler,
} from "../controllers/locationController.js";

const router = Router();

router.get(
  "/",
  requireAuth,
  requirePasswordChanged,
  requirePermission("locations.view"),
  listLocationsHandler
);

router.get(
  "/:locationId",
  requireAuth,
  requirePasswordChanged,
  requirePermission("locations.view"),
  getLocationByIdHandler
);

router.post(
  "/",
  validateOrigin,
  requireAuth,
  requirePasswordChanged,
  requirePermission("locations.create"),
  createLocationHandler
);

router.patch(
  "/:locationId",
  validateOrigin,
  requireAuth,
  requirePasswordChanged,
  requirePermission("locations.update"),
  updateLocationHandler
);

export default router;
