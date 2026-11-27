/**
 * Maintenance Service — Stage 5.6
 *
 * Covers: opening, updating, resolving, cancelling maintenance records,
 * and listing/retrieving them.
 *
 * Concurrency strategy:
 *   - Open: lock asset FOR UPDATE, revalidate status, check for existing open
 *     record, create maintenance record and update asset atomically.
 *   - Resolve/Cancel: pre-read maintenance record to discover assetId, then
 *     lock asset FOR UPDATE first, maintenance record FOR UPDATE second
 *     (consistent asset-first ordering matching Stage 5.5), revalidate both,
 *     then update atomically.
 *   - The partial unique index maintenance_records_one_open_per_asset provides
 *     a database-level backstop against duplicate open maintenance records.
 */

import prisma from "../config/database.js";
import { writeAuditTx } from "./auditService.js";
import { buildPaginationResult, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "../utils/pagination.js";
import type { PaginationResult } from "../utils/pagination.js";
import type { AssetCondition, MaintenanceStatus } from "../../generated/prisma/enums.js";

export class MaintenanceServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "MaintenanceServiceError";
  }
}

// ---------------------------------------------------------------------------
// Shared select shape
// ---------------------------------------------------------------------------

const MAINTENANCE_SELECT = {
  id: true,
  assetId: true,
  problemDescription: true,
  repairDescription: true,
  status: true,
  reportedDate: true,
  startedDate: true,
  resolvedDate: true,
  repairCost: true,
  technician: true,
  assignedToUserId: true,
  notes: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  asset: {
    select: {
      id: true,
      assetTag: true,
      name: true,
      status: true,
      condition: true,
      category: { select: { id: true, name: true } },
    },
  },
  assignedTo: { select: { id: true, username: true } },
  createdBy: { select: { id: true, username: true } },
} as const;

// ---------------------------------------------------------------------------
// Open maintenance (POST /api/maintenance)
// ---------------------------------------------------------------------------

export interface OpenMaintenanceInput {
  assetId: string;
  problemDescription: string;
  reportedDate: string; // YYYY-MM-DD
  technician?: string;
  assignedToUserId?: string;
  notes?: string;
}

export async function openMaintenance(
  input: OpenMaintenanceInput,
  initiatorUserId: string
) {
  // Pre-transaction existence check (fast-fail, not locked)
  const assetExists = await prisma.asset.findUnique({
    where: { id: input.assetId },
    select: { id: true },
  });
  if (!assetExists) throw new MaintenanceServiceError("Asset not found.", "ASSET_NOT_FOUND");

  const record = await prisma.$transaction(async (tx) => {
    // 1. Lock asset row FOR UPDATE
    const assetRows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status"
      FROM   "assets"
      WHERE  "id" = ${input.assetId}::uuid
      FOR UPDATE
    `;
    if (assetRows.length === 0) {
      throw new MaintenanceServiceError("Asset not found.", "ASSET_NOT_FOUND");
    }
    const lockedStatus = assetRows[0].status;

    // 2. Revalidate asset status — only AVAILABLE assets can enter maintenance
    if (lockedStatus !== "AVAILABLE") {
      const codeMap: Record<string, string> = {
        ASSIGNED: "ASSET_NOT_AVAILABLE",
        UNDER_MAINTENANCE: "MAINTENANCE_ALREADY_OPEN",
        RETIRED: "ASSET_NOT_AVAILABLE",
        DISPOSED: "ASSET_NOT_AVAILABLE",
      };
      const code = codeMap[lockedStatus] ?? "ASSET_NOT_AVAILABLE";
      throw new MaintenanceServiceError(
        `Asset cannot enter maintenance. Current status: ${lockedStatus}.`,
        code
      );
    }

    // 3. Application-level check for existing open maintenance record
    //    (belt-and-suspenders alongside the partial unique index)
    const existingOpen = await tx.maintenanceRecord.findFirst({
      where: {
        assetId: input.assetId,
        status: { notIn: ["RESOLVED", "CANCELLED"] },
      },
      select: { id: true },
    });
    if (existingOpen) {
      throw new MaintenanceServiceError(
        "Asset already has an open maintenance record.",
        "MAINTENANCE_ALREADY_OPEN"
      );
    }

    // 4. Validate assignedToUserId inside the transaction (D3 fix: re-read
    //    under READ COMMITTED to catch any deletion committed before this point,
    //    matching the employee re-validation pattern in assignmentService)
    if (input.assignedToUserId) {
      const userExists = await tx.user.findUnique({
        where: { id: input.assignedToUserId },
        select: { id: true },
      });
      if (!userExists) {
        throw new MaintenanceServiceError("Assigned user not found.", "USER_NOT_FOUND");
      }
    }

    // 5. Create maintenance record
    //    Catch P2003 on assignedToUserId FK: user deleted after in-transaction
    //    check but before the write commits (residual race window).
    let created;
    try {
      created = await tx.maintenanceRecord.create({
        data: {
          assetId: input.assetId,
          problemDescription: input.problemDescription.trim(),
          status: "REPORTED",
          reportedDate: new Date(input.reportedDate),
          technician: input.technician?.trim() ?? null,
          assignedToUserId: input.assignedToUserId ?? null,
          notes: input.notes?.trim() ?? null,
          createdByUserId: initiatorUserId,
        },
        select: MAINTENANCE_SELECT,
      });
    } catch (writeErr) {
      if (isAssignedUserFkViolation(writeErr)) {
        throw new MaintenanceServiceError("Assigned user not found.", "USER_NOT_FOUND");
      }
      throw writeErr;
    }

    // 6. Update asset status to UNDER_MAINTENANCE
    await tx.asset.update({
      where: { id: input.assetId },
      data: { status: "UNDER_MAINTENANCE" },
    });

    // 7. Audit
    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "OPEN_MAINTENANCE",
        entityType: "maintenance_record",
        entityId: created.id,
        newValues: {
          maintenanceId: created.id,
          assetId: input.assetId,
          status: "REPORTED",
          reportedDate: input.reportedDate,
          problemDescription: input.problemDescription,
        },
      },
      tx
    );

    return created;
  });

  return record;
}

// ---------------------------------------------------------------------------
// Update maintenance (PATCH /api/maintenance/:maintenanceId)
// ---------------------------------------------------------------------------

export interface UpdateMaintenanceInput {
  repairDescription?: string | null;
  technician?: string | null;
  assignedToUserId?: string | null;
  repairCost?: number | null;
  notes?: string | null;
  status?: "IN_PROGRESS";
}

export async function updateMaintenance(
  maintenanceId: string,
  input: UpdateMaintenanceInput,
  initiatorUserId: string
) {
  // Pre-transaction fast-fail: catch obviously missing records before locking
  const preRead = await prisma.maintenanceRecord.findUnique({
    where: { id: maintenanceId },
    select: { id: true, status: true },
  });
  if (!preRead) {
    throw new MaintenanceServiceError("Maintenance record not found.", "MAINTENANCE_NOT_FOUND");
  }
  if (preRead.status === "RESOLVED" || preRead.status === "CANCELLED") {
    throw new MaintenanceServiceError(
      "Cannot update a closed maintenance record.",
      "MAINTENANCE_CLOSED"
    );
  }

  const record = await prisma.$transaction(async (tx) => {
    // 1. Lock maintenance record FOR UPDATE (D4 fix: serialize concurrent updates
    //    and revalidate status/startedDate against the locked row, not the
    //    pre-transaction snapshot)
    const maintenanceRows = await tx.$queryRaw<Array<{
      id: string;
      status: string;
      startedDate: Date | null;
    }>>`
      SELECT "id", "status", "startedDate"
      FROM   "maintenance_records"
      WHERE  "id" = ${maintenanceId}::uuid
      FOR UPDATE
    `;
    if (maintenanceRows.length === 0) {
      throw new MaintenanceServiceError("Maintenance record not found.", "MAINTENANCE_NOT_FOUND");
    }
    const locked = maintenanceRows[0];

    // 2. Revalidate status against the locked row
    if (locked.status === "RESOLVED" || locked.status === "CANCELLED") {
      throw new MaintenanceServiceError(
        "Cannot update a closed maintenance record.",
        "MAINTENANCE_CLOSED"
      );
    }

    // 3. Validate assignedToUserId inside the transaction (D3 fix: re-read
    //    under READ COMMITTED to catch any deletion committed before this point)
    if (input.assignedToUserId !== undefined && input.assignedToUserId !== null) {
      const userExists = await tx.user.findUnique({
        where: { id: input.assignedToUserId },
        select: { id: true },
      });
      if (!userExists) {
        throw new MaintenanceServiceError("Assigned user not found.", "USER_NOT_FOUND");
      }
    }

    const data: Record<string, unknown> = {};

    if ("repairDescription" in input) data.repairDescription = input.repairDescription?.trim() ?? null;
    if ("technician" in input) data.technician = input.technician?.trim() ?? null;
    if ("assignedToUserId" in input) data.assignedToUserId = input.assignedToUserId ?? null;
    if ("repairCost" in input) data.repairCost = input.repairCost ?? null;
    if ("notes" in input) data.notes = input.notes?.trim() ?? null;

    // 4. Status transition: REPORTED → IN_PROGRESS only
    //    All checks use locked row values — not the pre-transaction snapshot
    if (input.status === "IN_PROGRESS") {
      if (locked.status !== "REPORTED") {
        throw new MaintenanceServiceError(
          "Status can only be set to IN_PROGRESS from REPORTED.",
          "INVALID_TRANSITION"
        );
      }
      data.status = "IN_PROGRESS";
      // Set startedDate only on first transition — never overwrite
      if (!locked.startedDate) {
        data.startedDate = new Date();
      }
    }

    //    Catch P2003 on assignedToUserId FK: user deleted after in-transaction
    //    check but before the write commits (residual race window).
    let updated;
    try {
      updated = await tx.maintenanceRecord.update({
        where: { id: maintenanceId },
        data,
        select: MAINTENANCE_SELECT,
      });
    } catch (writeErr) {
      if (isAssignedUserFkViolation(writeErr)) {
        throw new MaintenanceServiceError("Assigned user not found.", "USER_NOT_FOUND");
      }
      throw writeErr;
    }

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "UPDATE_MAINTENANCE",
        entityType: "maintenance_record",
        entityId: maintenanceId,
        oldValues: { status: locked.status },
        newValues: { ...data, maintenanceId },
      },
      tx
    );

    return updated;
  });

  return record;
}

// ---------------------------------------------------------------------------
// Resolve maintenance (PATCH /api/maintenance/:maintenanceId/resolve)
// ---------------------------------------------------------------------------

export interface ResolveMaintenanceInput {
  resolvedCondition?: AssetCondition;
  repairCost?: number | null;
  repairDescription?: string | null;
  notes?: string | null;
}

export async function resolveMaintenance(
  maintenanceId: string,
  input: ResolveMaintenanceInput,
  initiatorUserId: string
) {
  // Pre-transaction read to discover assetId (not locked — for lock ordering)
  const preRead = await prisma.maintenanceRecord.findUnique({
    where: { id: maintenanceId },
    select: { id: true, assetId: true, status: true },
  });
  if (!preRead) {
    throw new MaintenanceServiceError("Maintenance record not found.", "MAINTENANCE_NOT_FOUND");
  }
  if (preRead.status === "RESOLVED" || preRead.status === "CANCELLED") {
    throw new MaintenanceServiceError(
      "Maintenance record is already closed.",
      "MAINTENANCE_CLOSED"
    );
  }

  const assetId = preRead.assetId;

  const record = await prisma.$transaction(async (tx) => {
    // 1. Lock asset row FIRST (consistent asset-first ordering)
    const assetRows = await tx.$queryRaw<Array<{ id: string; status: string; condition: string }>>`
      SELECT "id", "status", "condition"
      FROM   "assets"
      WHERE  "id" = ${assetId}::uuid
      FOR UPDATE
    `;
    if (assetRows.length === 0) {
      throw new MaintenanceServiceError("Asset not found.", "ASSET_NOT_FOUND");
    }
    const lockedAsset = assetRows[0];

    // 2. Lock maintenance record SECOND
    const maintenanceRows = await tx.$queryRaw<Array<{
      id: string;
      status: string;
      assetId: string;
    }>>`
      SELECT "id", "status", "assetId"
      FROM   "maintenance_records"
      WHERE  "id" = ${maintenanceId}::uuid
      FOR UPDATE
    `;
    if (maintenanceRows.length === 0) {
      throw new MaintenanceServiceError("Maintenance record not found.", "MAINTENANCE_NOT_FOUND");
    }
    const lockedRecord = maintenanceRows[0];

    // 3. Revalidate maintenance record status
    if (lockedRecord.status === "RESOLVED" || lockedRecord.status === "CANCELLED") {
      throw new MaintenanceServiceError(
        "Maintenance record is already closed.",
        "MAINTENANCE_CLOSED"
      );
    }
    if (lockedRecord.status !== "REPORTED" && lockedRecord.status !== "IN_PROGRESS") {
      throw new MaintenanceServiceError(
        `Cannot resolve maintenance in status: ${lockedRecord.status}.`,
        "INVALID_TRANSITION"
      );
    }

    // 4. Verify asset is still UNDER_MAINTENANCE (guard against inconsistency)
    if (lockedAsset.status !== "UNDER_MAINTENANCE") {
      throw new MaintenanceServiceError(
        `Asset state is inconsistent. Expected UNDER_MAINTENANCE, found: ${lockedAsset.status}.`,
        "ASSET_STATE_INCONSISTENT"
      );
    }

    const resolvedDate = new Date();
    const newCondition = input.resolvedCondition ?? (lockedAsset.condition as AssetCondition);

    const maintenanceData: Record<string, unknown> = {
      status: "RESOLVED",
      resolvedDate,
    };
    if ("repairCost" in input) maintenanceData.repairCost = input.repairCost ?? null;
    if ("repairDescription" in input) maintenanceData.repairDescription = input.repairDescription?.trim() ?? null;
    if ("notes" in input) maintenanceData.notes = input.notes?.trim() ?? null;

    // 5. Update maintenance record
    const updated = await tx.maintenanceRecord.update({
      where: { id: maintenanceId },
      data: maintenanceData,
      select: MAINTENANCE_SELECT,
    });

    // 6. Update asset: restore AVAILABLE, optionally update condition
    await tx.asset.update({
      where: { id: assetId },
      data: {
        status: "AVAILABLE",
        condition: newCondition,
      },
    });

    // 7. Audit
    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "CLOSE_MAINTENANCE",
        entityType: "maintenance_record",
        entityId: maintenanceId,
        oldValues: { status: lockedRecord.status, assetStatus: "UNDER_MAINTENANCE" },
        newValues: {
          maintenanceId,
          assetId,
          status: "RESOLVED",
          resolvedDate,
          resolvedCondition: input.resolvedCondition ?? null,
          assetStatus: "AVAILABLE",
        },
      },
      tx
    );

    return updated;
  });

  return record;
}

// ---------------------------------------------------------------------------
// Cancel maintenance (PATCH /api/maintenance/:maintenanceId/cancel)
// ---------------------------------------------------------------------------

export interface CancelMaintenanceInput {
  notes?: string | null;
}

export async function cancelMaintenance(
  maintenanceId: string,
  input: CancelMaintenanceInput,
  initiatorUserId: string
) {
  // Pre-transaction read to discover assetId (not locked — for lock ordering)
  const preRead = await prisma.maintenanceRecord.findUnique({
    where: { id: maintenanceId },
    select: { id: true, assetId: true, status: true },
  });
  if (!preRead) {
    throw new MaintenanceServiceError("Maintenance record not found.", "MAINTENANCE_NOT_FOUND");
  }
  if (preRead.status === "RESOLVED" || preRead.status === "CANCELLED") {
    throw new MaintenanceServiceError(
      "Maintenance record is already closed.",
      "MAINTENANCE_CLOSED"
    );
  }

  const assetId = preRead.assetId;

  const record = await prisma.$transaction(async (tx) => {
    // 1. Lock asset row FIRST
    const assetRows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status"
      FROM   "assets"
      WHERE  "id" = ${assetId}::uuid
      FOR UPDATE
    `;
    if (assetRows.length === 0) {
      throw new MaintenanceServiceError("Asset not found.", "ASSET_NOT_FOUND");
    }
    const lockedAssetStatus = assetRows[0].status;

    // 2. Lock maintenance record SECOND
    const maintenanceRows = await tx.$queryRaw<Array<{
      id: string;
      status: string;
      notes: string | null;
    }>>`
      SELECT "id", "status", "notes"
      FROM   "maintenance_records"
      WHERE  "id" = ${maintenanceId}::uuid
      FOR UPDATE
    `;
    if (maintenanceRows.length === 0) {
      throw new MaintenanceServiceError("Maintenance record not found.", "MAINTENANCE_NOT_FOUND");
    }
    const lockedRecord = maintenanceRows[0];

    // 3. Revalidate maintenance record status
    if (lockedRecord.status === "RESOLVED" || lockedRecord.status === "CANCELLED") {
      throw new MaintenanceServiceError(
        "Maintenance record is already closed.",
        "MAINTENANCE_CLOSED"
      );
    }
    if (lockedRecord.status !== "REPORTED" && lockedRecord.status !== "IN_PROGRESS") {
      throw new MaintenanceServiceError(
        `Cannot cancel maintenance in status: ${lockedRecord.status}.`,
        "INVALID_TRANSITION"
      );
    }

    // 4. Verify asset is UNDER_MAINTENANCE
    if (lockedAssetStatus !== "UNDER_MAINTENANCE") {
      throw new MaintenanceServiceError(
        `Asset state is inconsistent. Expected UNDER_MAINTENANCE, found: ${lockedAssetStatus}.`,
        "ASSET_STATE_INCONSISTENT"
      );
    }

    const maintenanceData: Record<string, unknown> = { status: "CANCELLED" };
    // D6: optional notes — update if supplied, preserve existing if omitted
    if ("notes" in input) maintenanceData.notes = input.notes?.trim() ?? null;

    // 5. Update maintenance record
    const updated = await tx.maintenanceRecord.update({
      where: { id: maintenanceId },
      data: maintenanceData,
      select: MAINTENANCE_SELECT,
    });

    // 6. Restore asset to AVAILABLE
    await tx.asset.update({
      where: { id: assetId },
      data: { status: "AVAILABLE" },
    });

    // 7. Audit
    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "CLOSE_MAINTENANCE",
        entityType: "maintenance_record",
        entityId: maintenanceId,
        oldValues: { status: lockedRecord.status, assetStatus: "UNDER_MAINTENANCE" },
        newValues: {
          maintenanceId,
          assetId,
          status: "CANCELLED",
          assetStatus: "AVAILABLE",
        },
      },
      tx
    );

    return updated;
  });

  return record;
}

// ---------------------------------------------------------------------------
// List maintenance records (GET /api/maintenance)
// ---------------------------------------------------------------------------

export interface ListMaintenanceInput {
  search?: string;
  assetId?: string;
  status?: MaintenanceStatus;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

const SORTABLE_FIELDS: Record<string, string> = {
  reportedDate: "reportedDate",
  startedDate: "startedDate",
  resolvedDate: "resolvedDate",
  status: "status",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
};

export async function listMaintenance(
  input: ListMaintenanceInput
): Promise<PaginationResult<unknown>> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, input.pageSize ?? PAGE_SIZE_DEFAULT));

  const where: Record<string, unknown> = {};
  if (input.status) where.status = input.status;
  if (input.assetId) where.assetId = input.assetId;
  if (input.search) {
    const term = input.search.trim();
    where.OR = [
      { problemDescription: { contains: term, mode: "insensitive" } },
      { repairDescription: { contains: term, mode: "insensitive" } },
      { technician: { contains: term, mode: "insensitive" } },
      { asset: { assetTag: { contains: term, mode: "insensitive" } } },
      { asset: { name: { contains: term, mode: "insensitive" } } },
    ];
  }

  const sortField = SORTABLE_FIELDS[input.sortBy ?? ""] ?? "createdAt";
  const sortOrder = input.sortOrder === "asc" ? "asc" : "desc";

  const [rows, total] = await prisma.$transaction([
    prisma.maintenanceRecord.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { [sortField]: sortOrder },
      select: MAINTENANCE_SELECT,
    }),
    prisma.maintenanceRecord.count({ where }),
  ]);

  return buildPaginationResult(rows, total, page, pageSize);
}

// ---------------------------------------------------------------------------
// Asset maintenance history (GET /api/maintenance/asset/:assetId)
// ---------------------------------------------------------------------------

export async function listAssetMaintenance(assetId: string) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { id: true } });
  if (!asset) throw new MaintenanceServiceError("Asset not found.", "ASSET_NOT_FOUND");

  const records = await prisma.maintenanceRecord.findMany({
    where: { assetId },
    orderBy: { reportedDate: "desc" },
    select: MAINTENANCE_SELECT,
  });

  return records;
}

// ---------------------------------------------------------------------------
// Get maintenance record by ID (GET /api/maintenance/:maintenanceId)
// ---------------------------------------------------------------------------

export async function getMaintenanceById(id: string) {
  const record = await prisma.maintenanceRecord.findUnique({
    where: { id },
    select: MAINTENANCE_SELECT,
  });
  if (!record) {
    throw new MaintenanceServiceError("Maintenance record not found.", "MAINTENANCE_NOT_FOUND");
  }
  return record;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the error is a Prisma P2002 on the
 * maintenance_records_one_open_per_asset partial unique index.
 * Must NOT classify unrelated P2002 violations as maintenance conflicts.
 */
export function isOpenMaintenanceConflict(err: unknown): boolean {
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
  const needle = "maintenance_records_one_open_per_asset";
  if (Array.isArray(target)) return target.some((t) => String(t).includes(needle));
  if (typeof target === "string") return target.includes(needle);
  return false;
}

/**
 * Returns true when the error is a Prisma P2003 on the
 * maintenance_records_assignedToUserId_fkey foreign key.
 *
 * Prisma 7 with @prisma/adapter-pg surfaces P2003 with:
 *   meta.field_name = "maintenance_records_assignedToUserId_fkey (index)"
 *
 * Must NOT classify unrelated P2003 violations as user-not-found errors.
 */
export function isAssignedUserFkViolation(err: unknown): boolean {
  if (
    typeof err !== "object" ||
    err === null ||
    !("code" in err) ||
    (err as { code: string }).code !== "P2003"
  ) {
    return false;
  }
  const meta = (err as { meta?: { field_name?: string } }).meta;
  if (!meta || typeof meta.field_name !== "string") return false;
  return meta.field_name.includes("maintenance_records_assignedToUserId_fkey");
}
