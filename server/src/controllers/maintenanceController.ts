import type { Request, Response } from "express";
import { z } from "zod";
import {
  openMaintenance,
  updateMaintenance,
  resolveMaintenance,
  cancelMaintenance,
  listMaintenance,
  listAssetMaintenance,
  getMaintenanceById,
  MaintenanceServiceError,
  isOpenMaintenanceConflict,
} from "../services/maintenanceService.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ASSET_CONDITIONS = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;
const MAINTENANCE_STATUSES = ["REPORTED", "IN_PROGRESS", "RESOLVED", "CANCELLED"] as const;
const SORT_FIELDS = ["reportedDate", "startedDate", "resolvedDate", "status", "createdAt", "updatedAt"] as const;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const maintenanceIdParamSchema = z.object({
  maintenanceId: z.string().uuid("maintenanceId must be a valid UUID"),
});

const assetIdParamSchema = z.object({
  assetId: z.string().uuid("assetId must be a valid UUID"),
});

const createSchema = z.object({
  assetId: z.string().uuid("assetId must be a valid UUID"),
  problemDescription: z.string().min(1, "problemDescription is required").max(5000),
  reportedDate: z.string().regex(ISO_DATE, "reportedDate must be YYYY-MM-DD"),
  technician: z.string().max(150).optional(),
  assignedToUserId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
});

const updateSchema = z.object({
  repairDescription: z.string().max(5000).nullable().optional(),
  technician: z.string().max(150).nullable().optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  repairCost: z.number().nonnegative("repairCost must be non-negative").nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  status: z.literal("IN_PROGRESS").optional(),
});

const resolveSchema = z.object({
  resolvedCondition: z.enum(ASSET_CONDITIONS).optional(),
  repairCost: z.number().nonnegative("repairCost must be non-negative").nullable().optional(),
  repairDescription: z.string().max(5000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const cancelSchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
});

const listQuerySchema = z.object({
  search: z.string().max(200).optional(),
  assetId: z.string().uuid().optional(),
  status: z.enum(MAINTENANCE_STATUSES).optional(),
  sortBy: z.enum(SORT_FIELDS).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

function handleMaintenanceServiceError(err: unknown, res: Response): boolean {
  if (!(err instanceof MaintenanceServiceError)) return false;
  switch (err.code) {
    case "MAINTENANCE_NOT_FOUND":
    case "ASSET_NOT_FOUND":
    case "USER_NOT_FOUND":
      res.status(404).json({ success: false, message: err.message });
      return true;
    case "ASSET_NOT_AVAILABLE":
    case "MAINTENANCE_ALREADY_OPEN":
    case "MAINTENANCE_CLOSED":
    case "INVALID_TRANSITION":
    case "ASSET_STATE_INCONSISTENT":
      res.status(409).json({ success: false, message: err.message });
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function openMaintenanceHandler(req: Request, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const record = await openMaintenance(parsed.data, req.user!.id);
    res.status(201).json({ success: true, message: "Maintenance record created successfully.", data: { record } });
  } catch (err) {
    if (handleMaintenanceServiceError(err, res)) return;
    if (isOpenMaintenanceConflict(err)) {
      res.status(409).json({ success: false, message: "Asset already has an open maintenance record." });
      return;
    }
    throw err;
  }
}

export async function updateMaintenanceHandler(req: Request, res: Response): Promise<void> {
  const paramsParsed = maintenanceIdParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: paramsParsed.error.flatten().fieldErrors });
    return;
  }
  const bodyParsed = updateSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: bodyParsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const record = await updateMaintenance(paramsParsed.data.maintenanceId, bodyParsed.data, req.user!.id);
    res.status(200).json({ success: true, message: "Maintenance record updated successfully.", data: { record } });
  } catch (err) {
    if (handleMaintenanceServiceError(err, res)) return;
    throw err;
  }
}

export async function resolveMaintenanceHandler(req: Request, res: Response): Promise<void> {
  const paramsParsed = maintenanceIdParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: paramsParsed.error.flatten().fieldErrors });
    return;
  }
  const bodyParsed = resolveSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: bodyParsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const record = await resolveMaintenance(paramsParsed.data.maintenanceId, bodyParsed.data, req.user!.id);
    res.status(200).json({ success: true, message: "Maintenance record resolved successfully.", data: { record } });
  } catch (err) {
    if (handleMaintenanceServiceError(err, res)) return;
    throw err;
  }
}

export async function cancelMaintenanceHandler(req: Request, res: Response): Promise<void> {
  const paramsParsed = maintenanceIdParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: paramsParsed.error.flatten().fieldErrors });
    return;
  }
  const bodyParsed = cancelSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: bodyParsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const record = await cancelMaintenance(paramsParsed.data.maintenanceId, bodyParsed.data, req.user!.id);
    res.status(200).json({ success: true, message: "Maintenance record cancelled successfully.", data: { record } });
  } catch (err) {
    if (handleMaintenanceServiceError(err, res)) return;
    throw err;
  }
}

export async function listMaintenanceHandler(req: Request, res: Response): Promise<void> {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  const result = await listMaintenance(parsed.data);
  res.status(200).json({ success: true, data: result });
}

export async function listAssetMaintenanceHandler(req: Request, res: Response): Promise<void> {
  const parsed = assetIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const records = await listAssetMaintenance(parsed.data.assetId);
    res.status(200).json({ success: true, data: { records } });
  } catch (err) {
    if (handleMaintenanceServiceError(err, res)) return;
    throw err;
  }
}

export async function getMaintenanceByIdHandler(req: Request, res: Response): Promise<void> {
  const parsed = maintenanceIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const record = await getMaintenanceById(parsed.data.maintenanceId);
    res.status(200).json({ success: true, data: { record } });
  } catch (err) {
    if (handleMaintenanceServiceError(err, res)) return;
    throw err;
  }
}
