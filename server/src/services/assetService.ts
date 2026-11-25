import prisma from "../config/database.js";
import { writeAudit, writeAuditTx } from "./auditService.js";
import { generateAssetTag, MAX_TAG_RETRIES, AssetTagError } from "./assetTagService.js";
import { buildPaginationResult, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "../utils/pagination.js";
import type { PaginationResult } from "../utils/pagination.js";
import type { AssetStatus, AssetCondition } from "../../generated/prisma/enums.js";

export class AssetServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "AssetServiceError";
  }
}

// Re-export so controllers can use it without importing assetTagService directly.
export { AssetTagError };

// ---------------------------------------------------------------------------
// Shared select shape
// ---------------------------------------------------------------------------

const ASSET_SELECT = {
  id: true,
  assetTag: true,
  serialNumber: true,
  name: true,
  categoryId: true,
  manufacturer: true,
  model: true,
  purchaseItemId: true,
  purchaseDate: true,
  purchaseCost: true,
  warrantyExpiryDate: true,
  condition: true,
  status: true,
  currentLocationId: true,
  currentDepartmentId: true,
  currentAssigneeId: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, tagPrefix: true, isSerialized: true } },
  currentLocation: { select: { id: true, name: true, building: true, room: true } },
  currentDepartment: { select: { id: true, name: true, code: true } },
  currentAssignee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
} as const;

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface ListAssetsInput {
  search?: string;
  assetTag?: string;
  serialNumber?: string;
  categoryId?: string;
  departmentId?: string;
  locationId?: string;
  status?: AssetStatus;
  year?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

const SORTABLE_FIELDS: Record<string, string> = {
  assetTag: "assetTag",
  name: "name",
  status: "status",
  condition: "condition",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
};

export async function listAssets(
  input: ListAssetsInput
): Promise<PaginationResult<typeof ASSET_SELECT extends object ? unknown : never>> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, input.pageSize ?? PAGE_SIZE_DEFAULT));

  // Build where clause
  const where: Record<string, unknown> = {};
  if (input.status) where.status = input.status;
  if (input.categoryId) where.categoryId = input.categoryId;
  if (input.departmentId) where.currentDepartmentId = input.departmentId;
  if (input.locationId) where.currentLocationId = input.locationId;
  if (input.year) where.createdAt = { gte: new Date(`${input.year}-01-01`), lt: new Date(`${input.year + 1}-01-01`) };

  if (input.assetTag) {
    where.assetTag = { contains: input.assetTag.trim(), mode: "insensitive" };
  } else if (input.serialNumber) {
    where.serialNumber = { contains: input.serialNumber.trim(), mode: "insensitive" };
  } else if (input.search) {
    const term = input.search.trim();
    where.OR = [
      { assetTag: { contains: term, mode: "insensitive" } },
      { name: { contains: term, mode: "insensitive" } },
      { serialNumber: { contains: term, mode: "insensitive" } },
      { manufacturer: { contains: term, mode: "insensitive" } },
      { model: { contains: term, mode: "insensitive" } },
    ];
  }

  // Build orderBy
  const sortField = SORTABLE_FIELDS[input.sortBy ?? ""] ?? "createdAt";
  const sortOrder = input.sortOrder === "asc" ? "asc" : "desc";
  const orderBy = [{ [sortField]: sortOrder }];

  const [rows, total] = await prisma.$transaction([
    prisma.asset.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy,
      select: ASSET_SELECT,
    }),
    prisma.asset.count({ where }),
  ]);

  return buildPaginationResult(rows, total, page, pageSize);
}

// ---------------------------------------------------------------------------
// Get by ID
// ---------------------------------------------------------------------------

export async function getAssetById(id: string) {
  const asset = await prisma.asset.findUnique({
    where: { id },
    select: {
      ...ASSET_SELECT,
      // Include assignment history count for detail view
      assignments: {
        where: { returnedAt: { not: null } },
        orderBy: { assignedAt: "desc" },
        take: 5,
        select: {
          id: true,
          assignedAt: true,
          returnedAt: true,
          employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        },
      },
    },
  });

  if (!asset) throw new AssetServiceError("Asset not found.", "ASSET_NOT_FOUND");
  return asset;
}

// ---------------------------------------------------------------------------
// Register (create)
// ---------------------------------------------------------------------------

export interface RegisterAssetInput {
  name: string;
  categoryId: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  purchaseDate?: string;
  purchaseCost?: number;
  warrantyExpiryDate?: string;
  condition?: AssetCondition;
  currentLocationId?: string;
  currentDepartmentId?: string;
  notes?: string;
}

/**
 * Register a new serialized asset.
 *
 * Tag generation uses the approved retry loop:
 *   1. Allocate sequence (commits immediately).
 *   2. Attempt asset insert.
 *   3. On P2002 for asset_tag unique constraint only → retry up to MAX_TAG_RETRIES.
 *   4. All other errors propagate immediately.
 */
export async function registerAsset(
  input: RegisterAssetInput,
  initiatorUserId: string
) {
  // 1. Validate category exists and is serialized with a valid prefix.
  const category = await prisma.assetCategory.findUnique({ where: { id: input.categoryId } });
  if (!category) throw new AssetServiceError("Asset category not found.", "CATEGORY_NOT_FOUND");
  if (!category.isSerialized) {
    throw new AssetServiceError(
      "Asset registration is only available for serialized asset categories.",
      "NOT_SERIALIZED"
    );
  }
  if (!category.tagPrefix) {
    throw new AssetServiceError(
      "The selected asset category does not have a tag prefix configured.",
      "MISSING_PREFIX"
    );
  }

  // 2. Validate optional FK references before entering the retry loop.
  if (input.currentLocationId) {
    const loc = await prisma.location.findUnique({ where: { id: input.currentLocationId } });
    if (!loc) throw new AssetServiceError("Location not found.", "LOCATION_NOT_FOUND");
  }
  if (input.currentDepartmentId) {
    const dept = await prisma.department.findUnique({ where: { id: input.currentDepartmentId } });
    if (!dept) throw new AssetServiceError("Department not found.", "DEPARTMENT_NOT_FOUND");
  }

  const year = new Date().getFullYear();
  const prefix = category.tagPrefix;

  // 3. Retry loop — only retries on asset_tag P2002.
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_TAG_RETRIES; attempt++) {
    const assetTag = await generateAssetTag(input.categoryId, prefix, year);

    try {
      const asset = await prisma.$transaction(async (tx) => {
        const created = await tx.asset.create({
          data: {
            assetTag,
            serialNumber: input.serialNumber?.trim() ?? null,
            name: input.name.trim(),
            categoryId: input.categoryId,
            manufacturer: input.manufacturer?.trim() ?? null,
            model: input.model?.trim() ?? null,
            purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : null,
            purchaseCost: input.purchaseCost ?? null,
            warrantyExpiryDate: input.warrantyExpiryDate ? new Date(input.warrantyExpiryDate) : null,
            condition: input.condition ?? "NEW",
            status: "AVAILABLE",
            currentLocationId: input.currentLocationId ?? null,
            currentDepartmentId: input.currentDepartmentId ?? null,
            notes: input.notes?.trim() ?? null,
          },
          select: ASSET_SELECT,
        });

        await writeAuditTx(
          {
            userId: initiatorUserId,
            action: "REGISTER_ASSET",
            entityType: "asset",
            entityId: created.id,
            newValues: {
              assetTag: created.assetTag,
              name: created.name,
              categoryId: created.categoryId,
              serialNumber: created.serialNumber,
              condition: created.condition,
              status: created.status,
            },
          },
          tx
        );

        return created;
      });

      return asset;
    } catch (err) {
      if (isAssetTagUniqueViolation(err)) {
        lastError = err;
        // Retry with a new sequence allocation.
        continue;
      }
      // Not a tag collision — propagate immediately.
      throw err;
    }
  }

  throw new AssetServiceError(
    `Failed to generate a unique asset tag after ${MAX_TAG_RETRIES} attempts.`,
    "TAG_COLLISION_EXHAUSTED"
  );
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export interface UpdateAssetInput {
  name?: string;
  serialNumber?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  purchaseDate?: string | null;
  purchaseCost?: number | null;
  warrantyExpiryDate?: string | null;
  condition?: AssetCondition;
  currentLocationId?: string | null;
  currentDepartmentId?: string | null;
  notes?: string | null;
}

export async function updateAsset(
  id: string,
  input: UpdateAssetInput,
  initiatorUserId: string
) {
  const existing = await prisma.asset.findUnique({ where: { id } });
  if (!existing) throw new AssetServiceError("Asset not found.", "ASSET_NOT_FOUND");

  // Prevent updates on retired/disposed assets for most fields.
  if (existing.status === "RETIRED" || existing.status === "DISPOSED") {
    throw new AssetServiceError(
      "Cannot update a retired or disposed asset.",
      "ASSET_INACTIVE"
    );
  }

  // Validate FK references.
  if (input.currentLocationId) {
    const loc = await prisma.location.findUnique({ where: { id: input.currentLocationId } });
    if (!loc) throw new AssetServiceError("Location not found.", "LOCATION_NOT_FOUND");
  }
  if (input.currentDepartmentId) {
    const dept = await prisma.department.findUnique({ where: { id: input.currentDepartmentId } });
    if (!dept) throw new AssetServiceError("Department not found.", "DEPARTMENT_NOT_FOUND");
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if ("serialNumber" in input) data.serialNumber = input.serialNumber?.trim() ?? null;
  if ("manufacturer" in input) data.manufacturer = input.manufacturer?.trim() ?? null;
  if ("model" in input) data.model = input.model?.trim() ?? null;
  if ("purchaseDate" in input) data.purchaseDate = input.purchaseDate ? new Date(input.purchaseDate) : null;
  if ("purchaseCost" in input) data.purchaseCost = input.purchaseCost ?? null;
  if ("warrantyExpiryDate" in input) data.warrantyExpiryDate = input.warrantyExpiryDate ? new Date(input.warrantyExpiryDate) : null;
  if (input.condition !== undefined) data.condition = input.condition;
  if ("currentLocationId" in input) data.currentLocationId = input.currentLocationId ?? null;
  if ("currentDepartmentId" in input) data.currentDepartmentId = input.currentDepartmentId ?? null;
  if ("notes" in input) data.notes = input.notes?.trim() ?? null;

  const asset = await prisma.$transaction(async (tx) => {
    const updated = await tx.asset.update({
      where: { id },
      data,
      select: ASSET_SELECT,
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "UPDATE_ASSET",
        entityType: "asset",
        entityId: id,
        oldValues: {
          name: existing.name,
          serialNumber: existing.serialNumber,
          condition: existing.condition,
          currentLocationId: existing.currentLocationId,
          currentDepartmentId: existing.currentDepartmentId,
        },
        newValues: data as Record<string, unknown>,
      },
      tx
    );

    return updated;
  });

  return asset;
}

// ---------------------------------------------------------------------------
// Lifecycle — retire
// ---------------------------------------------------------------------------

export async function retireAsset(id: string, initiatorUserId: string) {
  const existing = await prisma.asset.findUnique({ where: { id } });
  if (!existing) throw new AssetServiceError("Asset not found.", "ASSET_NOT_FOUND");

  if (existing.status === "RETIRED") {
    throw new AssetServiceError("Asset is already retired.", "ALREADY_RETIRED");
  }
  if (existing.status === "DISPOSED") {
    throw new AssetServiceError("A disposed asset cannot be retired.", "INVALID_TRANSITION");
  }
  if (existing.status === "ASSIGNED") {
    throw new AssetServiceError(
      "Asset must be returned before it can be retired.",
      "ASSET_ASSIGNED"
    );
  }

  const asset = await prisma.$transaction(async (tx) => {
    const updated = await tx.asset.update({
      where: { id },
      data: { status: "RETIRED" },
      select: ASSET_SELECT,
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "RETIRE_ASSET",
        entityType: "asset",
        entityId: id,
        oldValues: { status: existing.status },
        newValues: { status: "RETIRED" },
      },
      tx
    );

    return updated;
  });

  return asset;
}

// ---------------------------------------------------------------------------
// Lifecycle — dispose
// ---------------------------------------------------------------------------

export async function disposeAsset(id: string, initiatorUserId: string) {
  const existing = await prisma.asset.findUnique({ where: { id } });
  if (!existing) throw new AssetServiceError("Asset not found.", "ASSET_NOT_FOUND");

  if (existing.status === "DISPOSED") {
    throw new AssetServiceError("Asset is already disposed.", "ALREADY_DISPOSED");
  }
  if (existing.status === "ASSIGNED") {
    throw new AssetServiceError(
      "Asset must be returned before it can be disposed.",
      "ASSET_ASSIGNED"
    );
  }

  const asset = await prisma.$transaction(async (tx) => {
    const updated = await tx.asset.update({
      where: { id },
      data: { status: "DISPOSED" },
      select: ASSET_SELECT,
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "DISPOSE_ASSET",
        entityType: "asset",
        entityId: id,
        oldValues: { status: existing.status },
        newValues: { status: "DISPOSED" },
      },
      tx
    );

    return updated;
  });

  return asset;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true only when the error is a Prisma P2002 on the asset_tag
 * unique constraint. Other P2002 violations (e.g. serialNumber) must NOT
 * trigger a tag retry.
 */
export function isAssetTagUniqueViolation(err: unknown): boolean {
  if (
    typeof err !== "object" ||
    err === null ||
    !("code" in err) ||
    (err as { code: string }).code !== "P2002"
  ) {
    return false;
  }
  const meta = (err as { meta?: { target?: string | string[] } }).meta;
  if (!meta) return false;
  const target = meta.target;
  if (Array.isArray(target)) return target.includes("assetTag") || target.includes("assets_assetTag_key");
  if (typeof target === "string") return target.includes("assetTag") || target.includes("assets_assetTag_key");
  return false;
}

export function isSerialNumberUniqueViolation(err: unknown): boolean {
  if (
    typeof err !== "object" ||
    err === null ||
    !("code" in err) ||
    (err as { code: string }).code !== "P2002"
  ) {
    return false;
  }
  const meta = (err as { meta?: { target?: string | string[] } }).meta;
  if (!meta) return false;
  const target = meta.target;
  if (Array.isArray(target)) return target.includes("serialNumber") || target.includes("assets_serialNumber_key");
  if (typeof target === "string") return target.includes("serialNumber") || target.includes("assets_serialNumber_key");
  return false;
}
