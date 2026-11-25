import type { Request, Response } from "express";
import { z } from "zod";
import {
  listAssetCategories,
  getAssetCategoryById,
  createAssetCategory,
  updateAssetCategory,
  AssetCategoryServiceError,
} from "../services/assetCategoryService.js";

const listQuerySchema = z.object({
  search: z.string().max(200).optional(),
  isSerialized: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const idParamSchema = z.object({
  categoryId: z.string().uuid("categoryId must be a valid UUID"),
});

const createSchema = z.object({
  name: z.string().min(1, "name is required").max(100),
  tagPrefix: z.string().min(2).max(5).optional(),
  isSerialized: z.boolean().optional(),
  description: z.string().max(1000).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  tagPrefix: z.string().min(2).max(5).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
});

function isPrismaUniqueError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002";
}

export async function listAssetCategoriesHandler(req: Request, res: Response): Promise<void> {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  const result = await listAssetCategories(parsed.data);
  res.status(200).json({ success: true, data: result });
}

export async function getAssetCategoryByIdHandler(req: Request, res: Response): Promise<void> {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const cat = await getAssetCategoryById(parsed.data.categoryId);
    res.status(200).json({ success: true, data: { category: cat } });
  } catch (err) {
    if (err instanceof AssetCategoryServiceError && err.code === "CATEGORY_NOT_FOUND") {
      res.status(404).json({ success: false, message: err.message });
      return;
    }
    throw err;
  }
}

export async function createAssetCategoryHandler(req: Request, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const cat = await createAssetCategory(parsed.data, req.user!.id);
    res.status(201).json({ success: true, message: "Asset category created successfully.", data: { category: cat } });
  } catch (err) {
    if (err instanceof AssetCategoryServiceError) {
      if (err.code === "PREFIX_REQUIRED" || err.code === "INVALID_PREFIX") {
        res.status(422).json({ success: false, message: err.message, code: err.code });
        return;
      }
    }
    if (isPrismaUniqueError(err)) {
      res.status(409).json({ success: false, message: "An asset category with this name or prefix already exists." });
      return;
    }
    throw err;
  }
}

export async function updateAssetCategoryHandler(req: Request, res: Response): Promise<void> {
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
    const cat = await updateAssetCategory(paramsParsed.data.categoryId, bodyParsed.data, req.user!.id);
    res.status(200).json({ success: true, message: "Asset category updated successfully.", data: { category: cat } });
  } catch (err) {
    if (err instanceof AssetCategoryServiceError) {
      if (err.code === "CATEGORY_NOT_FOUND") {
        res.status(404).json({ success: false, message: err.message });
        return;
      }
      if (err.code === "PREFIX_REQUIRED" || err.code === "INVALID_PREFIX") {
        res.status(422).json({ success: false, message: err.message, code: err.code });
        return;
      }
    }
    if (isPrismaUniqueError(err)) {
      res.status(409).json({ success: false, message: "An asset category with this name or prefix already exists." });
      return;
    }
    throw err;
  }
}
