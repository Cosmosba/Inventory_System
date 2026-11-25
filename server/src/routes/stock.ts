import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePasswordChanged } from "../middleware/requirePasswordChanged.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  listStockItemsHandler,
  getStockItemByIdHandler,
  createStockItemHandler,
  updateStockItemHandler,
  issueStockHandler,
  returnStockHandler,
  adjustStockHandler,
  disposeStockHandler,
  listMovementsHandler,
} from "../controllers/stockController.js";

const router = Router();

// ---------------------------------------------------------------------------
// Stock Items
// ---------------------------------------------------------------------------

router.get(
  "/",
  requireAuth,
  requirePasswordChanged,
  requirePermission("stock.view"),
  listStockItemsHandler
);

router.get(
  "/movements",
  requireAuth,
  requirePasswordChanged,
  requirePermission("stock.view"),
  listMovementsHandler
);

router.get(
  "/:stockItemId",
  requireAuth,
  requirePasswordChanged,
  requirePermission("stock.view"),
  getStockItemByIdHandler
);

router.post(
  "/",
  requireAuth,
  requirePasswordChanged,
  requirePermission("stock.create_item"),
  createStockItemHandler
);

router.patch(
  "/:stockItemId",
  requireAuth,
  requirePasswordChanged,
  requirePermission("stock.update_item"),
  updateStockItemHandler
);

// ---------------------------------------------------------------------------
// Stock Movements
// ---------------------------------------------------------------------------

router.post(
  "/:stockItemId/issue",
  requireAuth,
  requirePasswordChanged,
  requirePermission("stock.issue"),
  issueStockHandler
);

router.post(
  "/:stockItemId/return",
  requireAuth,
  requirePasswordChanged,
  requirePermission("stock.return"),
  returnStockHandler
);

router.post(
  "/:stockItemId/adjust",
  requireAuth,
  requirePasswordChanged,
  requirePermission("stock.adjust"),
  adjustStockHandler
);

router.post(
  "/:stockItemId/dispose",
  requireAuth,
  requirePasswordChanged,
  requirePermission("stock.adjust"),
  disposeStockHandler
);

export default router;
