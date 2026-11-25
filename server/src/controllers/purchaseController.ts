import type { Request, Response } from "express";
import { z } from "zod";
import {
  listPurchases,
  getPurchaseById,
  createPurchase,
  updatePurchase,
  confirmPurchase,
  cancelPurchase,
  receivePurchase,
  listReceipts,
  PurchaseServiceError,
  isPrismaUniqueError,
} from "../services/purchaseService.js";

const PURCHASE_STATUSES = ["DRAFT", "CONFIRMED", "RECEIVED", "CANCELLED"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SORT_FIELDS = ["referenceNumber", "purchaseDate", "totalAmount", "status", "createdAt"] as const;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const listQuerySchema = z.object({
  search: z.string().max(200).optional(),
  vendorId: z.string().uuid().optional(),
  status: z.enum(PURCHASE_STATUSES).optional(),
  dateFrom: z.string().regex(ISO_DATE, "dateFrom must be YYYY-MM-DD").optional(),
  dateTo: z.string().regex(ISO_DATE, "dateTo must be YYYY-MM-DD").optional(),
  sortBy: z.enum(SORT_FIELDS).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const purchaseIdParamSchema = z.object({
  purchaseId: z.string().uuid("purchaseId must be a valid UUID"),
});

const purchaseItemSchema = z.object({
  description: z.string().min(1).max(255),
  assetCategoryId: z.string().uuid().optional(),
  stockItemId: z.string().uuid().optional(),
  quantity: z.number().int().min(1),
  unitCost: z.number().nonnegative(),
});

const createPurchaseSchema = z.object({
  referenceNumber: z.string().min(1).max(100),
  vendorId: z.string().uuid(),
  purchaseDate: z.string().regex(ISO_DATE, "purchaseDate must be YYYY-MM-DD"),
  documentReference: z.string().max(255).optional(),
  notes: z.string().max(2000).optional(),
  items: z.array(purchaseItemSchema).min(1),
});

const updatePurchaseSchema = z.object({
  referenceNumber: z.string().min(1).max(100).optional(),
  vendorId: z.string().uuid().optional(),
  purchaseDate: z.string().regex(ISO_DATE).optional(),
  documentReference: z.string().max(255).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(purchaseItemSchema).min(1).optional(),
});

const receiveLineSchema = z.object({
  purchaseItemId: z.string().uuid(),
  quantityReceived: z.number().int().min(1),
  serialNumbers: z.array(z.string().min(1).max(200)).optional(),
});

const receivePurchaseSchema = z.object({
  lines: z.array(receiveLineSchema).min(1),
  documentReference: z.string().max(255).optional(),
  notes: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

function handlePurchaseServiceError(err: unknown, res: Response): boolean {
  if (!(err instanceof PurchaseServiceError)) return false;
  switch (err.code) {
    case "PURCHASE_NOT_FOUND":
    case "VENDOR_NOT_FOUND":
    case "CATEGORY_NOT_FOUND":
    case "STOCK_ITEM_NOT_FOUND":
    case "PURCHASE_ITEM_NOT_FOUND":
      res.status(404).json({ success: false, message: err.message });
      return true;
    case "VENDOR_INACTIVE":
    case "INVALID_ITEM_TYPE":
    case "INVALID_QUANTITY":
    case "INVALID_UNIT_COST":
    case "NO_ITEMS":
    case "CATEGORY_NOT_SERIALIZED":
    case "MISSING_PREFIX":
      res.status(422).json({ success: false, message: err.message });
      return true;
    case "PURCHASE_NOT_EDITABLE":
    case "ITEMS_LOCKED":
    case "HEADER_LOCKED":
    case "INVALID_STATUS_TRANSITION":
    case "ALREADY_CANCELLED":
    case "HAS_RECEIPTS":
    case "PURCHASE_NOT_CONFIRMED":
    case "OVER_RECEIVING":
    case "PURCHASE_ITEM_MISMATCH":
    case "DUPLICATE_LINES":
    case "EMPTY_LINES":
      res.status(409).json({ success: false, message: err.message });
      return true;
    case "TAG_COLLISION_EXHAUSTED":
      res.status(503).json({ success: false, message: err.message });
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function listPurchasesHandler(req: Request, res: Response): Promise<void> {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  const result = await listPurchases(parsed.data);
  res.status(200).json({ success: true, data: result });
}

export async function getPurchaseByIdHandler(req: Request, res: Response): Promise<void> {
  const parsed = purchaseIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const purchase = await getPurchaseById(parsed.data.purchaseId);
    res.status(200).json({ success: true, data: { purchase } });
  } catch (err) {
    if (handlePurchaseServiceError(err, res)) return;
    throw err;
  }
}

export async function createPurchaseHandler(req: Request, res: Response): Promise<void> {
  const parsed = createPurchaseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const purchase = await createPurchase(parsed.data, req.user!.id);
    res.status(201).json({ success: true, message: "Purchase created successfully.", data: { purchase } });
  } catch (err) {
    if (handlePurchaseServiceError(err, res)) return;
    if (isPrismaUniqueError(err)) {
      res.status(409).json({ success: false, message: "A purchase with this reference number already exists." });
      return;
    }
    throw err;
  }
}

export async function updatePurchaseHandler(req: Request, res: Response): Promise<void> {
  const paramsParsed = purchaseIdParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: paramsParsed.error.flatten().fieldErrors });
    return;
  }
  const bodyParsed = updatePurchaseSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: bodyParsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const purchase = await updatePurchase(paramsParsed.data.purchaseId, bodyParsed.data, req.user!.id);
    res.status(200).json({ success: true, message: "Purchase updated successfully.", data: { purchase } });
  } catch (err) {
    if (handlePurchaseServiceError(err, res)) return;
    if (isPrismaUniqueError(err)) {
      res.status(409).json({ success: false, message: "A purchase with this reference number already exists." });
      return;
    }
    throw err;
  }
}

export async function confirmPurchaseHandler(req: Request, res: Response): Promise<void> {
  const parsed = purchaseIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const purchase = await confirmPurchase(parsed.data.purchaseId, req.user!.id);
    res.status(200).json({ success: true, message: "Purchase confirmed.", data: { purchase } });
  } catch (err) {
    if (handlePurchaseServiceError(err, res)) return;
    throw err;
  }
}

export async function cancelPurchaseHandler(req: Request, res: Response): Promise<void> {
  const parsed = purchaseIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const purchase = await cancelPurchase(parsed.data.purchaseId, req.user!.id);
    res.status(200).json({ success: true, message: "Purchase cancelled.", data: { purchase } });
  } catch (err) {
    if (handlePurchaseServiceError(err, res)) return;
    throw err;
  }
}

export async function receivePurchaseHandler(req: Request, res: Response): Promise<void> {
  const paramsParsed = purchaseIdParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: paramsParsed.error.flatten().fieldErrors });
    return;
  }
  const bodyParsed = receivePurchaseSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: bodyParsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const result = await receivePurchase(paramsParsed.data.purchaseId, bodyParsed.data, req.user!.id);
    res.status(201).json({ success: true, message: "Items received successfully.", data: result });
  } catch (err) {
    if (handlePurchaseServiceError(err, res)) return;
    throw err;
  }
}

export async function listReceiptsHandler(req: Request, res: Response): Promise<void> {
  const parsed = purchaseIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const receipts = await listReceipts(parsed.data.purchaseId);
    res.status(200).json({ success: true, data: { receipts } });
  } catch (err) {
    if (handlePurchaseServiceError(err, res)) return;
    throw err;
  }
}
