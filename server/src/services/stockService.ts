/**
 * Stock Service — Stage 5.3
 *
 * Covers: stock item CRUD, stock movements (ISSUE, RETURN, ADJUSTMENT, DISPOSAL),
 * movement history, and low-stock monitoring.
 *
 * PURCHASE movements belong to Stage 5.4 (purchase-based receiving).
 *
 * Concurrency strategy for movements:
 *   - Every movement opens a $transaction interactive callback.
 *   - Inside the transaction, the stock_items row is locked with
 *     SELECT ... FOR UPDATE via $queryRaw before reading currentQuantity.
 *   - This prevents two concurrent ISSUE operations from both reading the
 *     same stale balance and producing a negative quantity.
 *   - The movement record and the cached quantity update are committed
 *     atomically with the audit log entry.
 */

import prisma from "../config/database.js";
import { writeAuditTx } from "./auditService.js";
import { buildPaginationResult, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "../utils/pagination.js";
import type { PaginationResult } from "../utils/pagination.js";
import type { StockMovementType } from "../../generated/prisma/enums.js";

export class StockServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "StockServiceError";
  }
}

// ---------------------------------------------------------------------------
// Shared select shapes
// ---------------------------------------------------------------------------

const STOCK_ITEM_SELECT = {
  id: true,
  name: true,
  sku: true,
  categoryId: true,
  unit: true,
  currentQuantity: true,
  minimumQuantity: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, isSerialized: true } },
} as const;

const MOVEMENT_SELECT = {
  id: true,
  stockItemId: true,
  movementType: true,
  quantity: true,
  quantityBefore: true,
  quantityAfter: true,
  purchaseItemId: true,
  issuedToEmployeeId: true,
  issuedToDepartmentId: true,
  reference: true,
  notes: true,
  performedByUserId: true,
  createdAt: true,
  stockItem: { select: { id: true, name: true, sku: true, unit: true } },
  issuedToEmployee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
  issuedToDepartment: { select: { id: true, name: true, code: true } },
  performedBy: { select: { id: true, username: true } },
} as const;

// ---------------------------------------------------------------------------
// Stock Item — List
// ---------------------------------------------------------------------------

export interface ListStockItemsInput {
  search?: string;
  categoryId?: string;
  lowStock?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listStockItems(
  input: ListStockItemsInput
): Promise<PaginationResult<unknown>> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, input.pageSize ?? PAGE_SIZE_DEFAULT));

  // Low-stock: currentQuantity <= minimumQuantity AND minimumQuantity > 0
  // Prisma does not support column-to-column comparisons in where clauses.
  // For the low-stock filter we fetch all matching items (bounded by the
  // non-low-stock path's normal filters) and apply the column comparison
  // in the application layer. Stock item counts are small enough that this
  // is safe; a future migration could add a computed column if needed.
  if (input.lowStock === true) {
    const where: Record<string, unknown> = { minimumQuantity: { gt: 0 } };
    if (input.categoryId) where.categoryId = input.categoryId;
    if (input.search) {
      const term = input.search.trim();
      where.OR = [
        { name: { contains: term, mode: "insensitive" } },
        { sku: { contains: term, mode: "insensitive" } },
      ];
    }

    // Fetch all candidates with minimumQuantity > 0, then filter in JS.
    // This is safe because minimumQuantity > 0 already bounds the set.
    const candidates = await prisma.stockItem.findMany({
      where,
      orderBy: { name: "asc" },
      select: STOCK_ITEM_SELECT,
    });

    const lowStockItems = candidates.filter(
      (item) => item.currentQuantity <= item.minimumQuantity
    );

    const total = lowStockItems.length;
    const paged = lowStockItems.slice((page - 1) * pageSize, page * pageSize);
    return buildPaginationResult(paged, total, page, pageSize);
  }

  const where: Record<string, unknown> = {};
  if (input.categoryId) where.categoryId = input.categoryId;
  if (input.search) {
    const term = input.search.trim();
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { sku: { contains: term, mode: "insensitive" } },
      { notes: { contains: term, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await prisma.$transaction([
    prisma.stockItem.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { name: "asc" },
      select: STOCK_ITEM_SELECT,
    }),
    prisma.stockItem.count({ where }),
  ]);

  return buildPaginationResult(rows, total, page, pageSize);
}

// ---------------------------------------------------------------------------
// Stock Item — Get by ID
// ---------------------------------------------------------------------------

export async function getStockItemById(id: string) {
  const item = await prisma.stockItem.findUnique({
    where: { id },
    select: {
      ...STOCK_ITEM_SELECT,
      _count: { select: { stockMovements: true } },
    },
  });
  if (!item) throw new StockServiceError("Stock item not found.", "STOCK_ITEM_NOT_FOUND");
  return item;
}

// ---------------------------------------------------------------------------
// Stock Item — Create
// ---------------------------------------------------------------------------

export interface CreateStockItemInput {
  name: string;
  sku: string;
  categoryId?: string;
  unit?: string;
  minimumQuantity?: number;
  notes?: string;
}

export async function createStockItem(
  input: CreateStockItemInput,
  initiatorUserId: string
) {
  if (input.categoryId) {
    const cat = await prisma.assetCategory.findUnique({ where: { id: input.categoryId } });
    if (!cat) throw new StockServiceError("Asset category not found.", "CATEGORY_NOT_FOUND");
    if (cat.isSerialized) {
      throw new StockServiceError(
        "Stock items must belong to a non-serialized asset category.",
        "CATEGORY_SERIALIZED"
      );
    }
  }

  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.stockItem.create({
      data: {
        name: input.name.trim(),
        sku: input.sku.trim().toUpperCase(),
        categoryId: input.categoryId ?? null,
        unit: input.unit?.trim() ?? "piece",
        currentQuantity: 0,
        minimumQuantity: input.minimumQuantity ?? 0,
        notes: input.notes?.trim() ?? null,
      },
      select: STOCK_ITEM_SELECT,
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "CREATE_STOCK_ITEM",
        entityType: "stock_item",
        entityId: created.id,
        newValues: { name: created.name, sku: created.sku, unit: created.unit, minimumQuantity: created.minimumQuantity },
      },
      tx
    );

    return created;
  });

  return item;
}

// ---------------------------------------------------------------------------
// Stock Item — Update
// ---------------------------------------------------------------------------

export interface UpdateStockItemInput {
  name?: string;
  categoryId?: string | null;
  unit?: string;
  minimumQuantity?: number;
  notes?: string | null;
}

export async function updateStockItem(
  id: string,
  input: UpdateStockItemInput,
  initiatorUserId: string
) {
  const existing = await prisma.stockItem.findUnique({ where: { id } });
  if (!existing) throw new StockServiceError("Stock item not found.", "STOCK_ITEM_NOT_FOUND");

  if (input.categoryId) {
    const cat = await prisma.assetCategory.findUnique({ where: { id: input.categoryId } });
    if (!cat) throw new StockServiceError("Asset category not found.", "CATEGORY_NOT_FOUND");
    if (cat.isSerialized) {
      throw new StockServiceError(
        "Stock items must belong to a non-serialized asset category.",
        "CATEGORY_SERIALIZED"
      );
    }
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if ("categoryId" in input) data.categoryId = input.categoryId ?? null;
  if (input.unit !== undefined) data.unit = input.unit.trim();
  if (input.minimumQuantity !== undefined) data.minimumQuantity = input.minimumQuantity;
  if ("notes" in input) data.notes = input.notes?.trim() ?? null;

  const item = await prisma.$transaction(async (tx) => {
    const updated = await tx.stockItem.update({
      where: { id },
      data,
      select: STOCK_ITEM_SELECT,
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "UPDATE_STOCK_ITEM",
        entityType: "stock_item",
        entityId: id,
        oldValues: { name: existing.name, unit: existing.unit, minimumQuantity: existing.minimumQuantity },
        newValues: data as Record<string, unknown>,
      },
      tx
    );

    return updated;
  });

  return item;
}

// ---------------------------------------------------------------------------
// Stock Movement — shared locked-read helper
// ---------------------------------------------------------------------------

/**
 * Lock the stock_items row and return its current quantity.
 * Must be called inside a $transaction interactive callback.
 */
export async function lockAndReadQuantity(
  stockItemId: string,
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
): Promise<{ currentQuantity: number }> {
  const rows = await tx.$queryRaw<Array<{ currentQuantity: number }>>`
    SELECT "currentQuantity"
    FROM   "stock_items"
    WHERE  "id" = ${stockItemId}::uuid
    FOR UPDATE
  `;
  if (rows.length === 0) throw new StockServiceError("Stock item not found.", "STOCK_ITEM_NOT_FOUND");
  return { currentQuantity: Number(rows[0].currentQuantity) };
}

// ---------------------------------------------------------------------------
// Stock Movement — Issue
// ---------------------------------------------------------------------------

export interface IssueStockInput {
  stockItemId: string;
  quantity: number; // positive — stored as negative in movement
  issuedToEmployeeId?: string;
  issuedToDepartmentId?: string;
  reference?: string;
  notes?: string;
}

export async function issueStock(input: IssueStockInput, initiatorUserId: string) {
  if (input.quantity <= 0) {
    throw new StockServiceError("Issue quantity must be a positive number.", "INVALID_QUANTITY");
  }

  if (input.issuedToEmployeeId) {
    const emp = await prisma.employee.findUnique({ where: { id: input.issuedToEmployeeId } });
    if (!emp) throw new StockServiceError("Employee not found.", "EMPLOYEE_NOT_FOUND");
  }
  if (input.issuedToDepartmentId) {
    const dept = await prisma.department.findUnique({ where: { id: input.issuedToDepartmentId } });
    if (!dept) throw new StockServiceError("Department not found.", "DEPARTMENT_NOT_FOUND");
  }

  return await prisma.$transaction(async (tx) => {
    const { currentQuantity } = await lockAndReadQuantity(input.stockItemId, tx);

    if (currentQuantity < input.quantity) {
      throw new StockServiceError(
        `Insufficient stock. Available: ${currentQuantity}, requested: ${input.quantity}.`,
        "INSUFFICIENT_STOCK"
      );
    }

    const quantityBefore = currentQuantity;
    const movementQty = -input.quantity; // ISSUE is negative
    const quantityAfter = quantityBefore + movementQty;

    const movement = await tx.stockMovement.create({
      data: {
        stockItemId: input.stockItemId,
        movementType: "ISSUE",
        quantity: movementQty,
        quantityBefore,
        quantityAfter,
        issuedToEmployeeId: input.issuedToEmployeeId ?? null,
        issuedToDepartmentId: input.issuedToDepartmentId ?? null,
        reference: input.reference?.trim() ?? null,
        notes: input.notes?.trim() ?? null,
        performedByUserId: initiatorUserId,
      },
      select: MOVEMENT_SELECT,
    });

    await tx.stockItem.update({
      where: { id: input.stockItemId },
      data: { currentQuantity: quantityAfter },
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "ISSUE_STOCK",
        entityType: "stock_item",
        entityId: input.stockItemId,
        oldValues: { currentQuantity: quantityBefore },
        newValues: {
          currentQuantity: quantityAfter,
          movementId: movement.id,
          quantity: movementQty,
          issuedToEmployeeId: input.issuedToEmployeeId,
          issuedToDepartmentId: input.issuedToDepartmentId,
        },
      },
      tx
    );

    return movement;
  });
}

// ---------------------------------------------------------------------------
// Stock Movement — Return
// ---------------------------------------------------------------------------

export interface ReturnStockInput {
  stockItemId: string;
  quantity: number; // positive
  issuedToEmployeeId?: string;
  issuedToDepartmentId?: string;
  reference?: string;
  notes?: string;
}

export async function returnStock(input: ReturnStockInput, initiatorUserId: string) {
  if (input.quantity <= 0) {
    throw new StockServiceError("Return quantity must be a positive number.", "INVALID_QUANTITY");
  }

  if (input.issuedToEmployeeId) {
    const emp = await prisma.employee.findUnique({ where: { id: input.issuedToEmployeeId } });
    if (!emp) throw new StockServiceError("Employee not found.", "EMPLOYEE_NOT_FOUND");
  }
  if (input.issuedToDepartmentId) {
    const dept = await prisma.department.findUnique({ where: { id: input.issuedToDepartmentId } });
    if (!dept) throw new StockServiceError("Department not found.", "DEPARTMENT_NOT_FOUND");
  }

  return await prisma.$transaction(async (tx) => {
    const { currentQuantity } = await lockAndReadQuantity(input.stockItemId, tx);

    const quantityBefore = currentQuantity;
    const movementQty = input.quantity; // RETURN is positive
    const quantityAfter = quantityBefore + movementQty;

    const movement = await tx.stockMovement.create({
      data: {
        stockItemId: input.stockItemId,
        movementType: "RETURN",
        quantity: movementQty,
        quantityBefore,
        quantityAfter,
        issuedToEmployeeId: input.issuedToEmployeeId ?? null,
        issuedToDepartmentId: input.issuedToDepartmentId ?? null,
        reference: input.reference?.trim() ?? null,
        notes: input.notes?.trim() ?? null,
        performedByUserId: initiatorUserId,
      },
      select: MOVEMENT_SELECT,
    });

    await tx.stockItem.update({
      where: { id: input.stockItemId },
      data: { currentQuantity: quantityAfter },
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "RETURN_STOCK",
        entityType: "stock_item",
        entityId: input.stockItemId,
        oldValues: { currentQuantity: quantityBefore },
        newValues: { currentQuantity: quantityAfter, movementId: movement.id, quantity: movementQty },
      },
      tx
    );

    return movement;
  });
}

// ---------------------------------------------------------------------------
// Stock Movement — Adjustment
// ---------------------------------------------------------------------------

export interface AdjustStockInput {
  stockItemId: string;
  quantity: number; // signed: positive = add, negative = remove
  reference?: string;
  notes?: string;
}

export async function adjustStock(input: AdjustStockInput, initiatorUserId: string) {
  if (input.quantity === 0) {
    throw new StockServiceError("Adjustment quantity must not be zero.", "INVALID_QUANTITY");
  }

  return await prisma.$transaction(async (tx) => {
    const { currentQuantity } = await lockAndReadQuantity(input.stockItemId, tx);

    const quantityBefore = currentQuantity;
    const quantityAfter = quantityBefore + input.quantity;

    if (quantityAfter < 0) {
      throw new StockServiceError(
        `Adjustment would result in negative stock. Current: ${quantityBefore}, adjustment: ${input.quantity}.`,
        "INSUFFICIENT_STOCK"
      );
    }

    const movement = await tx.stockMovement.create({
      data: {
        stockItemId: input.stockItemId,
        movementType: "ADJUSTMENT",
        quantity: input.quantity,
        quantityBefore,
        quantityAfter,
        reference: input.reference?.trim() ?? null,
        notes: input.notes?.trim() ?? null,
        performedByUserId: initiatorUserId,
      },
      select: MOVEMENT_SELECT,
    });

    await tx.stockItem.update({
      where: { id: input.stockItemId },
      data: { currentQuantity: quantityAfter },
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "ADJUST_STOCK",
        entityType: "stock_item",
        entityId: input.stockItemId,
        oldValues: { currentQuantity: quantityBefore },
        newValues: { currentQuantity: quantityAfter, movementId: movement.id, quantity: input.quantity },
      },
      tx
    );

    return movement;
  });
}

// ---------------------------------------------------------------------------
// Stock Movement — Disposal
// ---------------------------------------------------------------------------

export interface DisposeStockInput {
  stockItemId: string;
  quantity: number; // positive — stored as negative in movement
  reference?: string;
  notes?: string;
}

export async function disposeStock(input: DisposeStockInput, initiatorUserId: string) {
  if (input.quantity <= 0) {
    throw new StockServiceError("Disposal quantity must be a positive number.", "INVALID_QUANTITY");
  }

  return await prisma.$transaction(async (tx) => {
    const { currentQuantity } = await lockAndReadQuantity(input.stockItemId, tx);

    if (currentQuantity < input.quantity) {
      throw new StockServiceError(
        `Insufficient stock for disposal. Available: ${currentQuantity}, requested: ${input.quantity}.`,
        "INSUFFICIENT_STOCK"
      );
    }

    const quantityBefore = currentQuantity;
    const movementQty = -input.quantity; // DISPOSAL is negative
    const quantityAfter = quantityBefore + movementQty;

    const movement = await tx.stockMovement.create({
      data: {
        stockItemId: input.stockItemId,
        movementType: "DISPOSAL",
        quantity: movementQty,
        quantityBefore,
        quantityAfter,
        reference: input.reference?.trim() ?? null,
        notes: input.notes?.trim() ?? null,
        performedByUserId: initiatorUserId,
      },
      select: MOVEMENT_SELECT,
    });

    await tx.stockItem.update({
      where: { id: input.stockItemId },
      data: { currentQuantity: quantityAfter },
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "DISPOSE_STOCK",
        entityType: "stock_item",
        entityId: input.stockItemId,
        oldValues: { currentQuantity: quantityBefore },
        newValues: { currentQuantity: quantityAfter, movementId: movement.id, quantity: movementQty },
      },
      tx
    );

    return movement;
  });
}

// ---------------------------------------------------------------------------
// Movement History — List
// ---------------------------------------------------------------------------

export interface ListMovementsInput {
  stockItemId?: string;
  movementType?: StockMovementType;
  issuedToEmployeeId?: string;
  issuedToDepartmentId?: string;
  dateFrom?: string;
  dateTo?: string;
  sortOrder?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export async function listMovements(
  input: ListMovementsInput
): Promise<PaginationResult<unknown>> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, input.pageSize ?? PAGE_SIZE_DEFAULT));

  const where: Record<string, unknown> = {};
  if (input.stockItemId) where.stockItemId = input.stockItemId;
  if (input.movementType) where.movementType = input.movementType;
  if (input.issuedToEmployeeId) where.issuedToEmployeeId = input.issuedToEmployeeId;
  if (input.issuedToDepartmentId) where.issuedToDepartmentId = input.issuedToDepartmentId;

  if (input.dateFrom || input.dateTo) {
    const createdAt: Record<string, Date> = {};
    if (input.dateFrom) createdAt.gte = new Date(input.dateFrom);
    if (input.dateTo) {
      const to = new Date(input.dateTo);
      to.setDate(to.getDate() + 1); // inclusive end
      createdAt.lt = to;
    }
    where.createdAt = createdAt;
  }

  const sortOrder = input.sortOrder === "asc" ? "asc" : "desc";

  const [rows, total] = await prisma.$transaction([
    prisma.stockMovement.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: sortOrder },
      select: MOVEMENT_SELECT,
    }),
    prisma.stockMovement.count({ where }),
  ]);

  return buildPaginationResult(rows, total, page, pageSize);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isPrismaUniqueError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}
