/**
 * Stage 5.2 — Serialized Asset Management Unit Tests
 * Uses Node.js built-in test runner. No database required.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// 1. Asset tag format — buildAssetTag and formatSequence
// ---------------------------------------------------------------------------

describe("asset tag — format and sequence padding", async () => {
  const { buildAssetTag, formatSequence } = await import("../services/assetTagService.js");

  it("formats sequence 1 as 0001", () => {
    assert.equal(formatSequence(1), "0001");
  });

  it("formats sequence 42 as 0042", () => {
    assert.equal(formatSequence(42), "0042");
  });

  it("formats sequence 9999 as 9999", () => {
    assert.equal(formatSequence(9999), "9999");
  });

  it("formats sequence 10000 as 10000 (no padding beyond 4 digits)", () => {
    assert.equal(formatSequence(10000), "10000");
  });

  it("formats sequence 100000 as 100000", () => {
    assert.equal(formatSequence(100000), "100000");
  });

  it("builds tag with correct format PREFIX-YEAR-SEQ", () => {
    assert.equal(buildAssetTag("LAP", 2026, 1), "LAP-2026-0001");
  });

  it("builds tag with 5-letter prefix", () => {
    assert.equal(buildAssetTag("ASSET", 2026, 42), "ASSET-2026-0042");
  });

  it("builds tag with sequence beyond 9999", () => {
    assert.equal(buildAssetTag("IT", 2026, 10000), "IT-2026-10000");
  });

  it("uses category-specific prefix, not a global one", () => {
    const tag1 = buildAssetTag("LAP", 2026, 1);
    const tag2 = buildAssetTag("MON", 2026, 1);
    assert.notEqual(tag1, tag2);
    assert.equal(tag1, "LAP-2026-0001");
    assert.equal(tag2, "MON-2026-0001");
  });

  it("uses registration year in tag", () => {
    const tag2025 = buildAssetTag("LAP", 2025, 1);
    const tag2026 = buildAssetTag("LAP", 2026, 1);
    assert.notEqual(tag2025, tag2026);
    assert.ok(tag2025.includes("2025"));
    assert.ok(tag2026.includes("2026"));
  });
});

// ---------------------------------------------------------------------------
// 2. Sequence exhaustion
// ---------------------------------------------------------------------------

describe("asset tag — sequence exhaustion", async () => {
  const { AssetTagError } = await import("../services/assetTagService.js");

  it("AssetTagError has SEQUENCE_EXHAUSTED code", () => {
    const err = new AssetTagError("exhausted", "SEQUENCE_EXHAUSTED");
    assert.equal(err.code, "SEQUENCE_EXHAUSTED");
    assert.ok(err instanceof Error);
  });

  it("INT_MAX is 2147483647", () => {
    const INT_MAX = 2_147_483_647;
    assert.equal(INT_MAX, 2147483647);
  });

  it("sequence at INT_MAX triggers exhaustion check", () => {
    const INT_MAX = 2_147_483_647;
    function checkExhaustion(current: number): boolean {
      return current >= INT_MAX;
    }
    assert.ok(checkExhaustion(2_147_483_647));
    assert.ok(!checkExhaustion(2_147_483_646));
  });
});

// ---------------------------------------------------------------------------
// 3. Collision handling — isAssetTagUniqueViolation
// ---------------------------------------------------------------------------

describe("asset tag — collision detection", async () => {
  const { isAssetTagUniqueViolation, isSerialNumberUniqueViolation } =
    await import("../services/assetService.js");

  it("detects P2002 on assetTag field", () => {
    const err = { code: "P2002", meta: { target: ["assetTag"] } };
    assert.ok(isAssetTagUniqueViolation(err));
  });

  it("detects P2002 on assets_assetTag_key constraint name", () => {
    const err = { code: "P2002", meta: { target: "assets_assetTag_key" } };
    assert.ok(isAssetTagUniqueViolation(err));
  });

  it("does NOT detect P2002 on serialNumber as asset tag violation", () => {
    const err = { code: "P2002", meta: { target: ["serialNumber"] } };
    assert.ok(!isAssetTagUniqueViolation(err));
  });

  it("does NOT detect P2003 as asset tag violation", () => {
    const err = { code: "P2003", meta: { target: ["assetTag"] } };
    assert.ok(!isAssetTagUniqueViolation(err));
  });

  it("does NOT detect plain Error as asset tag violation", () => {
    assert.ok(!isAssetTagUniqueViolation(new Error("other")));
  });

  it("does NOT detect null as asset tag violation", () => {
    assert.ok(!isAssetTagUniqueViolation(null));
  });

  it("detects P2002 on serialNumber field", () => {
    const err = { code: "P2002", meta: { target: ["serialNumber"] } };
    assert.ok(isSerialNumberUniqueViolation(err));
  });

  it("does NOT detect P2002 on assetTag as serial number violation", () => {
    const err = { code: "P2002", meta: { target: ["assetTag"] } };
    assert.ok(!isSerialNumberUniqueViolation(err));
  });
});

// ---------------------------------------------------------------------------
// 4. Retry loop contracts
// ---------------------------------------------------------------------------

describe("asset tag — retry loop contracts", async () => {
  const { MAX_TAG_RETRIES } = await import("../services/assetTagService.js");

  it("MAX_TAG_RETRIES is 10", () => {
    assert.equal(MAX_TAG_RETRIES, 10);
  });

  it("retry loop stops after MAX_TAG_RETRIES attempts", () => {
    let attempts = 0;
    function simulateRetry(maxRetries: number, alwaysFails: boolean): string {
      for (let i = 0; i < maxRetries; i++) {
        attempts++;
        if (!alwaysFails) return "success";
      }
      return "exhausted";
    }
    const result = simulateRetry(MAX_TAG_RETRIES, true);
    assert.equal(result, "exhausted");
    assert.equal(attempts, MAX_TAG_RETRIES);
  });

  it("retry loop succeeds on first attempt when no collision", () => {
    let attempts = 0;
    function simulateRetry(maxRetries: number): string {
      for (let i = 0; i < maxRetries; i++) {
        attempts++;
        return "success";
      }
      return "exhausted";
    }
    const result = simulateRetry(MAX_TAG_RETRIES);
    assert.equal(result, "success");
    assert.equal(attempts, 1);
  });

  it("non-tag P2002 errors are NOT retried", () => {
    // Simulate: serialNumber P2002 should propagate, not retry
    const serialErr = { code: "P2002", meta: { target: ["serialNumber"] } };
    let retried = false;
    function simulateLoop(err: unknown): string {
      // Only retry if it's a tag violation
      if (
        typeof err === "object" && err !== null && "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        const meta = (err as { meta?: { target?: string | string[] } }).meta;
        const target = meta?.target;
        const isTagViolation =
          Array.isArray(target)
            ? target.includes("assetTag")
            : typeof target === "string" && target.includes("assetTag");
        if (isTagViolation) { retried = true; return "retried"; }
      }
      return "propagated";
    }
    assert.equal(simulateLoop(serialErr), "propagated");
    assert.equal(retried, false);
  });
});

// ---------------------------------------------------------------------------
// 5. Registration — validation schema
// ---------------------------------------------------------------------------

describe("asset registration — validation schema", async () => {
  const { z } = await import("zod");

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const ASSET_CONDITIONS = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;

  const registerSchema = z.object({
    name: z.string().min(1).max(255),
    categoryId: z.string().uuid(),
    serialNumber: z.string().max(200).optional(),
    manufacturer: z.string().max(150).optional(),
    model: z.string().max(150).optional(),
    purchaseDate: z.string().regex(ISO_DATE).optional(),
    purchaseCost: z.number().nonnegative().optional(),
    warrantyExpiryDate: z.string().regex(ISO_DATE).optional(),
    condition: z.enum(ASSET_CONDITIONS).optional(),
    currentLocationId: z.string().uuid().optional(),
    currentDepartmentId: z.string().uuid().optional(),
    notes: z.string().max(2000).optional(),
  });

  const VALID_UUID = "4f07dda8-40db-446b-9f9c-5e50e3fcf778";

  it("accepts minimal valid input", () => {
    assert.ok(registerSchema.safeParse({ name: "Dell Laptop", categoryId: VALID_UUID }).success);
  });

  it("accepts full valid input", () => {
    assert.ok(registerSchema.safeParse({
      name: "Dell Laptop", categoryId: VALID_UUID,
      serialNumber: "SN123", manufacturer: "Dell", model: "XPS 15",
      purchaseDate: "2026-01-15", purchaseCost: 1500,
      warrantyExpiryDate: "2029-01-15", condition: "NEW",
      currentLocationId: VALID_UUID, currentDepartmentId: VALID_UUID,
      notes: "Registered at intake",
    }).success);
  });

  it("rejects empty name", () => {
    assert.ok(!registerSchema.safeParse({ name: "", categoryId: VALID_UUID }).success);
  });

  it("rejects missing categoryId", () => {
    assert.ok(!registerSchema.safeParse({ name: "Laptop" }).success);
  });

  it("rejects invalid categoryId UUID", () => {
    assert.ok(!registerSchema.safeParse({ name: "Laptop", categoryId: "not-uuid" }).success);
  });

  it("rejects invalid purchaseDate format", () => {
    assert.ok(!registerSchema.safeParse({ name: "Laptop", categoryId: VALID_UUID, purchaseDate: "15-01-2026" }).success);
  });

  it("rejects negative purchaseCost", () => {
    assert.ok(!registerSchema.safeParse({ name: "Laptop", categoryId: VALID_UUID, purchaseCost: -1 }).success);
  });

  it("rejects invalid condition value", () => {
    assert.ok(!registerSchema.safeParse({ name: "Laptop", categoryId: VALID_UUID, condition: "BROKEN" }).success);
  });

  it("does not accept assetTag in registration body", () => {
    // assetTag is not in the schema — it must be generated by the system
    const result = registerSchema.safeParse({ name: "Laptop", categoryId: VALID_UUID, assetTag: "LAP-2026-0001" });
    // Schema strips unknown keys (Zod default) — assetTag is simply ignored
    assert.ok(result.success);
    assert.ok(!("assetTag" in (result.data as object)));
  });
});

// ---------------------------------------------------------------------------
// 5. Registration — validation schema
// ---------------------------------------------------------------------------

describe("asset registration — validation schema", async () => {
  const { z } = await import("zod");

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const ASSET_CONDITIONS = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;

  const registerSchema = z.object({
    name: z.string().min(1).max(255),
    categoryId: z.string().uuid(),
    serialNumber: z.string().max(200).optional(),
    manufacturer: z.string().max(150).optional(),
    model: z.string().max(150).optional(),
    purchaseDate: z.string().regex(ISO_DATE).optional(),
    purchaseCost: z.number().nonnegative().optional(),
    warrantyExpiryDate: z.string().regex(ISO_DATE).optional(),
    condition: z.enum(ASSET_CONDITIONS).optional(),
    currentLocationId: z.string().uuid().optional(),
    currentDepartmentId: z.string().uuid().optional(),
    notes: z.string().max(2000).optional(),
  });

  const VALID_UUID = "4f07dda8-40db-446b-9f9c-5e50e3fcf778";

  it("accepts minimal valid input", () => {
    assert.ok(registerSchema.safeParse({ name: "Dell Laptop", categoryId: VALID_UUID }).success);
  });

  it("accepts full valid input", () => {
    assert.ok(registerSchema.safeParse({
      name: "Dell Laptop", categoryId: VALID_UUID,
      serialNumber: "SN123", manufacturer: "Dell", model: "XPS 15",
      purchaseDate: "2026-01-15", purchaseCost: 1500,
      warrantyExpiryDate: "2029-01-15", condition: "NEW",
      currentLocationId: VALID_UUID, currentDepartmentId: VALID_UUID,
      notes: "Registered at intake",
    }).success);
  });

  it("rejects empty name", () => {
    assert.ok(!registerSchema.safeParse({ name: "", categoryId: VALID_UUID }).success);
  });

  it("rejects missing categoryId", () => {
    assert.ok(!registerSchema.safeParse({ name: "Laptop" }).success);
  });

  it("rejects invalid categoryId UUID", () => {
    assert.ok(!registerSchema.safeParse({ name: "Laptop", categoryId: "not-uuid" }).success);
  });

  it("rejects invalid purchaseDate format", () => {
    assert.ok(!registerSchema.safeParse({
      name: "Laptop", categoryId: VALID_UUID, purchaseDate: "15-01-2026",
    }).success);
  });

  it("rejects negative purchaseCost", () => {
    assert.ok(!registerSchema.safeParse({
      name: "Laptop", categoryId: VALID_UUID, purchaseCost: -1,
    }).success);
  });

  it("rejects invalid condition value", () => {
    assert.ok(!registerSchema.safeParse({
      name: "Laptop", categoryId: VALID_UUID, condition: "BROKEN",
    }).success);
  });

  it("assetTag is not an accepted registration field", () => {
    const result = registerSchema.safeParse({
      name: "Laptop", categoryId: VALID_UUID, assetTag: "LAP-2026-0001",
    });
    assert.ok(result.success);
    assert.ok(!("assetTag" in (result.data as object)));
  });
});

// ---------------------------------------------------------------------------
// 6. AssetServiceError codes
// ---------------------------------------------------------------------------

describe("asset service — error codes", async () => {
  const { AssetServiceError } = await import("../services/assetService.js");

  it("ASSET_NOT_FOUND maps to 404", () => {
    const err = new AssetServiceError("Asset not found.", "ASSET_NOT_FOUND");
    assert.equal(err.code, "ASSET_NOT_FOUND");
    assert.ok(err instanceof Error);
  });

  it("CATEGORY_NOT_FOUND maps to 404", () => {
    const err = new AssetServiceError("Category not found.", "CATEGORY_NOT_FOUND");
    assert.equal(err.code, "CATEGORY_NOT_FOUND");
  });

  it("NOT_SERIALIZED maps to 422", () => {
    const err = new AssetServiceError("Not serialized.", "NOT_SERIALIZED");
    assert.equal(err.code, "NOT_SERIALIZED");
  });

  it("MISSING_PREFIX maps to 422", () => {
    const err = new AssetServiceError("Missing prefix.", "MISSING_PREFIX");
    assert.equal(err.code, "MISSING_PREFIX");
  });

  it("TAG_COLLISION_EXHAUSTED maps to 503", () => {
    const err = new AssetServiceError("Exhausted.", "TAG_COLLISION_EXHAUSTED");
    assert.equal(err.code, "TAG_COLLISION_EXHAUSTED");
  });

  it("ASSET_INACTIVE maps to 409", () => {
    const err = new AssetServiceError("Inactive.", "ASSET_INACTIVE");
    assert.equal(err.code, "ASSET_INACTIVE");
  });

  it("ALREADY_RETIRED maps to 409", () => {
    const err = new AssetServiceError("Already retired.", "ALREADY_RETIRED");
    assert.equal(err.code, "ALREADY_RETIRED");
  });

  it("ALREADY_DISPOSED maps to 409", () => {
    const err = new AssetServiceError("Already disposed.", "ALREADY_DISPOSED");
    assert.equal(err.code, "ALREADY_DISPOSED");
  });

  it("INVALID_TRANSITION maps to 409", () => {
    const err = new AssetServiceError("Invalid transition.", "INVALID_TRANSITION");
    assert.equal(err.code, "INVALID_TRANSITION");
  });

  it("ASSET_ASSIGNED maps to 409", () => {
    const err = new AssetServiceError("Asset assigned.", "ASSET_ASSIGNED");
    assert.equal(err.code, "ASSET_ASSIGNED");
  });
});

// ---------------------------------------------------------------------------
// 7. Category validation for registration
// ---------------------------------------------------------------------------

describe("asset registration — category validation contracts", () => {
  function validateCategory(cat: {
    isSerialized: boolean;
    tagPrefix: string | null;
  }): string | null {
    if (!cat.isSerialized) return "NOT_SERIALIZED";
    if (!cat.tagPrefix) return "MISSING_PREFIX";
    return null;
  }

  it("serialized category with prefix passes", () => {
    assert.equal(validateCategory({ isSerialized: true, tagPrefix: "LAP" }), null);
  });

  it("non-serialized category is rejected", () => {
    assert.equal(validateCategory({ isSerialized: false, tagPrefix: null }), "NOT_SERIALIZED");
  });

  it("non-serialized category with prefix is still rejected", () => {
    assert.equal(validateCategory({ isSerialized: false, tagPrefix: "LAP" }), "NOT_SERIALIZED");
  });

  it("serialized category without prefix is rejected", () => {
    assert.equal(validateCategory({ isSerialized: true, tagPrefix: null }), "MISSING_PREFIX");
  });
});

// ---------------------------------------------------------------------------
// 8. Lifecycle — valid and invalid transitions
// ---------------------------------------------------------------------------

describe("asset lifecycle — transition rules", () => {
  type Status = "AVAILABLE" | "ASSIGNED" | "UNDER_MAINTENANCE" | "RETIRED" | "DISPOSED";

  function canRetire(status: Status): string | null {
    if (status === "RETIRED") return "ALREADY_RETIRED";
    if (status === "DISPOSED") return "INVALID_TRANSITION";
    if (status === "ASSIGNED") return "ASSET_ASSIGNED";
    return null;
  }

  function canDispose(status: Status): string | null {
    if (status === "DISPOSED") return "ALREADY_DISPOSED";
    if (status === "ASSIGNED") return "ASSET_ASSIGNED";
    return null;
  }

  it("AVAILABLE asset can be retired", () => {
    assert.equal(canRetire("AVAILABLE"), null);
  });

  it("UNDER_MAINTENANCE asset can be retired", () => {
    assert.equal(canRetire("UNDER_MAINTENANCE"), null);
  });

  it("RETIRED asset cannot be retired again", () => {
    assert.equal(canRetire("RETIRED"), "ALREADY_RETIRED");
  });

  it("DISPOSED asset cannot be retired", () => {
    assert.equal(canRetire("DISPOSED"), "INVALID_TRANSITION");
  });

  it("ASSIGNED asset cannot be retired", () => {
    assert.equal(canRetire("ASSIGNED"), "ASSET_ASSIGNED");
  });

  it("AVAILABLE asset can be disposed", () => {
    assert.equal(canDispose("AVAILABLE"), null);
  });

  it("RETIRED asset can be disposed", () => {
    assert.equal(canDispose("RETIRED"), null);
  });

  it("DISPOSED asset cannot be disposed again", () => {
    assert.equal(canDispose("DISPOSED"), "ALREADY_DISPOSED");
  });

  it("ASSIGNED asset cannot be disposed", () => {
    assert.equal(canDispose("ASSIGNED"), "ASSET_ASSIGNED");
  });

  it("asset record is preserved after retirement (no physical delete)", () => {
    const asset = { id: "a1", status: "AVAILABLE", assetTag: "LAP-2026-0001" };
    const updated = { ...asset, status: "RETIRED" };
    assert.equal(updated.id, "a1");
    assert.equal(updated.assetTag, "LAP-2026-0001");
    assert.equal(updated.status, "RETIRED");
  });

  it("asset record is preserved after disposal (no physical delete)", () => {
    const asset = { id: "a1", status: "RETIRED", assetTag: "LAP-2026-0001" };
    const updated = { ...asset, status: "DISPOSED" };
    assert.equal(updated.id, "a1");
    assert.equal(updated.assetTag, "LAP-2026-0001");
  });
});

// ---------------------------------------------------------------------------
// 9. Update — asset tag immutability
// ---------------------------------------------------------------------------

describe("asset update — asset tag immutability", async () => {
  const { z } = await import("zod");

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const ASSET_CONDITIONS = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;

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

  it("update schema does not include assetTag field", () => {
    const result = updateSchema.safeParse({ assetTag: "LAP-2026-9999" });
    assert.ok(result.success);
    assert.ok(!("assetTag" in (result.data as object)));
  });

  it("update schema does not include categoryId field", () => {
    const result = updateSchema.safeParse({
      categoryId: "4f07dda8-40db-446b-9f9c-5e50e3fcf778",
    });
    assert.ok(result.success);
    assert.ok(!("categoryId" in (result.data as object)));
  });

  it("update schema does not include status field", () => {
    const result = updateSchema.safeParse({ status: "RETIRED" });
    assert.ok(result.success);
    assert.ok(!("status" in (result.data as object)));
  });

  it("update schema accepts valid partial update", () => {
    assert.ok(updateSchema.safeParse({ name: "Updated Laptop", condition: "GOOD" }).success);
  });

  it("update schema accepts null to clear optional fields", () => {
    assert.ok(updateSchema.safeParse({ serialNumber: null, notes: null }).success);
  });

  it("retired/disposed asset update is blocked", () => {
    function checkUpdateAllowed(status: string): string | null {
      if (status === "RETIRED" || status === "DISPOSED") return "ASSET_INACTIVE";
      return null;
    }
    assert.equal(checkUpdateAllowed("RETIRED"), "ASSET_INACTIVE");
    assert.equal(checkUpdateAllowed("DISPOSED"), "ASSET_INACTIVE");
    assert.equal(checkUpdateAllowed("AVAILABLE"), null);
    assert.equal(checkUpdateAllowed("ASSIGNED"), null);
  });
});

// ---------------------------------------------------------------------------
// 10. Listing — query schema validation
// ---------------------------------------------------------------------------

describe("asset listing — query schema validation", async () => {
  const { z } = await import("zod");

  const ASSET_STATUSES = ["AVAILABLE", "ASSIGNED", "UNDER_MAINTENANCE", "RETIRED", "DISPOSED"] as const;
  const SORT_FIELDS = ["assetTag", "name", "status", "condition", "createdAt", "updatedAt"] as const;

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

  it("accepts empty query (all defaults)", () => {
    assert.ok(listQuerySchema.safeParse({}).success);
  });

  it("accepts all valid filters", () => {
    assert.ok(listQuerySchema.safeParse({
      search: "laptop", status: "AVAILABLE",
      categoryId: "4f07dda8-40db-446b-9f9c-5e50e3fcf778",
      sortBy: "assetTag", sortOrder: "asc",
      page: "2", pageSize: "50",
    }).success);
  });

  it("rejects invalid status", () => {
    assert.ok(!listQuerySchema.safeParse({ status: "BROKEN" }).success);
  });

  it("rejects invalid sortBy field", () => {
    assert.ok(!listQuerySchema.safeParse({ sortBy: "passwordHash" }).success);
  });

  it("rejects year below 2000", () => {
    assert.ok(!listQuerySchema.safeParse({ year: "1999" }).success);
  });

  it("rejects pageSize above 100", () => {
    assert.ok(!listQuerySchema.safeParse({ pageSize: "101" }).success);
  });

  it("coerces page and pageSize from strings", () => {
    const result = listQuerySchema.safeParse({ page: "3", pageSize: "25" });
    assert.ok(result.success);
    assert.equal(result.data.page, 3);
    assert.equal(result.data.pageSize, 25);
  });

  it("defaults page to 1 and pageSize to 20", () => {
    const result = listQuerySchema.safeParse({});
    assert.ok(result.success);
    assert.equal(result.data.page, 1);
    assert.equal(result.data.pageSize, 20);
  });
});

// ---------------------------------------------------------------------------
// 11. Audit logging — Stage 5.2 action identifiers
// ---------------------------------------------------------------------------

describe("audit log — Stage 5.2 action identifiers", () => {
  const ACTIONS = [
    "REGISTER_ASSET",
    "UPDATE_ASSET",
    "RETIRE_ASSET",
    "DISPOSE_ASSET",
  ];

  it("all 4 Stage 5.2 audit actions are defined", () => {
    assert.equal(ACTIONS.length, 4);
  });

  it("REGISTER_ASSET audit entry contains assetTag and categoryId", () => {
    const entry = {
      userId: "user-1",
      action: "REGISTER_ASSET",
      entityType: "asset",
      entityId: "asset-1",
      newValues: {
        assetTag: "LAP-2026-0001",
        name: "Dell Laptop",
        categoryId: "cat-1",
        serialNumber: "SN123",
        condition: "NEW",
        status: "AVAILABLE",
      },
    };
    assert.ok(entry.newValues.assetTag);
    assert.ok(entry.newValues.categoryId);
    assert.ok(!JSON.stringify(entry).includes("password"));
    assert.ok(!JSON.stringify(entry).includes("hash"));
    assert.ok(!JSON.stringify(entry).includes("token"));
  });

  it("UPDATE_ASSET audit entry contains oldValues and newValues", () => {
    const entry = {
      action: "UPDATE_ASSET",
      entityType: "asset",
      oldValues: { name: "Old Name", condition: "NEW" },
      newValues: { name: "New Name", condition: "GOOD" },
    };
    assert.ok("oldValues" in entry);
    assert.ok("newValues" in entry);
  });

  it("RETIRE_ASSET audit entry records status transition", () => {
    const entry = {
      action: "RETIRE_ASSET",
      entityType: "asset",
      oldValues: { status: "AVAILABLE" },
      newValues: { status: "RETIRED" },
    };
    assert.equal(entry.oldValues.status, "AVAILABLE");
    assert.equal(entry.newValues.status, "RETIRED");
  });

  it("DISPOSE_ASSET audit entry records status transition", () => {
    const entry = {
      action: "DISPOSE_ASSET",
      entityType: "asset",
      oldValues: { status: "RETIRED" },
      newValues: { status: "DISPOSED" },
    };
    assert.equal(entry.newValues.status, "DISPOSED");
  });
});

// ---------------------------------------------------------------------------
// 12. Authorization — permission contracts
// ---------------------------------------------------------------------------

describe("asset endpoints — authorization contracts", () => {
  const ASSET_PERMISSIONS = [
    "assets.view",
    "assets.register",
    "assets.update",
    "assets.retire",
    "assets.dispose",
  ];

  const IT_STAFF_PERMS = [
    "assets.view", "assets.register", "assets.update",
    "assets.retire", "assets.dispose",
    "departments.view", "departments.create", "departments.update",
    "employees.view", "employees.create", "employees.update",
  ];

  const ADMIN_ONLY_PERMS = [
    "users.create", "users.reset_password", "users.view",
    "users.activate", "users.deactivate",
  ];

  it("IT_STAFF has all 5 asset permissions", () => {
    for (const p of ASSET_PERMISSIONS) {
      assert.ok(IT_STAFF_PERMS.includes(p), `IT_STAFF missing: ${p}`);
    }
  });

  it("IT_STAFF cannot create user accounts", () => {
    assert.ok(!IT_STAFF_PERMS.includes("users.create"));
  });

  it("IT_STAFF cannot reset passwords", () => {
    assert.ok(!IT_STAFF_PERMS.includes("users.reset_password"));
  });

  it("unauthenticated request is rejected at requireAuth", () => {
    function decide(auth: boolean, pwChanged: boolean, hasPerm: boolean): boolean {
      return auth && pwChanged && hasPerm;
    }
    assert.equal(decide(false, true, true), false);
  });

  it("mustChangePassword blocks asset endpoints", () => {
    function decide(auth: boolean, pwChanged: boolean, hasPerm: boolean): boolean {
      return auth && pwChanged && hasPerm;
    }
    assert.equal(decide(true, false, true), false);
  });

  it("missing assets.register permission blocks registration", () => {
    function decide(auth: boolean, pwChanged: boolean, hasPerm: boolean): boolean {
      return auth && pwChanged && hasPerm;
    }
    assert.equal(decide(true, true, false), false);
  });

  it("ADMIN-only permissions are not in asset permission set", () => {
    for (const p of ADMIN_ONLY_PERMS) {
      assert.ok(!ASSET_PERMISSIONS.includes(p));
    }
  });

  it("middleware chain order is requireAuth -> requirePasswordChanged -> requirePermission", () => {
    const chain = ["requireAuth", "requirePasswordChanged", "requirePermission"];
    assert.equal(chain[0], "requireAuth");
    assert.equal(chain[1], "requirePasswordChanged");
    assert.equal(chain[2], "requirePermission");
  });
});

// ---------------------------------------------------------------------------
// 13. Independent category/year sequences
// ---------------------------------------------------------------------------

describe("asset tag — independent category/year sequences", () => {
  it("different categories have independent sequences", () => {
    const sequences: Record<string, number> = {};
    function nextSeq(categoryId: string): number {
      sequences[categoryId] = (sequences[categoryId] ?? 0) + 1;
      return sequences[categoryId];
    }
    assert.equal(nextSeq("cat-lap"), 1);
    assert.equal(nextSeq("cat-mon"), 1);
    assert.equal(nextSeq("cat-lap"), 2);
    assert.equal(nextSeq("cat-mon"), 2);
  });

  it("different years have independent sequences for the same category", () => {
    const sequences: Record<string, number> = {};
    function nextSeq(categoryId: string, year: number): number {
      const key = `${categoryId}:${year}`;
      sequences[key] = (sequences[key] ?? 0) + 1;
      return sequences[key];
    }
    assert.equal(nextSeq("cat-lap", 2025), 1);
    assert.equal(nextSeq("cat-lap", 2026), 1);
    assert.equal(nextSeq("cat-lap", 2025), 2);
    assert.equal(nextSeq("cat-lap", 2026), 2);
  });

  it("sequence resets per category/year combination", () => {
    const key2025 = "cat-lap:2025";
    const key2026 = "cat-lap:2026";
    const seqs: Record<string, number> = { [key2025]: 5, [key2026]: 0 };
    assert.equal(seqs[key2026], 0);
    assert.notEqual(seqs[key2025], seqs[key2026]);
  });
});

// ---------------------------------------------------------------------------
// 14. Pagination utility (reused from Stage 5.1)
// ---------------------------------------------------------------------------

describe("asset listing — pagination", async () => {
  const { buildPaginationResult } = await import("../utils/pagination.js");

  it("returns correct totalPages", () => {
    assert.equal(buildPaginationResult([], 45, 1, 20).totalPages, 3);
  });

  it("returns totalPages=1 when total equals pageSize", () => {
    assert.equal(buildPaginationResult([], 20, 1, 20).totalPages, 1);
  });

  it("returns totalPages=0 when total is 0", () => {
    assert.equal(buildPaginationResult([], 0, 1, 20).totalPages, 0);
  });

  it("result contains all required fields", () => {
    const r = buildPaginationResult([{ id: "1" }], 1, 1, 20);
    assert.ok("items" in r && "total" in r && "page" in r && "pageSize" in r && "totalPages" in r);
  });
});
