import type { Request, Response } from "express";
import { z } from "zod";
import {
  listStockItems,
  getStockItemById,
  createStockItem,
  updateStockItem,
  issueStock,
  returnStock,
  adjustStock,
  disposeStock,
  listMovements,
  StockServiceError,
  isPrismaUniqueError,
} from "../services/stockService.js";

const MOVEMENT_TYPES = ["PURCHASE", "ISSUE", "RETURN", "ADJUSTMENT", "DISPOSAL"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const listStockItemsQuerySchema = z.object({
  search: z.string().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  lowStock: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const stockItemIdParamSchema = z.object({
  stockItemId: z.string().uuid("stockItemId must be a valid UUID"),
});

const createStockItemSchema = z.object({
  name: z.string().min(1, "name is required").max(255),
  sku: z.string().min(1, "sku is required").max(100),
  categoryId: z.string().uuid().optional(),
  unit: z.string().min(1).max(50).optional(),
  minimumQuantity: z.number().int().min(0).optional(),
  notes: z.string().max(2000).optional(),
});

const updateStockItemSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  unit: z.string().min(1).max(50).optional(),
  minimumQuantity: z.number().int().min(0).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const issueStockSchema = z.object({
  quantity: z.number().int().min(1, "quantity must be at least 1"),
  issuedToEmployeeId: z.string().uuid().optional(),
  issuedToDepartmentId: z.string().uuid().optional(),
  reference: z.string().max(255).optional(),
  notes: z.string().max(2000).optional(),
});

const returnStockSchema = z.object({
  quantity: z.number().int().min(1, "quantity must be at least 1"),
  issuedToEmployeeId: z.string().uuid().optional(),
  issuedToDepartmentId: z.string().uuid().optional(),
  reference: z.string().max(255).optional(),
  notes: z.string().max(2000).optional(),
});

const adjustStockSchema = z.object({
  quantity: z.number().int().refine((v) => v !== 0, "quantity must not be zero"),
  reference: z.string().max(255).optional(),
  notes: z.string().max(2000).optional(),
});

const disposeStockSchema = z.object({
  quantity: z.number().int().min(1, "quantity must be at least 1"),
  reference: z.string().max(255).optional(),
  notes: z.string().max(2000).optional(),
});

const listMovementsQuerySchema = z.object({
  stockItemId: z.string().uuid().optional(),
  movementType: z.enum(MOVEMENT_TYPES).optional(),
  issuedToEmployeeId: z.string().uuid().optional(),
  issuedToDepartmentId: z.string().uuid().optional(),
  dateFrom: z.string().regex(ISO_DATE, "dateFrom must be YYYY-MM-DD").optional(),
  dateTo: z.string().regex(ISO_DATE, "dateTo must be YYYY-MM-DD").optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleStockNotFound(err: unknown, res: Response): boolean {
  if (err instanceof StockServiceError && err.code === "STOCK_ITEM_NOT_FOUND") {
    res.status(404).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

function handleStockServiceError(err: unknown, res: Response): boolean {
  if (!(err instanceof StockServiceError)) return false;
  switch (err.code) {
    case "STOCK_ITEM_NOT_FOUND":
      res.status(404).json({ success: false, message: err.message });
      return true;
    case "CATEGORY_NOT_FOUND":
    case "EMPLOYEE_NOT_FOUND":
    case "DEPARTMENT_NOT_FOUND":
      res.status(404).json({ success: false, message: err.message });
      return true;
    case "CATEGORY_SERIALIZED":
    case "INVALID_QUANTITY":
      res.status(422).json({ success: false, message: err.message });
      return true;
    case "INSUFFICIENT_STOCK":
      res.status(409).json({ success: false, message: err.message });
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Stock Item Handlers
// ---------------------------------------------------------------------------

export async function listStockItemsHandler(req: Request, res: Response): Promise<void> {
  const parsed = listStockItemsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  const result = await listStockItems(parsed.data);
  res.status(200).json({ success: true, data: result });
}

export async function getStockItemByIdHandler(req: Request, res: Response): Promise<void> {
  const parsed = stockItemIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const item = await getStockItemById(parsed.data.stockItemId);
    res.status(200).json({ success: true, data: { stockItem: item } });
  } catch (err) {
    if (handleStockNotFound(err, res)) return;
    throw err;
  }
}

export async function createStockItemHandler(req: Request, res: Response): Promise<void> {
  const parsed = createStockItemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const item = await createStockItem(parsed.data, req.user!.id);
    res.status(201).json({ success: true, message: "Stock item created successfully.", data: { stockItem: item } });
  } catch (err) {
    if (handleStockServiceError(err, res)) return;
    if (isPrismaUniqueError(err)) {
      res.status(409).json({ success: false, message: "A stock item with this SKU already exists." });
      return;
    }
    throw err;
  }
}

export async function updateStockItemHandler(req: Request, res: Response): Promise<void> {
  const paramsParsed = stockItemIdParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: paramsParsed.error.flatten().fieldErrors });
    return;
  }
  const bodyParsed = updateStockItemSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: bodyParsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const item = await updateStockItem(paramsParsed.data.stockItemId, bodyParsed.data, req.user!.id);
    res.status(200).json({ success: true, message: "Stock item updated successfully.", data: { stockItem: item } });
  } catch (err) {
    if (handleStockServiceError(err, res)) return;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Movement Handlers
// ---------------------------------------------------------------------------

export async function issueStockHandler(req: Request, res: Response): Promise<void> {
  const paramsParsed = stockItemIdParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: paramsParsed.error.flatten().fieldErrors });
    return;
  }
  const bodyParsed = issueStockSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: bodyParsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const movement = await issueStock(
      { stockItemId: paramsParsed.data.stockItemId, ...bodyParsed.data },
      req.user!.id
    );
    res.status(201).json({ success: true, message: "Stock issued successfully.", data: { movement } });
  } catch (err) {
    if (handleStockServiceError(err, res)) return;
    throw err;
  }
}

export async function returnStockHandler(req: Request, res: Response): Promise<void> {
  const paramsParsed = stockItemIdParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: paramsParsed.error.flatten().fieldErrors });
    return;
  }
  const bodyParsed = returnStockSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: bodyParsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const movement = await returnStock(
      { stockItemId: paramsParsed.data.stockItemId, ...bodyParsed.data },
      req.user!.id
    );
    res.status(201).json({ success: true, message: "Stock returned successfully.", data: { movement } });
  } catch (err) {
    if (handleStockServiceError(err, res)) return;
    throw err;
  }
}

export async function adjustStockHandler(req: Request, res: Response): Promise<void> {
  const paramsParsed = stockItemIdParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: paramsParsed.error.flatten().fieldErrors });
    return;
  }
  const bodyParsed = adjustStockSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: bodyParsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const movement = await adjustStock(
      { stockItemId: paramsParsed.data.stockItemId, ...bodyParsed.data },
      req.user!.id
    );
    res.status(201).json({ success: true, message: "Stock adjusted successfully.", data: { movement } });
  } catch (err) {
    if (handleStockServiceError(err, res)) return;
    throw err;
  }
}

export async function disposeStockHandler(req: Request, res: Response): Promise<void> {
  const paramsParsed = stockItemIdParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: paramsParsed.error.flatten().fieldErrors });
    return;
  }
  const bodyParsed = disposeStockSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: bodyParsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const movement = await disposeStock(
      { stockItemId: paramsParsed.data.stockItemId, ...bodyParsed.data },
      req.user!.id
    );
    res.status(201).json({ success: true, message: "Stock disposed successfully.", data: { movement } });
  } catch (err) {
    if (handleStockServiceError(err, res)) return;
    throw err;
  }
}

export async function listMovementsHandler(req: Request, res: Response): Promise<void> {
  const parsed = listMovementsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  const result = await listMovements(parsed.data);
  res.status(200).json({ success: true, data: result });
}
