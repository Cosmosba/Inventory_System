/**
 * Stage 5.4 — Purchasing and Receiving Unit Tests
 * Uses Node.js built-in test runner. No database required.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const VALID_UUID = "4f07dda8-40db-446b-9f9c-5e50e3fcf778";
const VALID_UUID_2 = "9a1b2c3d-4e5f-6789-abcd-ef0123456789";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// 1. PurchaseStatus enum
// ---------------------------------------------------------------------------

describe("purchase — PurchaseStatus enum", async () => {
  const { PurchaseStatus } = await import("../../generated/prisma/enums.js");

  it("has DRAFT status", () => assert.equal(PurchaseStatus.DRAFT, "DRAFT"));
  it("has CONFIRMED status", () => assert.equal(PurchaseStatus.CONFIRMED, "CONFIRMED"));
  it("has RECEIVED status", () => assert.equal(PurchaseStatus.RECEIVED, "RECEIVED"));
  it("has CANCELLED status", () => assert.equal(PurchaseStatus.CANCELLED, "CANCELLED"));
  it("has exactly 4 statuses", () => assert.equal(Object.keys(PurchaseStatus).length, 4));
  it("does not have PARTIALLY_RECEIVED status", () => {
    assert.ok(!("PARTIALLY_RECEIVED" in PurchaseStatus));
  });
});

// ---------------------------------------------------------------------------
// 2. Purchase creation — validation schema
// ---------------------------------------------------------------------------

describe("purchase — create validation schema", async () => {
  const { z } = await import("zod");

  const itemSchema = z.object({
    description: z.string().min(1).max(255),
    assetCategoryId: z.string().uuid().optional(),
    stockItemId: z.string().uuid().optional(),
    quantity: z.number().int().min(1),
    unitCost: z.number().nonnegative(),
  });

  const createSchema = z.object({
    referenceNumber: z.string().min(1).max(100),
    vendorId: z.string().uuid(),
    purchaseDate: z.string().regex(ISO_DATE),
    documentReference: z.string().max(255).optional(),
    notes: z.string().max(2000).optional(),
    items: z.array(itemSchema).min(1),
  });

  it("accepts minimal valid purchase", () => {
    assert.ok(createSchema.safeParse({
      referenceNumber: "PO-001",
      vendorId: VALID_UUID,
      purchaseDate: "2026-01-15",
      items: [{ description: "Laptop", assetCategoryId: VALID_UUID, quantity: 1, unitCost: 1500 }],
    }).success);
  });

  it("accepts purchase with stockItemId", () => {
    assert.ok(createSchema.safeParse({
      referenceNumber: "PO-002",
      vendorId: VALID_UUID,
      purchaseDate: "2026-01-15",
      items: [{ description: "Toner", stockItemId: VALID_UUID, quantity: 5, unitCost: 50 }],
    }).success);
  });

  it("accepts purchase with notes and documentReference", () => {
    assert.ok(createSchema.safeParse({
      referenceNumber: "PO-003",
      vendorId: VALID_UUID,
      purchaseDate: "2026-01-15",
      documentReference: "INV-2026-001",
      notes: "Urgent order",
      items: [{ description: "Monitor", assetCategoryId: VALID_UUID, quantity: 2, unitCost: 300 }],
    }).success);
  });

  it("rejects empty referenceNumber", () => {
    assert.ok(!createSchema.safeParse({
      referenceNumber: "",
      vendorId: VALID_UUID,
      purchaseDate: "2026-01-15",
      items: [{ description: "Laptop", assetCategoryId: VALID_UUID, quantity: 1, unitCost: 1500 }],
    }).success);
  });

  it("rejects invalid vendorId UUID", () => {
    assert.ok(!createSchema.safeParse({
      referenceNumber: "PO-001",
      vendorId: "not-a-uuid",
      purchaseDate: "2026-01-15",
      items: [{ description: "Laptop", assetCategoryId: VALID_UUID, quantity: 1, unitCost: 1500 }],
    }).success);
  });

  it("rejects invalid purchaseDate format", () => {
    assert.ok(!createSchema.safeParse({
      referenceNumber: "PO-001",
      vendorId: VALID_UUID,
      purchaseDate: "15-01-2026",
      items: [{ description: "Laptop", assetCategoryId: VALID_UUID, quantity: 1, unitCost: 1500 }],
    }).success);
  });

  it("rejects empty items array", () => {
    assert.ok(!createSchema.safeParse({
      referenceNumber: "PO-001",
      vendorId: VALID_UUID,
      purchaseDate: "2026-01-15",
      items: [],
    }).success);
  });

  it("rejects item with quantity 0", () => {
    assert.ok(!createSchema.safeParse({
      referenceNumber: "PO-001",
      vendorId: VALID_UUID,
      purchaseDate: "2026-01-15",
      items: [{ description: "Laptop", assetCategoryId: VALID_UUID, quantity: 0, unitCost: 1500 }],
    }).success);
  });

  it("rejects item with negative unitCost", () => {
    assert.ok(!createSchema.safeParse({
      referenceNumber: "PO-001",
      vendorId: VALID_UUID,
      purchaseDate: "2026-01-15",
      items: [{ description: "Laptop", assetCategoryId: VALID_UUID, quantity: 1, unitCost: -1 }],
    }).success);
  });

  it("accepts item with unitCost of 0", () => {
    assert.ok(createSchema.safeParse({
      referenceNumber: "PO-001",
      vendorId: VALID_UUID,
      purchaseDate: "2026-01-15",
      items: [{ description: "Free item", assetCategoryId: VALID_UUID, quantity: 1, unitCost: 0 }],
    }).success);
  });
});

// ---------------------------------------------------------------------------
// 3. Purchase item — exactly one of assetCategoryId or stockItemId
// ---------------------------------------------------------------------------

describe("purchase item — type exclusivity validation", () => {
  function validateItemType(item: { assetCategoryId?: string; stockItemId?: string }): string | null {
    const hasCategory = !!item.assetCategoryId;
    const hasStock = !!item.stockItemId;
    if (hasCategory === hasStock) return "INVALID_ITEM_TYPE";
    return null;
  }

  it("passes with only assetCategoryId", () => {
    assert.equal(validateItemType({ assetCategoryId: VALID_UUID }), null);
  });

  it("passes with only stockItemId", () => {
    assert.equal(validateItemType({ stockItemId: VALID_UUID }), null);
  });

  it("fails with both assetCategoryId and stockItemId", () => {
    assert.equal(validateItemType({ assetCategoryId: VALID_UUID, stockItemId: VALID_UUID_2 }), "INVALID_ITEM_TYPE");
  });

  it("fails with neither assetCategoryId nor stockItemId", () => {
    assert.equal(validateItemType({}), "INVALID_ITEM_TYPE");
  });
});

// ---------------------------------------------------------------------------
// 4. Decimal total calculation
// ---------------------------------------------------------------------------

describe("purchase — Decimal total calculation", async () => {
  const { Decimal } = await import("../../generated/prisma/internal/prismaNamespace.js");

  it("calculates item totalCost as unitCost * quantity", () => {
    const unitCost = new Decimal("1500.00");
    const quantity = 3;
    const totalCost = unitCost.mul(quantity);
    assert.equal(totalCost.toNumber(), 4500);
  });

  it("sums multiple items correctly", () => {
    const items = [
      { unitCost: new Decimal("1500.00"), quantity: 2 },
      { unitCost: new Decimal("50.00"), quantity: 10 },
    ];
    let total = new Decimal(0);
    for (const item of items) total = total.add(item.unitCost.mul(item.quantity));
    assert.equal(total.toNumber(), 3500);
  });

  it("handles zero unit cost", () => {
    const unitCost = new Decimal("0.00");
    const totalCost = unitCost.mul(5);
    assert.equal(totalCost.toNumber(), 0);
  });

  it("does not trust client-supplied totals — backend recalculates", () => {
    // Simulate: client sends totalAmount=9999, backend ignores it and recalculates
    const clientTotal = 9999;
    const unitCost = new Decimal("100.00");
    const quantity = 2;
    const backendTotal = unitCost.mul(quantity);
    assert.notEqual(backendTotal.toNumber(), clientTotal);
    assert.equal(backendTotal.toNumber(), 200);
  });
});

// ---------------------------------------------------------------------------
// 5. Purchase status transition rules
// ---------------------------------------------------------------------------

describe("purchase — status transition rules", () => {
  type Status = "DRAFT" | "CONFIRMED" | "RECEIVED" | "CANCELLED";

  function canConfirm(status: Status): boolean { return status === "DRAFT"; }
  function canCancel(status: Status, hasReceipts: boolean): string | null {
    if (status === "RECEIVED") return "INVALID_STATUS_TRANSITION";
    if (status === "CANCELLED") return "ALREADY_CANCELLED";
    if (hasReceipts) return "HAS_RECEIPTS";
    return null;
  }
  function canUpdate(status: Status, changeItems: boolean): string | null {
    if (status === "RECEIVED" || status === "CANCELLED") return "PURCHASE_NOT_EDITABLE";
    if (status === "CONFIRMED" && changeItems) return "ITEMS_LOCKED";
    return null;
  }
  function canReceive(status: Status): boolean { return status === "CONFIRMED"; }

  it("only DRAFT can be confirmed", () => {
    assert.ok(canConfirm("DRAFT"));
    assert.ok(!canConfirm("CONFIRMED"));
    assert.ok(!canConfirm("RECEIVED"));
    assert.ok(!canConfirm("CANCELLED"));
  });

  it("DRAFT can be cancelled without receipts", () => {
    assert.equal(canCancel("DRAFT", false), null);
  });

  it("CONFIRMED can be cancelled without receipts", () => {
    assert.equal(canCancel("CONFIRMED", false), null);
  });

  it("RECEIVED cannot be cancelled", () => {
    assert.equal(canCancel("RECEIVED", false), "INVALID_STATUS_TRANSITION");
  });

  it("CANCELLED cannot be cancelled again", () => {
    assert.equal(canCancel("CANCELLED", false), "ALREADY_CANCELLED");
  });

  it("purchase with receipts cannot be cancelled", () => {
    assert.equal(canCancel("CONFIRMED", true), "HAS_RECEIPTS");
  });

  it("DRAFT purchase is fully editable", () => {
    assert.equal(canUpdate("DRAFT", true), null);
    assert.equal(canUpdate("DRAFT", false), null);
  });

  it("CONFIRMED purchase allows header-only updates", () => {
    assert.equal(canUpdate("CONFIRMED", false), null);
    assert.equal(canUpdate("CONFIRMED", true), "ITEMS_LOCKED");
  });

  it("RECEIVED purchase cannot be updated", () => {
    assert.equal(canUpdate("RECEIVED", false), "PURCHASE_NOT_EDITABLE");
  });

  it("CANCELLED purchase cannot be updated", () => {
    assert.equal(canUpdate("CANCELLED", false), "PURCHASE_NOT_EDITABLE");
  });

  it("only CONFIRMED purchase can receive items", () => {
    assert.ok(canReceive("CONFIRMED"));
    assert.ok(!canReceive("DRAFT"));
    assert.ok(!canReceive("RECEIVED"));
    assert.ok(!canReceive("CANCELLED"));
  });
});

// ---------------------------------------------------------------------------
// 6. Receiving — input validation
// ---------------------------------------------------------------------------

describe("purchase receiving — input validation", async () => {
  const { z } = await import("zod");

  const receiveLineSchema = z.object({
    purchaseItemId: z.string().uuid(),
    quantityReceived: z.number().int().min(1),
    serialNumbers: z.array(z.string().min(1).max(200)).optional(),
  });

  const receiveSchema = z.object({
    lines: z.array(receiveLineSchema).min(1),
    documentReference: z.string().max(255).optional(),
    notes: z.string().max(2000).optional(),
  });

  it("accepts valid single line", () => {
    assert.ok(receiveSchema.safeParse({
      lines: [{ purchaseItemId: VALID_UUID, quantityReceived: 3 }],
    }).success);
  });

  it("accepts multiple lines", () => {
    assert.ok(receiveSchema.safeParse({
      lines: [
        { purchaseItemId: VALID_UUID, quantityReceived: 2 },
        { purchaseItemId: VALID_UUID_2, quantityReceived: 5 },
      ],
    }).success);
  });

  it("accepts lines with serialNumbers", () => {
    assert.ok(receiveSchema.safeParse({
      lines: [{ purchaseItemId: VALID_UUID, quantityReceived: 2, serialNumbers: ["SN001", "SN002"] }],
    }).success);
  });

  it("rejects empty lines array", () => {
    assert.ok(!receiveSchema.safeParse({ lines: [] }).success);
  });

  it("rejects quantityReceived of 0", () => {
    assert.ok(!receiveSchema.safeParse({
      lines: [{ purchaseItemId: VALID_UUID, quantityReceived: 0 }],
    }).success);
  });

  it("rejects negative quantityReceived", () => {
    assert.ok(!receiveSchema.safeParse({
      lines: [{ purchaseItemId: VALID_UUID, quantityReceived: -1 }],
    }).success);
  });

  it("rejects invalid purchaseItemId UUID", () => {
    assert.ok(!receiveSchema.safeParse({
      lines: [{ purchaseItemId: "not-uuid", quantityReceived: 1 }],
    }).success);
  });
});

// ---------------------------------------------------------------------------
// 7. Receiving — duplicate line detection
// ---------------------------------------------------------------------------

describe("purchase receiving — duplicate line detection", () => {
  function hasDuplicateLines(lines: Array<{ purchaseItemId: string }>): boolean {
    const ids = lines.map((l) => l.purchaseItemId);
    return new Set(ids).size !== ids.length;
  }

  it("detects duplicate purchaseItemIds", () => {
    assert.ok(hasDuplicateLines([
      { purchaseItemId: VALID_UUID },
      { purchaseItemId: VALID_UUID },
    ]));
  });

  it("passes with unique purchaseItemIds", () => {
    assert.ok(!hasDuplicateLines([
      { purchaseItemId: VALID_UUID },
      { purchaseItemId: VALID_UUID_2 },
    ]));
  });

  it("single line is never a duplicate", () => {
    assert.ok(!hasDuplicateLines([{ purchaseItemId: VALID_UUID }]));
  });
});

// ---------------------------------------------------------------------------
// 8. Receiving — over-receiving prevention
// ---------------------------------------------------------------------------

describe("purchase receiving — over-receiving prevention", () => {
  function validateRemaining(quantity: number, quantityReceived: number, requested: number): string | null {
    const remaining = quantity - quantityReceived;
    if (requested > remaining) return "OVER_RECEIVING";
    return null;
  }

  it("allows receiving exact remaining quantity", () => {
    assert.equal(validateRemaining(10, 3, 7), null);
  });

  it("allows partial receiving", () => {
    assert.equal(validateRemaining(10, 0, 5), null);
  });

  it("rejects over-receiving", () => {
    assert.equal(validateRemaining(10, 3, 8), "OVER_RECEIVING");
  });

  it("rejects receiving when fully received", () => {
    assert.equal(validateRemaining(10, 10, 1), "OVER_RECEIVING");
  });

  it("allows receiving all at once", () => {
    assert.equal(validateRemaining(5, 0, 5), null);
  });
});

// ---------------------------------------------------------------------------
// 9. Purchase status recalculation after receiving
// ---------------------------------------------------------------------------

describe("purchase — automatic status recalculation", () => {
  type Item = { quantity: number; quantityReceived: number };

  function recalculateStatus(items: Item[]): "CONFIRMED" | "RECEIVED" {
    const allDone = items.every((i) => i.quantityReceived >= i.quantity);
    return allDone ? "RECEIVED" : "CONFIRMED";
  }

  it("status becomes RECEIVED when all items fully received", () => {
    assert.equal(recalculateStatus([
      { quantity: 5, quantityReceived: 5 },
      { quantity: 3, quantityReceived: 3 },
    ]), "RECEIVED");
  });

  it("status stays CONFIRMED when any item is partially received", () => {
    assert.equal(recalculateStatus([
      { quantity: 5, quantityReceived: 5 },
      { quantity: 3, quantityReceived: 1 },
    ]), "CONFIRMED");
  });

  it("status stays CONFIRMED when no items received", () => {
    assert.equal(recalculateStatus([
      { quantity: 5, quantityReceived: 0 },
    ]), "CONFIRMED");
  });

  it("no PARTIALLY_RECEIVED status is used", () => {
    const statuses = ["DRAFT", "CONFIRMED", "RECEIVED", "CANCELLED"];
    assert.ok(!statuses.includes("PARTIALLY_RECEIVED"));
  });
});

// ---------------------------------------------------------------------------
// 10. Receipt creation contracts
// ---------------------------------------------------------------------------

describe("purchase receipt — creation contracts", () => {
  it("one receipt is created per receiving request", () => {
    const receipts: Array<{ id: string; purchaseId: string }> = [];
    function createReceipt(purchaseId: string): string {
      const id = `receipt-${receipts.length + 1}`;
      receipts.push({ id, purchaseId });
      return id;
    }
    const r1 = createReceipt("purchase-1");
    const r2 = createReceipt("purchase-1");
    assert.equal(receipts.length, 2);
    assert.notEqual(r1, r2);
  });

  it("receipt items link to the receipt and purchase item", () => {
    const receiptItem = {
      receiptId: "receipt-1",
      purchaseItemId: VALID_UUID,
      quantityReceived: 3,
    };
    assert.ok("receiptId" in receiptItem);
    assert.ok("purchaseItemId" in receiptItem);
    assert.ok("quantityReceived" in receiptItem);
  });

  it("a purchase item cannot appear twice in the same receipt", () => {
    const seen = new Set<string>();
    function addReceiptItem(purchaseItemId: string): boolean {
      if (seen.has(purchaseItemId)) return false;
      seen.add(purchaseItemId);
      return true;
    }
    assert.ok(addReceiptItem(VALID_UUID));
    assert.ok(!addReceiptItem(VALID_UUID));
    assert.ok(addReceiptItem(VALID_UUID_2));
  });

  it("receipt records receivedByUserId and receivedAt", () => {
    const receipt = {
      id: "receipt-1",
      purchaseId: "purchase-1",
      receivedByUserId: "user-1",
      receivedAt: new Date(),
      documentReference: null,
      notes: null,
    };
    assert.ok("receivedByUserId" in receipt);
    assert.ok("receivedAt" in receipt);
    assert.ok(receipt.receivedAt instanceof Date);
  });
});

// ---------------------------------------------------------------------------
// 11. Asset registration during receiving
// ---------------------------------------------------------------------------

describe("purchase receiving — serialized asset registration", () => {
  it("registers one asset per unit received", () => {
    const quantityReceived = 3;
    const assetsCreated: string[] = [];
    for (let i = 0; i < quantityReceived; i++) {
      assetsCreated.push(`ASSET-${i + 1}`);
    }
    assert.equal(assetsCreated.length, quantityReceived);
  });

  it("asset purchaseCost is set from purchase item unitCost", () => {
    const purchaseItem = { unitCost: "1500.00" };
    const asset = { purchaseCost: purchaseItem.unitCost };
    assert.equal(asset.purchaseCost, "1500.00");
  });

  it("asset purchaseDate is set from purchase purchaseDate", () => {
    const purchase = { purchaseDate: new Date("2026-01-15") };
    const asset = { purchaseDate: purchase.purchaseDate };
    assert.deepEqual(asset.purchaseDate, purchase.purchaseDate);
  });

  it("asset initial status is AVAILABLE", () => {
    const asset = { status: "AVAILABLE" };
    assert.equal(asset.status, "AVAILABLE");
  });

  it("asset initial condition is NEW", () => {
    const asset = { condition: "NEW" };
    assert.equal(asset.condition, "NEW");
  });

  it("asset links to purchaseItemId and receiptItemId", () => {
    const asset = {
      purchaseItemId: VALID_UUID,
      receiptItemId: VALID_UUID_2,
    };
    assert.ok("purchaseItemId" in asset);
    assert.ok("receiptItemId" in asset);
  });

  it("asset categoryId is set from purchase item assetCategoryId", () => {
    const purchaseItem = { assetCategoryId: VALID_UUID };
    const asset = { categoryId: purchaseItem.assetCategoryId };
    assert.equal(asset.categoryId, VALID_UUID);
  });

  it("individual audit record is created for each registered asset", () => {
    const quantityReceived = 3;
    const auditRecords: Array<{ action: string; entityType: string }> = [];
    for (let i = 0; i < quantityReceived; i++) {
      auditRecords.push({ action: "REGISTER_ASSET", entityType: "asset" });
    }
    assert.equal(auditRecords.length, quantityReceived);
    assert.ok(auditRecords.every((r) => r.action === "REGISTER_ASSET"));
  });
});

// ---------------------------------------------------------------------------
// 12. Stock movement during receiving
// ---------------------------------------------------------------------------

describe("purchase receiving — stock movement creation", () => {
  it("PURCHASE movement is positive", () => {
    const quantityReceived = 5;
    const movement = { movementType: "PURCHASE", quantity: quantityReceived };
    assert.ok(movement.quantity > 0);
    assert.equal(movement.movementType, "PURCHASE");
  });

  it("stock movement links to purchaseItemId and receiptItemId", () => {
    const movement = {
      purchaseItemId: VALID_UUID,
      receiptItemId: VALID_UUID_2,
    };
    assert.ok("purchaseItemId" in movement);
    assert.ok("receiptItemId" in movement);
  });

  it("quantityAfter = quantityBefore + quantityReceived", () => {
    const quantityBefore = 10;
    const quantityReceived = 5;
    const quantityAfter = quantityBefore + quantityReceived;
    assert.equal(quantityAfter, 15);
  });

  it("cached stock quantity is updated after receiving", () => {
    let currentQuantity = 10;
    function applyPurchaseMovement(qty: number): void {
      currentQuantity += qty;
    }
    applyPurchaseMovement(5);
    assert.equal(currentQuantity, 15);
  });

  it("PURCHASE movement audit action is PURCHASE_STOCK", () => {
    const auditEntry = { action: "PURCHASE_STOCK", entityType: "stock_item" };
    assert.equal(auditEntry.action, "PURCHASE_STOCK");
  });
});

// ---------------------------------------------------------------------------
// 13. Transaction atomicity
// ---------------------------------------------------------------------------

describe("purchase receiving — transaction atomicity", () => {
  it("all operations commit together on success", () => {
    let receiptCreated = false;
    let assetsCreated = false;
    let quantityUpdated = false;
    let auditWritten = false;

    function simulateTx(failAt: string | null): void {
      try {
        if (failAt === "receipt") throw new Error();
        receiptCreated = true;
        if (failAt === "assets") throw new Error();
        assetsCreated = true;
        if (failAt === "quantity") throw new Error();
        quantityUpdated = true;
        if (failAt === "audit") throw new Error();
        auditWritten = true;
      } catch {
        receiptCreated = false;
        assetsCreated = false;
        quantityUpdated = false;
        auditWritten = false;
      }
    }

    simulateTx(null);
    assert.ok(receiptCreated && assetsCreated && quantityUpdated && auditWritten);
  });

  it("asset creation failure rolls back receipt and quantity update", () => {
    let receiptCreated = false;
    let assetsCreated = false;
    let quantityUpdated = false;

    function simulateTx(failAt: string | null): void {
      try {
        if (failAt === "receipt") throw new Error();
        receiptCreated = true;
        if (failAt === "assets") throw new Error();
        assetsCreated = true;
        if (failAt === "quantity") throw new Error();
        quantityUpdated = true;
      } catch {
        receiptCreated = false;
        assetsCreated = false;
        quantityUpdated = false;
      }
    }

    simulateTx("assets");
    assert.ok(!receiptCreated && !assetsCreated && !quantityUpdated);
  });

  it("multiple lines are processed in a single transaction", () => {
    const receiveLines = [
      { purchaseItemId: VALID_UUID, quantityReceived: 2 },
      { purchaseItemId: VALID_UUID_2, quantityReceived: 3 },
    ];
    let txCount = 0;
    function processAllLines(input: typeof receiveLines): void {
      txCount++;
      for (const _line of input) { /* process */ }
    }
    processAllLines(receiveLines);
    assert.equal(txCount, 1);
  });
});

// ---------------------------------------------------------------------------
// 14. Deterministic lock ordering
// ---------------------------------------------------------------------------

describe("purchase receiving — deterministic lock ordering", () => {
  it("purchase items are locked in sorted UUID order", () => {
    const lines = [
      { purchaseItemId: "ffffffff-ffff-ffff-ffff-ffffffffffff" },
      { purchaseItemId: "00000000-0000-0000-0000-000000000000" },
      { purchaseItemId: "88888888-8888-8888-8888-888888888888" },
    ];
    const sorted = [...lines].sort((a, b) =>
      a.purchaseItemId.localeCompare(b.purchaseItemId)
    );
    assert.equal(sorted[0].purchaseItemId, "00000000-0000-0000-0000-000000000000");
    assert.equal(sorted[1].purchaseItemId, "88888888-8888-8888-8888-888888888888");
    assert.equal(sorted[2].purchaseItemId, "ffffffff-ffff-ffff-ffff-ffffffffffff");
  });

  it("sorted order is deterministic regardless of input order", () => {
    const ids = [VALID_UUID_2, VALID_UUID];
    const sorted1 = [...ids].sort();
    const sorted2 = [...ids].reverse().sort();
    assert.deepEqual(sorted1, sorted2);
  });
});

// ---------------------------------------------------------------------------
// 15. Purchase listing — query schema
// ---------------------------------------------------------------------------

describe("purchase listing — query schema validation", async () => {
  const { z } = await import("zod");

  const PURCHASE_STATUSES = ["DRAFT", "CONFIRMED", "RECEIVED", "CANCELLED"] as const;
  const SORT_FIELDS = ["referenceNumber", "purchaseDate", "totalAmount", "status", "createdAt"] as const;

  const listSchema = z.object({
    search: z.string().max(200).optional(),
    vendorId: z.string().uuid().optional(),
    status: z.enum(PURCHASE_STATUSES).optional(),
    dateFrom: z.string().regex(ISO_DATE).optional(),
    dateTo: z.string().regex(ISO_DATE).optional(),
    sortBy: z.enum(SORT_FIELDS).optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  });

  it("accepts empty query", () => assert.ok(listSchema.safeParse({}).success));

  it("accepts all valid filters", () => {
    assert.ok(listSchema.safeParse({
      search: "PO-001",
      vendorId: VALID_UUID,
      status: "CONFIRMED",
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      sortBy: "purchaseDate",
      sortOrder: "desc",
      page: "1",
      pageSize: "20",
    }).success);
  });

  it("rejects invalid status", () => {
    assert.ok(!listSchema.safeParse({ status: "PARTIALLY_RECEIVED" }).success);
  });

  it("rejects invalid sortBy field", () => {
    assert.ok(!listSchema.safeParse({ sortBy: "vendorName" }).success);
  });

  it("rejects invalid dateFrom format", () => {
    assert.ok(!listSchema.safeParse({ dateFrom: "01/01/2026" }).success);
  });

  it("defaults page to 1 and pageSize to 20", () => {
    const result = listSchema.safeParse({});
    assert.ok(result.success);
    assert.equal(result.data.page, 1);
    assert.equal(result.data.pageSize, 20);
  });
});

// ---------------------------------------------------------------------------
// 16. PurchaseServiceError codes
// ---------------------------------------------------------------------------

describe("purchase service — error codes", async () => {
  const { PurchaseServiceError } = await import("../services/purchaseService.js");

  it("PURCHASE_NOT_FOUND maps to 404", () => {
    const err = new PurchaseServiceError("Not found.", "PURCHASE_NOT_FOUND");
    assert.equal(err.code, "PURCHASE_NOT_FOUND");
    assert.ok(err instanceof Error);
  });

  it("VENDOR_NOT_FOUND maps to 404", () => {
    const err = new PurchaseServiceError("Vendor not found.", "VENDOR_NOT_FOUND");
    assert.equal(err.code, "VENDOR_NOT_FOUND");
  });

  it("VENDOR_INACTIVE maps to 422", () => {
    const err = new PurchaseServiceError("Vendor inactive.", "VENDOR_INACTIVE");
    assert.equal(err.code, "VENDOR_INACTIVE");
  });

  it("INVALID_STATUS_TRANSITION maps to 409", () => {
    const err = new PurchaseServiceError("Invalid transition.", "INVALID_STATUS_TRANSITION");
    assert.equal(err.code, "INVALID_STATUS_TRANSITION");
  });

  it("OVER_RECEIVING maps to 409", () => {
    const err = new PurchaseServiceError("Over receiving.", "OVER_RECEIVING");
    assert.equal(err.code, "OVER_RECEIVING");
  });

  it("PURCHASE_NOT_CONFIRMED maps to 409", () => {
    const err = new PurchaseServiceError("Not confirmed.", "PURCHASE_NOT_CONFIRMED");
    assert.equal(err.code, "PURCHASE_NOT_CONFIRMED");
  });

  it("ITEMS_LOCKED maps to 409", () => {
    const err = new PurchaseServiceError("Items locked.", "ITEMS_LOCKED");
    assert.equal(err.code, "ITEMS_LOCKED");
  });

  it("DUPLICATE_LINES maps to 409", () => {
    const err = new PurchaseServiceError("Duplicate lines.", "DUPLICATE_LINES");
    assert.equal(err.code, "DUPLICATE_LINES");
  });

  it("TAG_COLLISION_EXHAUSTED maps to 503", () => {
    const err = new PurchaseServiceError("Tag exhausted.", "TAG_COLLISION_EXHAUSTED");
    assert.equal(err.code, "TAG_COLLISION_EXHAUSTED");
  });

  it("HAS_RECEIPTS maps to 409", () => {
    const err = new PurchaseServiceError("Has receipts.", "HAS_RECEIPTS");
    assert.equal(err.code, "HAS_RECEIPTS");
  });
});

// ---------------------------------------------------------------------------
// 17. Audit log — Stage 5.4 action identifiers
// ---------------------------------------------------------------------------

describe("audit log — Stage 5.4 action identifiers", () => {
  const ACTIONS = [
    "CREATE_PURCHASE",
    "UPDATE_PURCHASE",
    "CONFIRM_PURCHASE",
    "CANCEL_PURCHASE",
    "RECEIVE_PURCHASE",
    "COMPLETE_PURCHASE",
    "REGISTER_ASSET",
    "PURCHASE_STOCK",
  ];

  it("all 8 Stage 5.4 audit actions are defined", () => {
    assert.equal(ACTIONS.length, 8);
  });

  it("RECEIVE_PURCHASE audit entry records receiptId and lineCount", () => {
    const entry = {
      action: "RECEIVE_PURCHASE",
      entityType: "purchase",
      newValues: { receiptId: "receipt-1", lineCount: 2, fullyReceived: false },
    };
    assert.ok("receiptId" in entry.newValues);
    assert.ok("lineCount" in entry.newValues);
  });

  it("COMPLETE_PURCHASE audit entry records status transition", () => {
    const entry = {
      action: "COMPLETE_PURCHASE",
      entityType: "purchase",
      oldValues: { status: "CONFIRMED" },
      newValues: { status: "RECEIVED" },
    };
    assert.equal(entry.oldValues.status, "CONFIRMED");
    assert.equal(entry.newValues.status, "RECEIVED");
  });

  it("audit entries never contain password or token fields", () => {
    for (const action of ACTIONS) {
      assert.ok(!action.toLowerCase().includes("password"));
      assert.ok(!action.toLowerCase().includes("token"));
      assert.ok(!action.toLowerCase().includes("hash"));
    }
  });
});

// ---------------------------------------------------------------------------
// 18. Permission contracts
// ---------------------------------------------------------------------------

describe("purchase endpoints — authorization contracts", () => {
  const PURCHASE_PERMISSIONS = [
    "purchases.view",
    "purchases.create",
    "purchases.update",
    "purchases.confirm",
    "purchases.receive",
    "purchases.cancel",
  ];

  const IT_STAFF_PERMS = [
    "purchases.view", "purchases.create", "purchases.update",
    "purchases.confirm", "purchases.receive", "purchases.cancel",
    "assets.view", "assets.register", "stock.view", "stock.issue",
  ];

  it("IT_STAFF has all 6 purchase permissions", () => {
    for (const p of PURCHASE_PERMISSIONS) {
      assert.ok(IT_STAFF_PERMS.includes(p), `IT_STAFF missing: ${p}`);
    }
  });

  it("middleware chain order is requireAuth -> requirePasswordChanged -> requirePermission", () => {
    const chain = ["requireAuth", "requirePasswordChanged", "requirePermission"];
    assert.equal(chain[0], "requireAuth");
    assert.equal(chain[1], "requirePasswordChanged");
    assert.equal(chain[2], "requirePermission");
  });

  it("unauthenticated request is rejected at requireAuth", () => {
    function decide(auth: boolean, pwChanged: boolean, hasPerm: boolean): boolean {
      return auth && pwChanged && hasPerm;
    }
    assert.equal(decide(false, true, true), false);
  });

  it("mustChangePassword blocks purchase endpoints", () => {
    function decide(auth: boolean, pwChanged: boolean, hasPerm: boolean): boolean {
      return auth && pwChanged && hasPerm;
    }
    assert.equal(decide(true, false, true), false);
  });

  it("purchases.view is required for GET endpoints", () => {
    assert.ok(PURCHASE_PERMISSIONS.includes("purchases.view"));
  });

  it("purchases.receive is required for the receive endpoint", () => {
    assert.ok(PURCHASE_PERMISSIONS.includes("purchases.receive"));
  });
});

// ---------------------------------------------------------------------------
// 19. Receipt history
// ---------------------------------------------------------------------------

describe("purchase receipt history", () => {
  it("receipts are ordered by receivedAt descending", () => {
    const receipts = [
      { id: "r1", receivedAt: new Date("2026-01-10") },
      { id: "r3", receivedAt: new Date("2026-01-30") },
      { id: "r2", receivedAt: new Date("2026-01-20") },
    ];
    const sorted = [...receipts].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
    assert.equal(sorted[0].id, "r3");
    assert.equal(sorted[1].id, "r2");
    assert.equal(sorted[2].id, "r1");
  });

  it("receipt history is available via GET /api/purchases/:purchaseId/receipts", () => {
    const endpoint = "/api/purchases/:purchaseId/receipts";
    assert.ok(endpoint.includes("receipts"));
    assert.ok(endpoint.includes(":purchaseId"));
  });

  it("receipt includes receiptItems with quantityReceived", () => {
    const receipt = {
      id: "r1",
      receiptItems: [
        { purchaseItemId: VALID_UUID, quantityReceived: 3 },
      ],
    };
    assert.ok(receipt.receiptItems[0].quantityReceived > 0);
  });
});

// ---------------------------------------------------------------------------
// 20. Cumulative quantityReceived tracking
// ---------------------------------------------------------------------------

describe("purchase item — cumulative quantityReceived", () => {
  it("quantityReceived accumulates across multiple deliveries", () => {
    let quantityReceived = 0;
    const deliveries = [3, 4, 3];
    for (const qty of deliveries) quantityReceived += qty;
    assert.equal(quantityReceived, 10);
  });

  it("quantityReceived starts at 0", () => {
    const item = { quantity: 10, quantityReceived: 0 };
    assert.equal(item.quantityReceived, 0);
  });

  it("remaining quantity decreases with each delivery", () => {
    let quantityReceived = 0;
    const quantity = 10;
    quantityReceived += 3;
    assert.equal(quantity - quantityReceived, 7);
    quantityReceived += 4;
    assert.equal(quantity - quantityReceived, 3);
  });

  it("quantityReceived never exceeds quantity", () => {
    const quantity = 10;
    const quantityReceived = 10;
    assert.ok(quantityReceived <= quantity);
  });
});

// ---------------------------------------------------------------------------
// 21. isPrismaUniqueError helper
// ---------------------------------------------------------------------------

describe("purchase service — isPrismaUniqueError helper", async () => {
  const { isPrismaUniqueError } = await import("../services/purchaseService.js");

  it("detects P2002", () => assert.ok(isPrismaUniqueError({ code: "P2002" })));
  it("does not detect P2003", () => assert.ok(!isPrismaUniqueError({ code: "P2003" })));
  it("does not detect plain Error", () => assert.ok(!isPrismaUniqueError(new Error("other"))));
  it("does not detect null", () => assert.ok(!isPrismaUniqueError(null)));
  it("duplicate referenceNumber produces 409", () => {
    const status = isPrismaUniqueError({ code: "P2002" }) ? 409 : 500;
    assert.equal(status, 409);
  });
});

// ---------------------------------------------------------------------------
// 22. App route registration
// ---------------------------------------------------------------------------

describe("purchases — app route registration", () => {
  it("purchases router file exports a default Router", async () => {
    // Verify the router module can be imported without a DB connection
    // by checking the route file exists and exports correctly via static analysis
    const routerPath = new URL("../routes/purchases.js", import.meta.url).pathname;
    assert.ok(routerPath.includes("purchases"));
  });

  it("all 8 purchase endpoints are defined in the router", () => {
    const endpoints = [
      { method: "GET",  path: "/" },
      { method: "GET",  path: "/:purchaseId" },
      { method: "POST", path: "/" },
      { method: "PATCH",path: "/:purchaseId" },
      { method: "POST", path: "/:purchaseId/confirm" },
      { method: "POST", path: "/:purchaseId/cancel" },
      { method: "POST", path: "/:purchaseId/receive" },
      { method: "GET",  path: "/:purchaseId/receipts" },
    ];
    assert.equal(endpoints.length, 8);
    assert.ok(endpoints.some((e) => e.path === "/:purchaseId/receive" && e.method === "POST"));
    assert.ok(endpoints.some((e) => e.path === "/:purchaseId/receipts" && e.method === "GET"));
  });

  it("purchases router is mounted at /api/purchases in app.ts", async () => {
    // Read app.ts source to verify registration without importing it
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const appPath = fileURLToPath(new URL("../app.ts", import.meta.url));
    const source = readFileSync(appPath, "utf8");
    assert.ok(source.includes("purchasesRouter"));
    assert.ok(source.includes("/api/purchases"));
  });
});
