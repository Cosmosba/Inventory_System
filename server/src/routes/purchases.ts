import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePasswordChanged } from "../middleware/requirePasswordChanged.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  listPurchasesHandler,
  getPurchaseByIdHandler,
  createPurchaseHandler,
  updatePurchaseHandler,
  confirmPurchaseHandler,
  cancelPurchaseHandler,
  receivePurchaseHandler,
  listReceiptsHandler,
} from "../controllers/purchaseController.js";

const router = Router();

router.get(
  "/",
  requireAuth,
  requirePasswordChanged,
  requirePermission("purchases.view"),
  listPurchasesHandler
);

router.get(
  "/:purchaseId",
  requireAuth,
  requirePasswordChanged,
  requirePermission("purchases.view"),
  getPurchaseByIdHandler
);

router.post(
  "/",
  requireAuth,
  requirePasswordChanged,
  requirePermission("purchases.create"),
  createPurchaseHandler
);

router.patch(
  "/:purchaseId",
  requireAuth,
  requirePasswordChanged,
  requirePermission("purchases.update"),
  updatePurchaseHandler
);

router.post(
  "/:purchaseId/confirm",
  requireAuth,
  requirePasswordChanged,
  requirePermission("purchases.confirm"),
  confirmPurchaseHandler
);

router.post(
  "/:purchaseId/cancel",
  requireAuth,
  requirePasswordChanged,
  requirePermission("purchases.cancel"),
  cancelPurchaseHandler
);

router.post(
  "/:purchaseId/receive",
  requireAuth,
  requirePasswordChanged,
  requirePermission("purchases.receive"),
  receivePurchaseHandler
);

router.get(
  "/:purchaseId/receipts",
  requireAuth,
  requirePasswordChanged,
  requirePermission("purchases.view"),
  listReceiptsHandler
);

export default router;
