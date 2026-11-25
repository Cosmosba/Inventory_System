/**
 * Purchase Service — Stage 5.4
 *
 * Covers: purchase CRUD, confirmation, cancellation, and receiving.
 * Receiving runs inside a single interactive transaction that handles
 * serialized asset registration and stock movements atomically.
 */

import prisma from "../config/database.js";
import { writeAuditTx } from "./auditService.js";
import { lockAndReadQuantity } from "./stockService.js";
import { generateAssetTag, MAX_TAG_RETRIES, AssetTagError } from "./assetTagService.js";
import { isAssetTagUniqueViolation } from "./assetService.js";
import { buildPaginationResult, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "../utils/pagination.js";
import type { PaginationResult } from "../utils/pagination.js";
import { Decimal } from "../../generated/prisma/internal/prismaNamespace.js";

export class PurchaseServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "PurchaseServiceError";
  }
}

// ---------------------------------------------------------------------------
// Shared select shapes
// ---------------------------------------------------------------------------

const PURCHASE_ITEM_SELECT = {
  id: true,
  description: true,
  assetCategoryId: true,
  stockItemId: true,
  quantity: true,
  unitCost: true,
  totalCost: true,
  quantityReceived: true,
  createdAt: true,
  assetCategory: { select: { id: true, name: true, tagPrefix: true, isSerialized: true } },
  stockItem: { select: { id: true, name: true, sku: true, unit: true } },
} as const;

const PURCHASE_SELECT = {
  id: true,
  referenceNumber: true,
  vendorId: true,
  purchaseDate: true,
  totalAmount: true,
  status: true,
  documentReference: true,
  notes: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  vendor: { select: { id: true, name: true, isActive: true } },
  purchaseItems: { select: PURCHASE_ITEM_SELECT },
} as const;

const RECEIPT_SELECT = {
  id: true,
  purchaseId: true,
  receivedByUserId: true,
  receivedAt: true,
  documentReference: true,
  notes: true,
  createdAt: true,
  receivedBy: { select: { id: true, username: true } },
  receiptItems: {
    select: {
      id: true,
      purchaseItemId: true,
      quantityReceived: true,
      createdAt: true,
      purchaseItem: { select: { id: true, description: true, assetCategoryId: true, stockItemId: true } },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// List purchases
// ---------------------------------------------------------------------------

export interface ListPurchasesInput {
  search?: string;
  vendorId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

const PURCHASE_SORT_FIELDS: Record<string, string> = {
  referenceNumber: "referenceNumber",
  purchaseDate: "purchaseDate",
  totalAmount: "totalAmount",
  status: "status",
  createdAt: "createdAt",
};

export async function listPurchases(input: ListPurchasesInput): Promise<PaginationResult<unknown>> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, input.pageSize ?? PAGE_SIZE_DEFAULT));

  const where: Record<string, unknown> = {};
  if (input.vendorId) where.vendorId = input.vendorId;
  if (input.status) where.status = input.status;
  if (input.search) {
    const term = input.search.trim();
    where.OR = [
      { referenceNumber: { contains: term, mode: "insensitive" } },
      { notes: { contains: term, mode: "insensitive" } },
      { documentReference: { contains: term, mode: "insensitive" } },
    ];
  }
  if (input.dateFrom || input.dateTo) {
    const purchaseDate: Record<string, Date> = {};
    if (input.dateFrom) purchaseDate.gte = new Date(input.dateFrom);
    if (input.dateTo) purchaseDate.lte = new Date(input.dateTo);
    where.purchaseDate = purchaseDate;
  }

  const sortField = PURCHASE_SORT_FIELDS[input.sortBy ?? ""] ?? "createdAt";
  const sortOrder = input.sortOrder === "asc" ? "asc" : "desc";

  const [rows, total] = await prisma.$transaction([
    prisma.purchase.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { [sortField]: sortOrder },
      select: PURCHASE_SELECT,
    }),
    prisma.purchase.count({ where }),
  ]);

  return buildPaginationResult(rows, total, page, pageSize);
}

// ---------------------------------------------------------------------------
// Get purchase by ID
// ---------------------------------------------------------------------------

export async function getPurchaseById(id: string) {
  const purchase = await prisma.purchase.findUnique({
    where: { id },
    select: {
      ...PURCHASE_SELECT,
      receipts: { select: RECEIPT_SELECT, orderBy: { receivedAt: "desc" } },
    },
  });
  if (!purchase) throw new PurchaseServiceError("Purchase not found.", "PURCHASE_NOT_FOUND");
  return purchase;
}

// ---------------------------------------------------------------------------
// Create purchase
// ---------------------------------------------------------------------------

export interface CreatePurchaseItemInput {
  description: string;
  assetCategoryId?: string;
  stockItemId?: string;
  quantity: number;
  unitCost: number;
}

export interface CreatePurchaseInput {
  referenceNumber: string;
  vendorId: string;
  purchaseDate: string;
  documentReference?: string;
  notes?: string;
  items: CreatePurchaseItemInput[];
}

export async function createPurchase(input: CreatePurchaseInput, initiatorUserId: string) {
  // Validate vendor
  const vendor = await prisma.vendor.findUnique({ where: { id: input.vendorId } });
  if (!vendor) throw new PurchaseServiceError("Vendor not found.", "VENDOR_NOT_FOUND");
  if (!vendor.isActive) throw new PurchaseServiceError("Vendor is inactive.", "VENDOR_INACTIVE");

  // Validate items
  await validatePurchaseItems(input.items);

  const purchase = await prisma.$transaction(async (tx) => {
    // Calculate totals using Decimal arithmetic
    let totalAmount = new Decimal(0);
    const itemsData = input.items.map((item) => {
      const unitCost = new Decimal(item.unitCost);
      const totalCost = unitCost.mul(item.quantity);
      totalAmount = totalAmount.add(totalCost);
      return {
        description: item.description.trim(),
        assetCategoryId: item.assetCategoryId ?? null,
        stockItemId: item.stockItemId ?? null,
        quantity: item.quantity,
        unitCost,
        totalCost,
        quantityReceived: 0,
      };
    });

    const created = await tx.purchase.create({
      data: {
        referenceNumber: input.referenceNumber.trim(),
        vendorId: input.vendorId,
        purchaseDate: new Date(input.purchaseDate),
        totalAmount,
        status: "DRAFT",
        documentReference: input.documentReference?.trim() ?? null,
        notes: input.notes?.trim() ?? null,
        createdByUserId: initiatorUserId,
        purchaseItems: { create: itemsData },
      },
      select: PURCHASE_SELECT,
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "CREATE_PURCHASE",
        entityType: "purchase",
        entityId: created.id,
        newValues: {
          referenceNumber: created.referenceNumber,
          vendorId: created.vendorId,
          status: created.status,
          totalAmount: created.totalAmount.toString(),
          itemCount: input.items.length,
        },
      },
      tx
    );

    return created;
  });

  return purchase;
}

// ---------------------------------------------------------------------------
// Update purchase
// ---------------------------------------------------------------------------

export interface UpdatePurchaseItemInput {
  id?: string; // existing item ID to update; omit to add new
  description: string;
  assetCategoryId?: string;
  stockItemId?: string;
  quantity: number;
  unitCost: number;
}

export interface UpdatePurchaseInput {
  referenceNumber?: string;
  vendorId?: string;
  purchaseDate?: string;
  documentReference?: string | null;
  notes?: string | null;
  items?: UpdatePurchaseItemInput[];
}

export async function updatePurchase(
  id: string,
  input: UpdatePurchaseInput,
  initiatorUserId: string
) {
  const existing = await prisma.purchase.findUnique({
    where: { id },
    include: { purchaseItems: true },
  });
  if (!existing) throw new PurchaseServiceError("Purchase not found.", "PURCHASE_NOT_FOUND");

  if (existing.status === "RECEIVED" || existing.status === "CANCELLED") {
    throw new PurchaseServiceError(
      "Cannot update a received or cancelled purchase.",
      "PURCHASE_NOT_EDITABLE"
    );
  }

  if (existing.status === "CONFIRMED") {
    // Only header-level fields allowed; no item changes
    if (input.items !== undefined) {
      throw new PurchaseServiceError(
        "Purchase items cannot be changed after confirmation.",
        "ITEMS_LOCKED"
      );
    }
    if (input.referenceNumber !== undefined || input.vendorId !== undefined || input.purchaseDate !== undefined) {
      throw new PurchaseServiceError(
        "Reference number, vendor, and purchase date cannot be changed after confirmation.",
        "HEADER_LOCKED"
      );
    }
  }

  if (input.vendorId) {
    const vendor = await prisma.vendor.findUnique({ where: { id: input.vendorId } });
    if (!vendor) throw new PurchaseServiceError("Vendor not found.", "VENDOR_NOT_FOUND");
    if (!vendor.isActive) throw new PurchaseServiceError("Vendor is inactive.", "VENDOR_INACTIVE");
  }

  if (input.items) {
    await validatePurchaseItems(input.items);
  }

  const purchase = await prisma.$transaction(async (tx) => {
    const headerData: Record<string, unknown> = {};
    if (input.referenceNumber !== undefined) headerData.referenceNumber = input.referenceNumber.trim();
    if (input.vendorId !== undefined) headerData.vendorId = input.vendorId;
    if (input.purchaseDate !== undefined) headerData.purchaseDate = new Date(input.purchaseDate);
    if ("documentReference" in input) headerData.documentReference = input.documentReference?.trim() ?? null;
    if ("notes" in input) headerData.notes = input.notes?.trim() ?? null;

    if (input.items !== undefined) {
      // Replace all items: delete existing, create new
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });

      let totalAmount = new Decimal(0);
      const itemsData = input.items.map((item) => {
        const unitCost = new Decimal(item.unitCost);
        const totalCost = unitCost.mul(item.quantity);
        totalAmount = totalAmount.add(totalCost);
        return {
          description: item.description.trim(),
          assetCategoryId: item.assetCategoryId ?? null,
          stockItemId: item.stockItemId ?? null,
          quantity: item.quantity,
          unitCost,
          totalCost,
          quantityReceived: 0,
        };
      });
      headerData.totalAmount = totalAmount;
      headerData.purchaseItems = { create: itemsData };
    }

    const updated = await tx.purchase.update({
      where: { id },
      data: headerData,
      select: PURCHASE_SELECT,
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "UPDATE_PURCHASE",
        entityType: "purchase",
        entityId: id,
        oldValues: { status: existing.status, referenceNumber: existing.referenceNumber },
        newValues: headerData as Record<string, unknown>,
      },
      tx
    );

    return updated;
  });

  return purchase;
}

// ---------------------------------------------------------------------------
// Confirm purchase
// ---------------------------------------------------------------------------

export async function confirmPurchase(id: string, initiatorUserId: string) {
  const existing = await prisma.purchase.findUnique({ where: { id } });
  if (!existing) throw new PurchaseServiceError("Purchase not found.", "PURCHASE_NOT_FOUND");
  if (existing.status !== "DRAFT") {
    throw new PurchaseServiceError(
      "Only DRAFT purchases can be confirmed.",
      "INVALID_STATUS_TRANSITION"
    );
  }

  const purchase = await prisma.$transaction(async (tx) => {
    const updated = await tx.purchase.update({
      where: { id },
      data: { status: "CONFIRMED" },
      select: PURCHASE_SELECT,
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "CONFIRM_PURCHASE",
        entityType: "purchase",
        entityId: id,
        oldValues: { status: "DRAFT" },
        newValues: { status: "CONFIRMED" },
      },
      tx
    );

    return updated;
  });

  return purchase;
}

// ---------------------------------------------------------------------------
// Cancel purchase
// ---------------------------------------------------------------------------

export async function cancelPurchase(id: string, initiatorUserId: string) {
  const existing = await prisma.purchase.findUnique({ where: { id } });
  if (!existing) throw new PurchaseServiceError("Purchase not found.", "PURCHASE_NOT_FOUND");

  if (existing.status === "RECEIVED") {
    throw new PurchaseServiceError("A received purchase cannot be cancelled.", "INVALID_STATUS_TRANSITION");
  }
  if (existing.status === "CANCELLED") {
    throw new PurchaseServiceError("Purchase is already cancelled.", "ALREADY_CANCELLED");
  }

  // Check nothing has been received
  const receivedCount = await prisma.purchaseItem.count({
    where: { purchaseId: id, quantityReceived: { gt: 0 } },
  });
  if (receivedCount > 0) {
    throw new PurchaseServiceError(
      "Cannot cancel a purchase that has already had items received.",
      "HAS_RECEIPTS"
    );
  }

  const purchase = await prisma.$transaction(async (tx) => {
    const updated = await tx.purchase.update({
      where: { id },
      data: { status: "CANCELLED" },
      select: PURCHASE_SELECT,
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "CANCEL_PURCHASE",
        entityType: "purchase",
        entityId: id,
        oldValues: { status: existing.status },
        newValues: { status: "CANCELLED" },
      },
      tx
    );

    return updated;
  });

  return purchase;
}

// ---------------------------------------------------------------------------
// Receive purchase items
// ---------------------------------------------------------------------------

export interface ReceiveLineInput {
  purchaseItemId: string;
  quantityReceived: number;
  /** For serialized items: serial numbers (one per unit). Optional. */
  serialNumbers?: string[];
}

export interface ReceivePurchaseInput {
  lines: ReceiveLineInput[];
  documentReference?: string;
  notes?: string;
}

export async function receivePurchase(
  purchaseId: string,
  input: ReceivePurchaseInput,
  initiatorUserId: string
) {
  if (input.lines.length === 0) {
    throw new PurchaseServiceError("At least one receiving line is required.", "EMPTY_LINES");
  }

  // Reject duplicate purchaseItemIds in the same request
  const lineIds = input.lines.map((l) => l.purchaseItemId);
  if (new Set(lineIds).size !== lineIds.length) {
    throw new PurchaseServiceError(
      "Duplicate purchase item IDs in the same receiving request.",
      "DUPLICATE_LINES"
    );
  }

  // Reject zero/negative quantities
  for (const line of input.lines) {
    if (line.quantityReceived <= 0) {
      throw new PurchaseServiceError(
        "Receiving quantity must be greater than zero.",
        "INVALID_QUANTITY"
      );
    }
  }

  // Sort lines by purchaseItemId for deterministic lock ordering
  const sortedLines = [...input.lines].sort((a, b) =>
    a.purchaseItemId.localeCompare(b.purchaseItemId)
  );

  const result = await prisma.$transaction(async (tx) => {
    // 1. Validate purchase state
    const purchase = await tx.purchase.findUnique({
      where: { id: purchaseId },
      select: { id: true, status: true, purchaseDate: true },
    });
    if (!purchase) throw new PurchaseServiceError("Purchase not found.", "PURCHASE_NOT_FOUND");
    if (purchase.status !== "CONFIRMED") {
      throw new PurchaseServiceError(
        "Only CONFIRMED purchases can receive items.",
        "PURCHASE_NOT_CONFIRMED"
      );
    }

    // 2. Lock and validate purchase items (deterministic order)
    const lockedItems = await Promise.all(
      sortedLines.map(async (line) => {
        const rows = await tx.$queryRaw<Array<{
          id: string;
          purchaseId: string;
          assetCategoryId: string | null;
          stockItemId: string | null;
          quantity: number;
          quantityReceived: number;
          unitCost: string;
          description: string;
        }>>`
          SELECT id, "purchaseId", "assetCategoryId", "stockItemId",
                 quantity, "quantityReceived", "unitCost"::text, description
          FROM   purchase_items
          WHERE  id = ${line.purchaseItemId}::uuid
          FOR UPDATE
        `;
        if (rows.length === 0) {
          throw new PurchaseServiceError(
            `Purchase item ${line.purchaseItemId} not found.`,
            "PURCHASE_ITEM_NOT_FOUND"
          );
        }
        const item = rows[0];
        if (item.purchaseId !== purchaseId) {
          throw new PurchaseServiceError(
            `Purchase item ${line.purchaseItemId} does not belong to this purchase.`,
            "PURCHASE_ITEM_MISMATCH"
          );
        }
        const remaining = item.quantity - item.quantityReceived;
        if (line.quantityReceived > remaining) {
          throw new PurchaseServiceError(
            `Cannot receive ${line.quantityReceived} units for item "${item.description}". Remaining: ${remaining}.`,
            "OVER_RECEIVING"
          );
        }
        return { line, item };
      })
    );

    // 3. Create PurchaseReceipt
    const receipt = await tx.purchaseReceipt.create({
      data: {
        purchaseId,
        receivedByUserId: initiatorUserId,
        documentReference: input.documentReference?.trim() ?? null,
        notes: input.notes?.trim() ?? null,
      },
      select: { id: true, receivedAt: true },
    });

    // 4. Process each line
    for (const { line, item } of lockedItems) {
      // Create PurchaseReceiptItem
      const receiptItem = await tx.purchaseReceiptItem.create({
        data: {
          receiptId: receipt.id,
          purchaseItemId: item.id,
          quantityReceived: line.quantityReceived,
        },
        select: { id: true },
      });

      if (item.assetCategoryId !== null) {
        // Serialized asset path
        const category = await tx.assetCategory.findUnique({
          where: { id: item.assetCategoryId },
          select: { id: true, isSerialized: true, tagPrefix: true, name: true },
        });
        if (!category) {
          throw new PurchaseServiceError("Asset category not found.", "CATEGORY_NOT_FOUND");
        }
        if (!category.isSerialized) {
          throw new PurchaseServiceError(
            "Purchase item references a non-serialized category.",
            "CATEGORY_NOT_SERIALIZED"
          );
        }
        if (!category.tagPrefix) {
          throw new PurchaseServiceError(
            "Asset category has no tag prefix configured.",
            "MISSING_PREFIX"
          );
        }

        const serialNumbers = line.serialNumbers ?? [];
        const year = new Date().getFullYear();

        for (let i = 0; i < line.quantityReceived; i++) {
          const serialNumber = serialNumbers[i]?.trim() ?? null;

          // Tag generation with retry loop
          let assetCreated = false;
          let lastTagError: unknown;
          for (let attempt = 0; attempt < MAX_TAG_RETRIES; attempt++) {
            // Sequence allocation must happen outside the outer tx to commit immediately.
            // We call generateAssetTag which opens its own nested transaction for the sequence.
            const assetTag = await generateAssetTag(item.assetCategoryId!, category.tagPrefix!, year);

            try {
              const asset = await tx.asset.create({
                data: {
                  assetTag,
                  serialNumber,
                  name: item.description.trim(),
                  categoryId: item.assetCategoryId!,
                  purchaseItemId: item.id,
                  receiptItemId: receiptItem.id,
                  purchaseDate: purchase.purchaseDate,
                  purchaseCost: new Decimal(item.unitCost),
                  condition: "NEW",
                  status: "AVAILABLE",
                },
                select: { id: true, assetTag: true },
              });

              await writeAuditTx(
                {
                  userId: initiatorUserId,
                  action: "REGISTER_ASSET",
                  entityType: "asset",
                  entityId: asset.id,
                  newValues: {
                    assetTag: asset.assetTag,
                    categoryId: item.assetCategoryId,
                    purchaseItemId: item.id,
                    receiptItemId: receiptItem.id,
                    condition: "NEW",
                    status: "AVAILABLE",
                  },
                },
                tx
              );

              assetCreated = true;
              break;
            } catch (err) {
              if (isAssetTagUniqueViolation(err)) {
                lastTagError = err;
                continue;
              }
              throw err;
            }
          }

          if (!assetCreated) {
            throw new PurchaseServiceError(
              `Failed to generate a unique asset tag after ${MAX_TAG_RETRIES} attempts.`,
              "TAG_COLLISION_EXHAUSTED"
            );
          }
        }
      } else if (item.stockItemId !== null) {
        // Stock-managed path
        const { currentQuantity } = await lockAndReadQuantity(item.stockItemId, tx);

        const quantityBefore = currentQuantity;
        const quantityAfter = quantityBefore + line.quantityReceived;

        const movement = await tx.stockMovement.create({
          data: {
            stockItemId: item.stockItemId,
            movementType: "PURCHASE",
            quantity: line.quantityReceived,
            quantityBefore,
            quantityAfter,
            purchaseItemId: item.id,
            receiptItemId: receiptItem.id,
            performedByUserId: initiatorUserId,
            notes: input.notes?.trim() ?? null,
          },
          select: { id: true },
        });

        await tx.stockItem.update({
          where: { id: item.stockItemId },
          data: { currentQuantity: quantityAfter },
        });

        await writeAuditTx(
          {
            userId: initiatorUserId,
            action: "PURCHASE_STOCK",
            entityType: "stock_item",
            entityId: item.stockItemId,
            oldValues: { currentQuantity: quantityBefore },
            newValues: {
              currentQuantity: quantityAfter,
              movementId: movement.id,
              quantity: line.quantityReceived,
              purchaseItemId: item.id,
              receiptItemId: receiptItem.id,
            },
          },
          tx
        );
      }

      // 5. Update quantityReceived on the purchase item
      await tx.purchaseItem.update({
        where: { id: item.id },
        data: { quantityReceived: { increment: line.quantityReceived } },
      });
    }

    // 6. Recalculate purchase status
    const allItems = await tx.purchaseItem.findMany({
      where: { purchaseId },
      select: { quantity: true, quantityReceived: true },
    });
    // Re-read updated quantities for accurate check
    const updatedItems = await tx.purchaseItem.findMany({
      where: { purchaseId },
      select: { quantity: true, quantityReceived: true },
    });
    const fullyReceived = updatedItems.every((i) => i.quantityReceived >= i.quantity);

    if (fullyReceived) {
      await tx.purchase.update({
        where: { id: purchaseId },
        data: { status: "RECEIVED" },
      });

      await writeAuditTx(
        {
          userId: initiatorUserId,
          action: "COMPLETE_PURCHASE",
          entityType: "purchase",
          entityId: purchaseId,
          oldValues: { status: "CONFIRMED" },
          newValues: { status: "RECEIVED" },
        },
        tx
      );
    }

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "RECEIVE_PURCHASE",
        entityType: "purchase",
        entityId: purchaseId,
        newValues: {
          receiptId: receipt.id,
          lineCount: input.lines.length,
          fullyReceived,
        },
      },
      tx
    );

    return {
      receiptId: receipt.id,
      receivedAt: receipt.receivedAt,
      fullyReceived,
    };
  });

  return result;
}

// ---------------------------------------------------------------------------
// Receipt history
// ---------------------------------------------------------------------------

export async function listReceipts(purchaseId: string) {
  const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId }, select: { id: true } });
  if (!purchase) throw new PurchaseServiceError("Purchase not found.", "PURCHASE_NOT_FOUND");

  const receipts = await prisma.purchaseReceipt.findMany({
    where: { purchaseId },
    orderBy: { receivedAt: "desc" },
    select: RECEIPT_SELECT,
  });

  return receipts;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function validatePurchaseItems(items: Array<{ assetCategoryId?: string; stockItemId?: string; quantity: number; unitCost: number }>) {
  if (items.length === 0) {
    throw new PurchaseServiceError("At least one purchase item is required.", "NO_ITEMS");
  }

  for (const item of items) {
    const hasCategory = !!item.assetCategoryId;
    const hasStock = !!item.stockItemId;

    if (hasCategory === hasStock) {
      throw new PurchaseServiceError(
        "Each purchase item must have exactly one of assetCategoryId or stockItemId.",
        "INVALID_ITEM_TYPE"
      );
    }

    if (item.quantity <= 0) {
      throw new PurchaseServiceError("Item quantity must be greater than zero.", "INVALID_QUANTITY");
    }
    if (item.unitCost < 0) {
      throw new PurchaseServiceError("Item unit cost must be non-negative.", "INVALID_UNIT_COST");
    }

    if (hasCategory) {
      const cat = await prisma.assetCategory.findUnique({ where: { id: item.assetCategoryId! } });
      if (!cat) throw new PurchaseServiceError("Asset category not found.", "CATEGORY_NOT_FOUND");
    }
    if (hasStock) {
      const si = await prisma.stockItem.findUnique({ where: { id: item.stockItemId! } });
      if (!si) throw new PurchaseServiceError("Stock item not found.", "STOCK_ITEM_NOT_FOUND");
    }
  }
}

export function isPrismaUniqueError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}
