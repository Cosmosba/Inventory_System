import { Router } from "express";
import { validateOrigin } from "../middleware/validateOrigin.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePasswordChanged } from "../middleware/requirePasswordChanged.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  listAssetCategoriesHandler,
  getAssetCategoryByIdHandler,
  createAssetCategoryHandler,
  updateAssetCategoryHandler,
} from "../controllers/assetCategoryController.js";

const router = Router();

router.get(
  "/",
  requireAuth,
  requirePasswordChanged,
  requirePermission("asset_categories.view"),
  listAssetCategoriesHandler
);

router.get(
  "/:categoryId",
  requireAuth,
  requirePasswordChanged,
  requirePermission("asset_categories.view"),
  getAssetCategoryByIdHandler
);

router.post(
  "/",
  validateOrigin,
  requireAuth,
  requirePasswordChanged,
  requirePermission("asset_categories.create"),
  createAssetCategoryHandler
);

router.patch(
  "/:categoryId",
  validateOrigin,
  requireAuth,
  requirePasswordChanged,
  requirePermission("asset_categories.update"),
  updateAssetCategoryHandler
);

export default router;
