import prisma from "../config/database.js";
import { writeAuditTx } from "./auditService.js";
import { buildPaginationResult, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "../utils/pagination.js";
import type { PaginationResult } from "../utils/pagination.js";

export class AssetCategoryServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "AssetCategoryServiceError";
  }
}

/** Tag prefix must be 2–5 uppercase English letters. */
const TAG_PREFIX_REGEX = /^[A-Z]{2,5}$/;

export function validateTagPrefix(prefix: string): boolean {
  return TAG_PREFIX_REGEX.test(prefix);
}

export interface AssetCategoryListItem {
  id: string;
  name: string;
  tagPrefix: string | null;
  isSerialized: boolean;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { assets: number; stockItems: number };
}

export interface ListAssetCategoriesInput {
  search?: string;
  isSerialized?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listAssetCategories(
  input: ListAssetCategoriesInput
): Promise<PaginationResult<AssetCategoryListItem>> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, input.pageSize ?? PAGE_SIZE_DEFAULT));

  const where: Record<string, unknown> = {};
  if (input.isSerialized !== undefined) where.isSerialized = input.isSerialized;
  if (input.search) {
    where.OR = [
      { name: { contains: input.search.trim(), mode: "insensitive" } },
      { tagPrefix: { contains: input.search.trim(), mode: "insensitive" } },
    ];
  }

  const [rows, total] = await prisma.$transaction([
    prisma.assetCategory.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        tagPrefix: true,
        isSerialized: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { assets: true, stockItems: true } },
      },
    }),
    prisma.assetCategory.count({ where }),
  ]);

  return buildPaginationResult(rows, total, page, pageSize);
}

export async function getAssetCategoryById(id: string): Promise<AssetCategoryListItem> {
  const cat = await prisma.assetCategory.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      tagPrefix: true,
      isSerialized: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { assets: true, stockItems: true } },
    },
  });

  if (!cat) throw new AssetCategoryServiceError("Asset category not found.", "CATEGORY_NOT_FOUND");
  return cat;
}

export interface CreateAssetCategoryInput {
  name: string;
  tagPrefix?: string;
  isSerialized?: boolean;
  description?: string;
}

export async function createAssetCategory(
  input: CreateAssetCategoryInput,
  initiatorUserId: string
): Promise<AssetCategoryListItem> {
  const isSerialized = input.isSerialized ?? true;
  const tagPrefix = input.tagPrefix ? input.tagPrefix.trim().toUpperCase() : undefined;

  // Serialized categories must have a prefix
  if (isSerialized && !tagPrefix) {
    throw new AssetCategoryServiceError(
      "Serialized asset categories must have a tag prefix.",
      "PREFIX_REQUIRED"
    );
  }

  // Validate prefix format
  if (tagPrefix && !validateTagPrefix(tagPrefix)) {
    throw new AssetCategoryServiceError(
      "Tag prefix must be 2–5 uppercase English letters (A–Z).",
      "INVALID_PREFIX"
    );
  }

  const cat = await prisma.$transaction(async (tx) => {
    const created = await tx.assetCategory.create({
      data: {
        name: input.name.trim(),
        tagPrefix: tagPrefix ?? null,
        isSerialized,
        description: input.description?.trim() ?? null,
      },
      select: {
        id: true,
        name: true,
        tagPrefix: true,
        isSerialized: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { assets: true, stockItems: true } },
      },
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "CREATE_ASSET_CATEGORY",
        entityType: "asset_category",
        entityId: created.id,
        newValues: { name: created.name, tagPrefix: created.tagPrefix, isSerialized },
      },
      tx
    );

    return created;
  });

  return cat;
}

export interface UpdateAssetCategoryInput {
  name?: string;
  tagPrefix?: string | null;
  description?: string | null;
}

export async function updateAssetCategory(
  id: string,
  input: UpdateAssetCategoryInput,
  initiatorUserId: string
): Promise<AssetCategoryListItem> {
  const existing = await prisma.assetCategory.findUnique({ where: { id } });
  if (!existing) throw new AssetCategoryServiceError("Asset category not found.", "CATEGORY_NOT_FOUND");

  // Validate new prefix if provided
  if (input.tagPrefix !== undefined && input.tagPrefix !== null) {
    const normalized = input.tagPrefix.trim().toUpperCase();
    if (!validateTagPrefix(normalized)) {
      throw new AssetCategoryServiceError(
        "Tag prefix must be 2–5 uppercase English letters (A–Z).",
        "INVALID_PREFIX"
      );
    }
    // Serialized category cannot have its prefix removed
    if (existing.isSerialized && input.tagPrefix === null) {
      throw new AssetCategoryServiceError(
        "Cannot remove the tag prefix from a serialized asset category.",
        "PREFIX_REQUIRED"
      );
    }
    input.tagPrefix = normalized;
  }

  // Prevent removing prefix from serialized category
  if (existing.isSerialized && "tagPrefix" in input && input.tagPrefix === null) {
    throw new AssetCategoryServiceError(
      "Cannot remove the tag prefix from a serialized asset category.",
      "PREFIX_REQUIRED"
    );
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if ("tagPrefix" in input) data.tagPrefix = input.tagPrefix ?? null;
  if ("description" in input) data.description = input.description?.trim() ?? null;

  const cat = await prisma.$transaction(async (tx) => {
    const updated = await tx.assetCategory.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        tagPrefix: true,
        isSerialized: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { assets: true, stockItems: true } },
      },
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "UPDATE_ASSET_CATEGORY",
        entityType: "asset_category",
        entityId: id,
        oldValues: { name: existing.name, tagPrefix: existing.tagPrefix },
        newValues: data as Record<string, unknown>,
      },
      tx
    );

    return updated;
  });

  return cat;
}
