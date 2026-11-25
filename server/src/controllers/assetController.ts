import type { Request, Response } from "express";
import { z } from "zod";
import {
  listAssets,
  getAssetById,
  registerAsset,
  updateAsset,
  retireAsset,
  disposeAsset,
  AssetServiceError,
  AssetTagError,
  isAssetTagUniqueViolation,
  isSerialNumberUniqueViolation,
} from "../services/assetService.js";

const ASSET_STATUSES = ["AVAILABLE", "ASSIGNED", "UNDER_MAINTENANCE", "RETIRED", "DISPOSED"] as const;
const ASSET_CONDITIONS = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;
const SORT_FIELDS = ["assetTag", "name", "status", "condition", "createdAt", "updatedAt"] as const;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const listQuerySchema = z.object({
  search: z.string().max(200).optional(),
  assetTag: z.string().max(100).optional(),
  serialNumber: z.string().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  year: z.coerce.number().int().min(2000).max(9999).optional(),
  sortBy: z.enum(SORT_FIELDS).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const idParamSchema = z.object({
  assetId: z.string().uuid("assetId must be a valid UUID"),
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const registerSchema = z.object({
  name: z.string().min(1, "name is required").max(255),
  categoryId: z.string().uuid("categoryId must be a valid UUID"),
  serialNumber: z.string().max(200).optional(),
  manufacturer: z.string().max(150).optional(),
  model: z.string().max(150).optional(),
  purchaseDate: z.string().regex(ISO_DATE, "purchaseDate must be YYYY-MM-DD").optional(),
  purchaseCost: z.number().nonnegative().optional(),
  warrantyExpiryDate: z.string().regex(ISO_DATE, "warrantyExpiryDate must be YYYY-MM-DD").optional(),
  condition: z.enum(ASSET_CONDITIONS).optional(),
  currentLocationId: z.string().uuid().optional(),
  currentDepartmentId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  serialNumber: z.string().max(200).nullable().optional(),
  manufacturer: z.string().max(150).nullable().optional(),
  model: z.string().max(150).nullable().optional(),
  purchaseDate: z.string().regex(ISO_DATE).nullable().optional(),
  purchaseCost: z.number().nonnegative().nullable().optional(),
  warrantyExpiryDate: z.string().regex(ISO_DATE).nullable().optional(),
  condition: z.enum(ASSET_CONDITIONS).optional(),
  currentLocationId: z.string().uuid().nullable().optional(),
  currentDepartmentId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleAssetNotFound(err: unknown, res: Response): boolean {
  if (err instanceof AssetServiceError && err.code === "ASSET_NOT_FOUND") {
    res.status(404).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function listAssetsHandler(req: Request, res: Response): Promise<void> {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  const result = await listAssets(parsed.data);
  res.status(200).json({ success: true, data: result });
}

export async function getAssetByIdHandler(req: Request, res: Response): Promise<void> {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const asset = await getAssetById(parsed.data.assetId);
    res.status(200).json({ success: true, data: { asset } });
  } catch (err) {
    if (handleAssetNotFound(err, res)) return;
    throw err;
  }
}

export async function registerAssetHandler(req: Request, res: Response): Promise<void> {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const asset = await registerAsset(parsed.data, req.user!.id);
    res.status(201).json({ success: true, message: "Asset registered successfully.", data: { asset } });
  } catch (err) {
    if (err instanceof AssetServiceError) {
      if (err.code === "CATEGORY_NOT_FOUND" || err.code === "LOCATION_NOT_FOUND" || err.code === "DEPARTMENT_NOT_FOUND") {
        res.status(404).json({ success: false, message: err.message });
        return;
      }
      if (err.code === "NOT_SERIALIZED" || err.code === "MISSING_PREFIX") {
        res.status(422).json({ success: false, message: err.message });
        return;
      }
      if (err.code === "TAG_COLLISION_EXHAUSTED") {
        res.status(503).json({ success: false, message: err.message });
        return;
      }
    }
    if (err instanceof AssetTagError && err.code === "SEQUENCE_EXHAUSTED") {
      res.status(422).json({ success: false, message: err.message });
      return;
    }
    if (isSerialNumberUniqueViolation(err)) {
      res.status(409).json({ success: false, message: "An asset with this serial number already exists." });
      return;
    }
    throw err;
  }
}

export async function updateAssetHandler(req: Request, res: Response): Promise<void> {
  const paramsParsed = idParamSchema.safeParse(req.params);
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
    const asset = await updateAsset(paramsParsed.data.assetId, bodyParsed.data, req.user!.id);
    res.status(200).json({ success: true, message: "Asset updated successfully.", data: { asset } });
  } catch (err) {
    if (handleAssetNotFound(err, res)) return;
    if (err instanceof AssetServiceError) {
      if (err.code === "LOCATION_NOT_FOUND" || err.code === "DEPARTMENT_NOT_FOUND") {
        res.status(404).json({ success: false, message: err.message });
        return;
      }
      if (err.code === "ASSET_INACTIVE") {
        res.status(409).json({ success: false, message: err.message });
        return;
      }
    }
    if (isSerialNumberUniqueViolation(err)) {
      res.status(409).json({ success: false, message: "An asset with this serial number already exists." });
      return;
    }
    throw err;
  }
}

export async function retireAssetHandler(req: Request, res: Response): Promise<void> {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const asset = await retireAsset(parsed.data.assetId, req.user!.id);
    res.status(200).json({ success: true, message: "Asset retired successfully.", data: { asset } });
  } catch (err) {
    if (handleAssetNotFound(err, res)) return;
    if (err instanceof AssetServiceError) {
      if (err.code === "ALREADY_RETIRED" || err.code === "INVALID_TRANSITION" || err.code === "ASSET_ASSIGNED") {
        res.status(409).json({ success: false, message: err.message });
        return;
      }
    }
    throw err;
  }
}

export async function disposeAssetHandler(req: Request, res: Response): Promise<void> {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const asset = await disposeAsset(parsed.data.assetId, req.user!.id);
    res.status(200).json({ success: true, message: "Asset disposed successfully.", data: { asset } });
  } catch (err) {
    if (handleAssetNotFound(err, res)) return;
    if (err instanceof AssetServiceError) {
      if (err.code === "ALREADY_DISPOSED" || err.code === "ASSET_ASSIGNED") {
        res.status(409).json({ success: false, message: err.message });
        return;
      }
    }
    throw err;
  }
}
