import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePasswordChanged } from "../middleware/requirePasswordChanged.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  listAssetsHandler,
  getAssetByIdHandler,
  registerAssetHandler,
  updateAssetHandler,
  retireAssetHandler,
  disposeAssetHandler,
} from "../controllers/assetController.js";

const router = Router();

router.get(
  "/",
  requireAuth,
  requirePasswordChanged,
  requirePermission("assets.view"),
  listAssetsHandler
);

router.get(
  "/:assetId",
  requireAuth,
  requirePasswordChanged,
  requirePermission("assets.view"),
  getAssetByIdHandler
);

router.post(
  "/",
  requireAuth,
  requirePasswordChanged,
  requirePermission("assets.register"),
  registerAssetHandler
);

router.patch(
  "/:assetId",
  requireAuth,
  requirePasswordChanged,
  requirePermission("assets.update"),
  updateAssetHandler
);

router.patch(
  "/:assetId/retire",
  requireAuth,
  requirePasswordChanged,
  requirePermission("assets.retire"),
  retireAssetHandler
);

router.patch(
  "/:assetId/dispose",
  requireAuth,
  requirePasswordChanged,
  requirePermission("assets.dispose"),
  disposeAssetHandler
);

export default router;
