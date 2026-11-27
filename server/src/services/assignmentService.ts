/**
 * Assignment Service — Stage 5.5
 *
 * Covers: asset assignment to employees, asset returns, and assignment history.
 *
 * Concurrency strategy:
 *   - Assignment: lock asset row FOR UPDATE, revalidate status, revalidate
 *     employee status via in-transaction read, then create assignment and
 *     update asset atomically.
 *   - Return: read assignment outside transaction to discover assetId, then
 *     lock asset row FOR UPDATE first, assignment row FOR UPDATE second
 *     (consistent asset-first ordering), revalidate both, then update atomically.
 *   - The partial unique index asset_assignments_one_open_per_asset provides
 *     a database-level backstop against duplicate open assignments.
 */

import prisma from "../config/database.js";
import { writeAuditTx } from "./auditService.js";
import { buildPaginationResult, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "../utils/pagination.js";
import type { PaginationResult } from "../utils/pagination.js";
import type { AssetCondition } from "../../generated/prisma/enums.js";

export class AssignmentServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "AssignmentServiceError";
  }
}

// ---------------------------------------------------------------------------
// Shared select shape
// ---------------------------------------------------------------------------

const ASSIGNMENT_SELECT = {
  id: true,
  assetId: true,
  employeeId: true,
  departmentId: true,
  locationId: true,
  assignedAt: true,
  returnedAt: true,
  notes: true,
  assignedByUserId: true,
  returnedByUserId: true,
  expectedReturnDate: true,
  returnCondition: true,
  returnNotes: true,
  createdAt: true,
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
  employee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeNumber: true,
      status: true,
    },
  },
  department: { select: { id: true, name: true, code: true } },
  location: { select: { id: true, name: true, building: true, room: true } },
  assignedBy: { select: { id: true, username: true } },
  returnedBy: { select: { id: true, username: true } },
} as const;

// ---------------------------------------------------------------------------
// Assign asset
// ---------------------------------------------------------------------------

export interface AssignAssetInput {
  assetId: string;
  employeeId: string;
  locationId?: string;
  expectedReturnDate?: string; // YYYY-MM-DD
  notes?: string;
}

export async function assignAsset(input: AssignAssetInput, initiatorUserId: string) {
  // Pre-transaction existence checks (not locked — just fast-fail for missing records)
  const assetExists = await prisma.asset.findUnique({
    where: { id: input.assetId },
    select: { id: true },
  });
  if (!assetExists) throw new AssignmentServiceError("Asset not found.", "ASSET_NOT_FOUND");

  const employeeExists = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true },
  });
  if (!employeeExists) throw new AssignmentServiceError("Employee not found.", "EMPLOYEE_NOT_FOUND");

  if (input.locationId) {
    const loc = await prisma.location.findUnique({ where: { id: input.locationId }, select: { id: true } });
    if (!loc) throw new AssignmentServiceError("Location not found.", "LOCATION_NOT_FOUND");
  }

  const assignment = await prisma.$transaction(async (tx) => {
    // 1. Lock asset row FOR UPDATE — prevents concurrent assignment
    const assetRows = await tx.$queryRaw<Array<{
      id: string;
      status: string;
    }>>`
      SELECT "id", "status"
      FROM   "assets"
      WHERE  "id" = ${input.assetId}::uuid
      FOR UPDATE
    `;
    if (assetRows.length === 0) {
      throw new AssignmentServiceError("Asset not found.", "ASSET_NOT_FOUND");
    }
    const lockedStatus = assetRows[0].status;

    // 2. Revalidate asset status after lock
    if (lockedStatus !== "AVAILABLE") {
      const codeMap: Record<string, string> = {
        ASSIGNED: "ASSET_ALREADY_ASSIGNED",
        UNDER_MAINTENANCE: "ASSET_UNDER_MAINTENANCE",
        RETIRED: "ASSET_RETIRED",
        DISPOSED: "ASSET_DISPOSED",
      };
      const code = codeMap[lockedStatus] ?? "ASSET_NOT_AVAILABLE";
      throw new AssignmentServiceError(
        `Asset cannot be assigned. Current status: ${lockedStatus}.`,
        code
      );
    }

    // 3. Re-read employee inside transaction (READ COMMITTED snapshot — catches
    //    status changes committed before this point without needing a row lock)
    const employee = await tx.employee.findUnique({
      where: { id: input.employeeId },
      select: { id: true, status: true, departmentId: true },
    });
    if (!employee) {
      throw new AssignmentServiceError("Employee not found.", "EMPLOYEE_NOT_FOUND");
    }
    if (employee.status !== "ACTIVE") {
      throw new AssignmentServiceError(
        `Employee cannot receive an assignment. Current status: ${employee.status}.`,
        "EMPLOYEE_NOT_ACTIVE"
      );
    }

    // 4. Derive department snapshot from employee's current department
    //    (not from client input — approved policy)
    const departmentId = employee.departmentId ?? null;

    // 5. Create assignment record
    const created = await tx.assetAssignment.create({
      data: {
        assetId: input.assetId,
        employeeId: input.employeeId,
        departmentId,
        locationId: input.locationId ?? null,
        assignedByUserId: initiatorUserId,
        expectedReturnDate: input.expectedReturnDate ? new Date(input.expectedReturnDate) : null,
        notes: input.notes?.trim() ?? null,
      },
      select: ASSIGNMENT_SELECT,
    });

    // 6. Update asset cached fields
    await tx.asset.update({
      where: { id: input.assetId },
      data: {
        status: "ASSIGNED",
        currentAssigneeId: input.employeeId,
        currentDepartmentId: departmentId,
        currentLocationId: input.locationId ?? null,
      },
    });

    // 7. Audit
    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "ASSIGN_ASSET",
        entityType: "asset_assignment",
        entityId: created.id,
        newValues: {
          assignmentId: created.id,
          assetId: input.assetId,
          employeeId: input.employeeId,
          departmentId,
          locationId: input.locationId ?? null,
          assignedAt: created.assignedAt,
        },
      },
      tx
    );

    return created;
  });

  return assignment;
}

// ---------------------------------------------------------------------------
// Return asset
// ---------------------------------------------------------------------------

export interface ReturnAssetInput {
  returnCondition: AssetCondition;
  returnNotes?: string;
}

export async function returnAsset(
  assignmentId: string,
  input: ReturnAssetInput,
  initiatorUserId: string
) {
  // Pre-transaction read to discover assetId (not locked — just for lock ordering)
  const preRead = await prisma.assetAssignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, assetId: true, returnedAt: true },
  });
  if (!preRead) throw new AssignmentServiceError("Assignment not found.", "ASSIGNMENT_NOT_FOUND");

  // Fast-fail if already returned (avoids entering a transaction unnecessarily)
  if (preRead.returnedAt !== null) {
    throw new AssignmentServiceError(
      "This assignment has already been returned.",
      "ASSIGNMENT_ALREADY_RETURNED"
    );
  }

  const assetId = preRead.assetId;

  const result = await prisma.$transaction(async (tx) => {
    // 1. Lock asset row FIRST (consistent asset-first ordering)
    const assetRows = await tx.$queryRaw<Array<{
      id: string;
      status: string;
    }>>`
      SELECT "id", "status"
      FROM   "assets"
      WHERE  "id" = ${assetId}::uuid
      FOR UPDATE
    `;
    if (assetRows.length === 0) {
      throw new AssignmentServiceError("Asset not found.", "ASSET_NOT_FOUND");
    }
    const lockedAssetStatus = assetRows[0].status;

    // 2. Lock assignment row SECOND
    const assignmentRows = await tx.$queryRaw<Array<{
      id: string;
      assetId: string;
      employeeId: string;
      departmentId: string | null;
      returnedAt: Date | null;
    }>>`
      SELECT "id", "assetId", "employeeId", "departmentId", "returnedAt"
      FROM   "asset_assignments"
      WHERE  "id" = ${assignmentId}::uuid
      FOR UPDATE
    `;
    if (assignmentRows.length === 0) {
      throw new AssignmentServiceError("Assignment not found.", "ASSIGNMENT_NOT_FOUND");
    }
    const lockedAssignment = assignmentRows[0];

    // 3. Revalidate assignment is still open
    if (lockedAssignment.returnedAt !== null) {
      throw new AssignmentServiceError(
        "This assignment has already been returned.",
        "ASSIGNMENT_ALREADY_RETURNED"
      );
    }

    // 4. Defensive: verify asset is still ASSIGNED
    if (lockedAssetStatus !== "ASSIGNED") {
      throw new AssignmentServiceError(
        `Asset state is inconsistent. Expected ASSIGNED, found: ${lockedAssetStatus}.`,
        "ASSET_STATE_INCONSISTENT"
      );
    }

    const returnedAt = new Date();

    // 5. Update assignment return fields
    const updated = await tx.assetAssignment.update({
      where: { id: assignmentId },
      data: {
        returnedAt,
        returnedByUserId: initiatorUserId,
        returnCondition: input.returnCondition,
        returnNotes: input.returnNotes?.trim() ?? null,
      },
      select: ASSIGNMENT_SELECT,
    });

    // 6. Update asset: restore AVAILABLE, update condition, clear cached fields
    await tx.asset.update({
      where: { id: assetId },
      data: {
        status: "AVAILABLE",
        condition: input.returnCondition,
        currentAssigneeId: null,
        currentDepartmentId: null,
        currentLocationId: null,
      },
    });

    // 7. Audit
    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "RETURN_ASSET",
        entityType: "asset_assignment",
        entityId: assignmentId,
        oldValues: {
          status: "ASSIGNED",
          employeeId: lockedAssignment.employeeId,
          departmentId: lockedAssignment.departmentId,
        },
        newValues: {
          assignmentId,
          assetId,
          returnedAt,
          returnCondition: input.returnCondition,
          returnNotes: input.returnNotes ?? null,
        },
      },
      tx
    );

    return updated;
  });

  return result;
}

// ---------------------------------------------------------------------------
// List assignments
// ---------------------------------------------------------------------------

export interface ListAssignmentsInput {
  assetId?: string;
  employeeId?: string;
  open?: boolean; // true = only open, false = only returned, undefined = all
  dateFrom?: string;
  dateTo?: string;
  sortOrder?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export async function listAssignments(
  input: ListAssignmentsInput
): Promise<PaginationResult<unknown>> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, input.pageSize ?? PAGE_SIZE_DEFAULT));

  const where: Record<string, unknown> = {};
  if (input.assetId) where.assetId = input.assetId;
  if (input.employeeId) where.employeeId = input.employeeId;

  if (input.open === true) {
    where.returnedAt = null;
  } else if (input.open === false) {
    where.returnedAt = { not: null };
  }

  if (input.dateFrom || input.dateTo) {
    const assignedAt: Record<string, Date> = {};
    if (input.dateFrom) assignedAt.gte = new Date(input.dateFrom);
    if (input.dateTo) {
      const to = new Date(input.dateTo);
      to.setDate(to.getDate() + 1);
      assignedAt.lt = to;
    }
    where.assignedAt = assignedAt;
  }

  const sortOrder = input.sortOrder === "asc" ? "asc" : "desc";

  const [rows, total] = await prisma.$transaction([
    prisma.assetAssignment.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { assignedAt: sortOrder },
      select: ASSIGNMENT_SELECT,
    }),
    prisma.assetAssignment.count({ where }),
  ]);

  return buildPaginationResult(rows, total, page, pageSize);
}

// ---------------------------------------------------------------------------
// Get assignment by ID
// ---------------------------------------------------------------------------

export async function getAssignmentById(id: string) {
  const assignment = await prisma.assetAssignment.findUnique({
    where: { id },
    select: ASSIGNMENT_SELECT,
  });
  if (!assignment) throw new AssignmentServiceError("Assignment not found.", "ASSIGNMENT_NOT_FOUND");
  return assignment;
}

// ---------------------------------------------------------------------------
// List assignments for a specific asset
// ---------------------------------------------------------------------------

export async function listAssetAssignments(assetId: string) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { id: true } });
  if (!asset) throw new AssignmentServiceError("Asset not found.", "ASSET_NOT_FOUND");

  const assignments = await prisma.assetAssignment.findMany({
    where: { assetId },
    orderBy: { assignedAt: "desc" },
    select: ASSIGNMENT_SELECT,
  });

  return assignments;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the error is a Prisma P2002 on the
 * asset_assignments_one_open_per_asset partial unique index.
 */
export function isOpenAssignmentConflict(err: unknown): boolean {
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
  const needle = "asset_assignments_one_open_per_asset";
  if (Array.isArray(target)) return target.some((t) => String(t).includes(needle));
  if (typeof target === "string") return target.includes(needle);
  return false;
}
