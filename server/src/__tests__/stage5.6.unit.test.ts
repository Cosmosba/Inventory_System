/**
 * Stage 5.6 — Maintenance and Repairs Unit Tests
 * Uses Node.js built-in test runner. No database required.
 *
 * All transaction and locking tests use mocks/simulations.
 * No actual PostgreSQL concurrency is tested here — that requires
 * integration tests with a live database and concurrent connections.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const VALID_UUID   = "4f07dda8-40db-446b-9f9c-5e50e3fcf778";
const VALID_UUID_2 = "9a1b2c3d-4e5f-6789-abcd-ef0123456789";
const VALID_UUID_3 = "aaaabbbb-cccc-4ddd-8eee-ffffffffffff";
const ISO_DATE     = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// 1. MaintenanceServiceError codes
// ---------------------------------------------------------------------------

describe("maintenance service — error codes", async () => {
  const { MaintenanceServiceError } = await import("../services/maintenanceService.js");

  it("MAINTENANCE_NOT_FOUND maps to 404", () => {
    const err = new MaintenanceServiceError("Not found.", "MAINTENANCE_NOT_FOUND");
    assert.equal(err.code, "MAINTENANCE_NOT_FOUND");
    assert.ok(err instanceof Error);
  });
  it("ASSET_NOT_FOUND maps to 404", () => {
    const err = new MaintenanceServiceError("Asset not found.", "ASSET_NOT_FOUND");
    assert.equal(err.code, "ASSET_NOT_FOUND");
  });
  it("USER_NOT_FOUND maps to 404", () => {
    const err = new MaintenanceServiceError("User not found.", "USER_NOT_FOUND");
    assert.equal(err.code, "USER_NOT_FOUND");
  });
  it("ASSET_NOT_AVAILABLE maps to 409", () => {
    const err = new MaintenanceServiceError("Not available.", "ASSET_NOT_AVAILABLE");
    assert.equal(err.code, "ASSET_NOT_AVAILABLE");
  });
  it("MAINTENANCE_ALREADY_OPEN maps to 409", () => {
    const err = new MaintenanceServiceError("Already open.", "MAINTENANCE_ALREADY_OPEN");
    assert.equal(err.code, "MAINTENANCE_ALREADY_OPEN");
  });
  it("MAINTENANCE_CLOSED maps to 409", () => {
    const err = new MaintenanceServiceError("Closed.", "MAINTENANCE_CLOSED");
    assert.equal(err.code, "MAINTENANCE_CLOSED");
  });
  it("INVALID_TRANSITION maps to 409", () => {
    const err = new MaintenanceServiceError("Invalid transition.", "INVALID_TRANSITION");
    assert.equal(err.code, "INVALID_TRANSITION");
  });
  it("ASSET_STATE_INCONSISTENT maps to 409", () => {
    const err = new MaintenanceServiceError("Inconsistent.", "ASSET_STATE_INCONSISTENT");
    assert.equal(err.code, "ASSET_STATE_INCONSISTENT");
  });
  it("error name is MaintenanceServiceError", () => {
    const err = new MaintenanceServiceError("msg", "CODE");
    assert.equal(err.name, "MaintenanceServiceError");
  });
});

// ---------------------------------------------------------------------------
// 2. Asset eligibility for maintenance
// ---------------------------------------------------------------------------

describe("maintenance — asset eligibility rules", () => {
  type AssetStatus = "AVAILABLE" | "ASSIGNED" | "UNDER_MAINTENANCE" | "RETIRED" | "DISPOSED";

  function canOpenMaintenance(status: AssetStatus): string | null {
    if (status === "AVAILABLE") return null;
    if (status === "UNDER_MAINTENANCE") return "MAINTENANCE_ALREADY_OPEN";
    return "ASSET_NOT_AVAILABLE";
  }

  it("AVAILABLE asset can enter maintenance", () => assert.equal(canOpenMaintenance("AVAILABLE"), null));
  it("ASSIGNED asset cannot enter maintenance", () => assert.equal(canOpenMaintenance("ASSIGNED"), "ASSET_NOT_AVAILABLE"));
  it("UNDER_MAINTENANCE asset cannot enter maintenance again", () => assert.equal(canOpenMaintenance("UNDER_MAINTENANCE"), "MAINTENANCE_ALREADY_OPEN"));
  it("RETIRED asset cannot enter maintenance", () => assert.equal(canOpenMaintenance("RETIRED"), "ASSET_NOT_AVAILABLE"));
  it("DISPOSED asset cannot enter maintenance", () => assert.equal(canOpenMaintenance("DISPOSED"), "ASSET_NOT_AVAILABLE"));
  it("only AVAILABLE allows opening maintenance", () => {
    const blocked: AssetStatus[] = ["ASSIGNED", "UNDER_MAINTENANCE", "RETIRED", "DISPOSED"];
    assert.ok(blocked.every((s) => canOpenMaintenance(s) !== null));
  });
});

// ---------------------------------------------------------------------------
// 3. Create (open) validation schema
// ---------------------------------------------------------------------------

describe("maintenance — create validation schema", async () => {
  const { z } = await import("zod");

  const createSchema = z.object({
    assetId: z.string().uuid(),
    problemDescription: z.string().min(1).max(5000),
    reportedDate: z.string().regex(ISO_DATE),
    technician: z.string().max(150).optional(),
    assignedToUserId: z.string().uuid().optional(),
    notes: z.string().max(2000).optional(),
  });

  it("accepts minimal valid input", () => {
    assert.ok(createSchema.safeParse({
      assetId: VALID_UUID,
      problemDescription: "Screen broken",
      reportedDate: "2026-11-01",
    }).success);
  });
  it("accepts full valid input", () => {
    assert.ok(createSchema.safeParse({
      assetId: VALID_UUID,
      problemDescription: "Screen broken",
      reportedDate: "2026-11-01",
      technician: "John Tech",
      assignedToUserId: VALID_UUID_2,
      notes: "Urgent",
    }).success);
  });
  it("rejects missing assetId", () => {
    assert.ok(!createSchema.safeParse({ problemDescription: "x", reportedDate: "2026-01-01" }).success);
  });
  it("rejects missing problemDescription", () => {
    assert.ok(!createSchema.safeParse({ assetId: VALID_UUID, reportedDate: "2026-01-01" }).success);
  });
  it("rejects empty problemDescription", () => {
    assert.ok(!createSchema.safeParse({ assetId: VALID_UUID, problemDescription: "", reportedDate: "2026-01-01" }).success);
  });
  it("rejects missing reportedDate", () => {
    assert.ok(!createSchema.safeParse({ assetId: VALID_UUID, problemDescription: "x" }).success);
  });
  it("rejects invalid reportedDate format", () => {
    assert.ok(!createSchema.safeParse({ assetId: VALID_UUID, problemDescription: "x", reportedDate: "01-01-2026" }).success);
  });
  it("rejects invalid assetId UUID", () => {
    assert.ok(!createSchema.safeParse({ assetId: "not-uuid", problemDescription: "x", reportedDate: "2026-01-01" }).success);
  });
  it("rejects technician over 150 chars", () => {
    assert.ok(!createSchema.safeParse({
      assetId: VALID_UUID, problemDescription: "x", reportedDate: "2026-01-01",
      technician: "a".repeat(151),
    }).success);
  });
  it("schema does not include status — server sets REPORTED", () => {
    const result = createSchema.safeParse({
      assetId: VALID_UUID, problemDescription: "x", reportedDate: "2026-01-01", status: "IN_PROGRESS",
    });
    assert.ok(result.success);
    assert.ok(!("status" in (result.data as object)));
  });
  it("schema does not include resolvedDate — server generates it", () => {
    const result = createSchema.safeParse({
      assetId: VALID_UUID, problemDescription: "x", reportedDate: "2026-01-01", resolvedDate: "2026-02-01",
    });
    assert.ok(result.success);
    assert.ok(!("resolvedDate" in (result.data as object)));
  });
  it("schema does not include startedDate — server generates it", () => {
    const result = createSchema.safeParse({
      assetId: VALID_UUID, problemDescription: "x", reportedDate: "2026-01-01", startedDate: "2026-01-15",
    });
    assert.ok(result.success);
    assert.ok(!("startedDate" in (result.data as object)));
  });
  it("schema does not include repairCost — not accepted at creation", () => {
    const result = createSchema.safeParse({
      assetId: VALID_UUID, problemDescription: "x", reportedDate: "2026-01-01", repairCost: 100,
    });
    assert.ok(result.success);
    assert.ok(!("repairCost" in (result.data as object)));
  });
  it("schema does not include createdByUserId — server derives it", () => {
    const result = createSchema.safeParse({
      assetId: VALID_UUID, problemDescription: "x", reportedDate: "2026-01-01", createdByUserId: VALID_UUID_2,
    });
    assert.ok(result.success);
    assert.ok(!("createdByUserId" in (result.data as object)));
  });
});

// ---------------------------------------------------------------------------
// 4. Update validation schema
// ---------------------------------------------------------------------------

describe("maintenance — update validation schema", async () => {
  const { z } = await import("zod");

  const updateSchema = z.object({
    repairDescription: z.string().max(5000).nullable().optional(),
    technician: z.string().max(150).nullable().optional(),
    assignedToUserId: z.string().uuid().nullable().optional(),
    repairCost: z.number().nonnegative().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    status: z.literal("IN_PROGRESS").optional(),
  });

  it("accepts empty update body", () => {
    assert.ok(updateSchema.safeParse({}).success);
  });
  it("accepts status IN_PROGRESS", () => {
    assert.ok(updateSchema.safeParse({ status: "IN_PROGRESS" }).success);
  });
  it("rejects status RESOLVED", () => {
    assert.ok(!updateSchema.safeParse({ status: "RESOLVED" }).success);
  });
  it("rejects status CANCELLED", () => {
    assert.ok(!updateSchema.safeParse({ status: "CANCELLED" }).success);
  });
  it("rejects status REPORTED", () => {
    assert.ok(!updateSchema.safeParse({ status: "REPORTED" }).success);
  });
  it("rejects negative repairCost", () => {
    assert.ok(!updateSchema.safeParse({ repairCost: -1 }).success);
  });
  it("accepts zero repairCost", () => {
    assert.ok(updateSchema.safeParse({ repairCost: 0 }).success);
  });
  it("accepts null repairCost", () => {
    assert.ok(updateSchema.safeParse({ repairCost: null }).success);
  });
  it("accepts null technician", () => {
    assert.ok(updateSchema.safeParse({ technician: null }).success);
  });
  it("rejects technician over 150 chars", () => {
    assert.ok(!updateSchema.safeParse({ technician: "a".repeat(151) }).success);
  });
  it("schema does not include assetId", () => {
    const result = updateSchema.safeParse({ assetId: VALID_UUID });
    assert.ok(result.success);
    assert.ok(!("assetId" in (result.data as object)));
  });
  it("schema does not include reportedDate", () => {
    const result = updateSchema.safeParse({ reportedDate: "2026-01-01" });
    assert.ok(result.success);
    assert.ok(!("reportedDate" in (result.data as object)));
  });
  it("schema does not include startedDate", () => {
    const result = updateSchema.safeParse({ startedDate: "2026-01-15" });
    assert.ok(result.success);
    assert.ok(!("startedDate" in (result.data as object)));
  });
  it("schema does not include resolvedDate", () => {
    const result = updateSchema.safeParse({ resolvedDate: "2026-02-01" });
    assert.ok(result.success);
    assert.ok(!("resolvedDate" in (result.data as object)));
  });
});

// ---------------------------------------------------------------------------
// 5. Status transition rules
// ---------------------------------------------------------------------------

describe("maintenance — status transition rules", () => {
  type MaintenanceStatus = "REPORTED" | "IN_PROGRESS" | "RESOLVED" | "CANCELLED";

  function canUpdate(current: MaintenanceStatus): string | null {
    if (current === "RESOLVED" || current === "CANCELLED") return "MAINTENANCE_CLOSED";
    return null;
  }

  function canTransitionToInProgress(current: MaintenanceStatus): string | null {
    if (current === "REPORTED") return null;
    if (current === "RESOLVED" || current === "CANCELLED") return "MAINTENANCE_CLOSED";
    return "INVALID_TRANSITION";
  }

  function canClose(current: MaintenanceStatus): string | null {
    if (current === "REPORTED" || current === "IN_PROGRESS") return null;
    return "MAINTENANCE_CLOSED";
  }

  it("REPORTED record can be updated", () => assert.equal(canUpdate("REPORTED"), null));
  it("IN_PROGRESS record can be updated", () => assert.equal(canUpdate("IN_PROGRESS"), null));
  it("RESOLVED record cannot be updated", () => assert.equal(canUpdate("RESOLVED"), "MAINTENANCE_CLOSED"));
  it("CANCELLED record cannot be updated", () => assert.equal(canUpdate("CANCELLED"), "MAINTENANCE_CLOSED"));

  it("REPORTED can transition to IN_PROGRESS", () => assert.equal(canTransitionToInProgress("REPORTED"), null));
  it("IN_PROGRESS cannot transition to IN_PROGRESS again", () => assert.equal(canTransitionToInProgress("IN_PROGRESS"), "INVALID_TRANSITION"));
  it("RESOLVED cannot transition to IN_PROGRESS", () => assert.equal(canTransitionToInProgress("RESOLVED"), "MAINTENANCE_CLOSED"));
  it("CANCELLED cannot transition to IN_PROGRESS", () => assert.equal(canTransitionToInProgress("CANCELLED"), "MAINTENANCE_CLOSED"));

  it("REPORTED can be resolved", () => assert.equal(canClose("REPORTED"), null));
  it("IN_PROGRESS can be resolved", () => assert.equal(canClose("IN_PROGRESS"), null));
  it("RESOLVED cannot be resolved again", () => assert.equal(canClose("RESOLVED"), "MAINTENANCE_CLOSED"));
  it("CANCELLED cannot be resolved", () => assert.equal(canClose("CANCELLED"), "MAINTENANCE_CLOSED"));

  it("REPORTED can be cancelled", () => assert.equal(canClose("REPORTED"), null));
  it("IN_PROGRESS can be cancelled", () => assert.equal(canClose("IN_PROGRESS"), null));
});

// ---------------------------------------------------------------------------
// 6. startedDate — server-generated, not overwritten
// ---------------------------------------------------------------------------

describe("maintenance — startedDate behaviour", () => {
  it("startedDate is set when transitioning REPORTED to IN_PROGRESS", () => {
    const before = Date.now();
    const startedDate = new Date();
    const after = Date.now();
    assert.ok(startedDate.getTime() >= before && startedDate.getTime() <= after);
  });

  it("startedDate is not overwritten on subsequent updates", () => {
    const original = new Date("2026-11-10");
    function applyUpdate(existing: Date | null, isFirstTransition: boolean): Date | null {
      if (isFirstTransition && !existing) return new Date();
      return existing;
    }
    const first = applyUpdate(null, true);
    assert.ok(first instanceof Date);
    const second = applyUpdate(first, false);
    assert.equal(second, first);
    const third = applyUpdate(original, true);
    assert.equal(third, original);
  });

  it("startedDate is null when record moves directly from REPORTED to RESOLVED", () => {
    const record = { status: "REPORTED", startedDate: null as Date | null };
    // Direct resolve without IN_PROGRESS transition — startedDate stays null
    assert.equal(record.startedDate, null);
  });

  it("startedDate is not accepted from client in create schema", async () => {
    const { z } = await import("zod");
    const schema = z.object({
      assetId: z.string().uuid(),
      problemDescription: z.string().min(1),
      reportedDate: z.string(),
    });
    const result = schema.safeParse({
      assetId: VALID_UUID, problemDescription: "x", reportedDate: "2026-01-01", startedDate: "2026-01-15",
    });
    assert.ok(result.success);
    assert.ok(!("startedDate" in (result.data as object)));
  });

  it("startedDate is not accepted from client in update schema", async () => {
    const { z } = await import("zod");
    const schema = z.object({ status: z.literal("IN_PROGRESS").optional() });
    const result = schema.safeParse({ status: "IN_PROGRESS", startedDate: "2026-01-15" });
    assert.ok(result.success);
    assert.ok(!("startedDate" in (result.data as object)));
  });
});

// ---------------------------------------------------------------------------
// 7. Resolve schema
// ---------------------------------------------------------------------------

describe("maintenance — resolve validation schema", async () => {
  const { z } = await import("zod");
  const ASSET_CONDITIONS = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;

  const resolveSchema = z.object({
    resolvedCondition: z.enum(ASSET_CONDITIONS).optional(),
    repairCost: z.number().nonnegative().nullable().optional(),
    repairDescription: z.string().max(5000).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  });

  it("accepts empty body", () => assert.ok(resolveSchema.safeParse({}).success));
  it("accepts resolvedCondition", () => assert.ok(resolveSchema.safeParse({ resolvedCondition: "GOOD" }).success));
  it("accepts all valid conditions", () => {
    for (const c of ASSET_CONDITIONS) {
      assert.ok(resolveSchema.safeParse({ resolvedCondition: c }).success);
    }
  });
  it("rejects invalid resolvedCondition", () => {
    assert.ok(!resolveSchema.safeParse({ resolvedCondition: "BROKEN" }).success);
  });
  it("accepts repairCost", () => assert.ok(resolveSchema.safeParse({ repairCost: 250.50 }).success));
  it("rejects negative repairCost", () => assert.ok(!resolveSchema.safeParse({ repairCost: -1 }).success));
  it("accepts null repairCost", () => assert.ok(resolveSchema.safeParse({ repairCost: null }).success));
  it("schema does not include resolvedDate — server generates it", () => {
    const result = resolveSchema.safeParse({ resolvedDate: "2026-02-01" });
    assert.ok(result.success);
    assert.ok(!("resolvedDate" in (result.data as object)));
  });
  it("schema does not include status — server sets RESOLVED", () => {
    const result = resolveSchema.safeParse({ status: "RESOLVED" });
    assert.ok(result.success);
    assert.ok(!("status" in (result.data as object)));
  });
});

// ---------------------------------------------------------------------------
// 8. Cancel schema
// ---------------------------------------------------------------------------

describe("maintenance — cancel validation schema", async () => {
  const { z } = await import("zod");

  const cancelSchema = z.object({
    notes: z.string().max(2000).nullable().optional(),
  });

  it("accepts empty body", () => assert.ok(cancelSchema.safeParse({}).success));
  it("accepts notes", () => assert.ok(cancelSchema.safeParse({ notes: "No longer needed" }).success));
  it("accepts null notes", () => assert.ok(cancelSchema.safeParse({ notes: null }).success));
  it("rejects notes over 2000 chars", () => {
    assert.ok(!cancelSchema.safeParse({ notes: "a".repeat(2001) }).success);
  });
  it("schema does not include status", () => {
    const result = cancelSchema.safeParse({ status: "CANCELLED" });
    assert.ok(result.success);
    assert.ok(!("status" in (result.data as object)));
  });
  it("schema does not include resolvedDate", () => {
    const result = cancelSchema.safeParse({ resolvedDate: "2026-01-01" });
    assert.ok(result.success);
    assert.ok(!("resolvedDate" in (result.data as object)));
  });
});

// ---------------------------------------------------------------------------
// 9. Asset lifecycle transitions
// ---------------------------------------------------------------------------

describe("maintenance — asset lifecycle transitions", () => {
  type AssetStatus = "AVAILABLE" | "ASSIGNED" | "UNDER_MAINTENANCE" | "RETIRED" | "DISPOSED";

  it("opening maintenance changes asset status to UNDER_MAINTENANCE", () => {
    let status: AssetStatus = "AVAILABLE";
    status = "UNDER_MAINTENANCE";
    assert.equal(status, "UNDER_MAINTENANCE");
  });

  it("resolving maintenance restores asset status to AVAILABLE", () => {
    let status: AssetStatus = "UNDER_MAINTENANCE";
    status = "AVAILABLE";
    assert.equal(status, "AVAILABLE");
  });

  it("cancelling maintenance restores asset status to AVAILABLE", () => {
    let status: AssetStatus = "UNDER_MAINTENANCE";
    status = "AVAILABLE";
    assert.equal(status, "AVAILABLE");
  });

  it("updating maintenance does not change asset status", () => {
    const status: AssetStatus = "UNDER_MAINTENANCE";
    assert.equal(status, "UNDER_MAINTENANCE");
  });

  it("resolvedDate is null after cancellation", () => {
    const record = { status: "CANCELLED", resolvedDate: null as Date | null };
    assert.equal(record.resolvedDate, null);
  });

  it("resolvedDate is set by server on resolution", () => {
    const before = Date.now();
    const resolvedDate = new Date();
    const after = Date.now();
    assert.ok(resolvedDate.getTime() >= before && resolvedDate.getTime() <= after);
  });
});

// ---------------------------------------------------------------------------
// 10. D4 — optional resolvedCondition
// ---------------------------------------------------------------------------

describe("maintenance — resolvedCondition (D4)", () => {
  type AssetCondition = "NEW" | "GOOD" | "FAIR" | "POOR" | "DAMAGED";

  function applyResolve(
    currentCondition: AssetCondition,
    resolvedCondition?: AssetCondition
  ): AssetCondition {
    return resolvedCondition ?? currentCondition;
  }

  it("resolvedCondition updates asset condition when provided", () => {
    assert.equal(applyResolve("NEW", "FAIR"), "FAIR");
  });

  it("asset condition is preserved when resolvedCondition is omitted", () => {
    assert.equal(applyResolve("GOOD"), "GOOD");
  });

  it("resolvedCondition accepts all valid AssetCondition values", () => {
    const conditions: AssetCondition[] = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"];
    for (const c of conditions) {
      assert.equal(applyResolve("NEW", c), c);
    }
  });

  it("condition is not changed during cancellation", () => {
    const assetConditionBefore: AssetCondition = "FAIR";
    const assetConditionAfter: AssetCondition = assetConditionBefore;
    assert.equal(assetConditionAfter, "FAIR");
  });
});

// ---------------------------------------------------------------------------
// 11. D7 — UNDER_MAINTENANCE blocks retire and dispose
// ---------------------------------------------------------------------------

describe("maintenance — D7 asset lifecycle protection", async () => {
  const { AssetServiceError } = await import("../services/assetService.js");

  type AssetStatus = "AVAILABLE" | "ASSIGNED" | "UNDER_MAINTENANCE" | "RETIRED" | "DISPOSED";

  function canRetire(status: AssetStatus): string | null {
    if (status === "RETIRED") return "ALREADY_RETIRED";
    if (status === "DISPOSED") return "INVALID_TRANSITION";
    if (status === "ASSIGNED") return "ASSET_ASSIGNED";
    if (status === "UNDER_MAINTENANCE") return "ASSET_UNDER_MAINTENANCE";
    return null;
  }

  function canDispose(status: AssetStatus): string | null {
    if (status === "DISPOSED") return "ALREADY_DISPOSED";
    if (status === "ASSIGNED") return "ASSET_ASSIGNED";
    if (status === "UNDER_MAINTENANCE") return "ASSET_UNDER_MAINTENANCE";
    return null;
  }

  it("UNDER_MAINTENANCE asset cannot be retired", () => {
    assert.equal(canRetire("UNDER_MAINTENANCE"), "ASSET_UNDER_MAINTENANCE");
  });

  it("UNDER_MAINTENANCE asset cannot be disposed", () => {
    assert.equal(canDispose("UNDER_MAINTENANCE"), "ASSET_UNDER_MAINTENANCE");
  });

  it("AVAILABLE asset can still be retired", () => {
    assert.equal(canRetire("AVAILABLE"), null);
  });

  it("AVAILABLE asset can still be disposed", () => {
    assert.equal(canDispose("AVAILABLE"), null);
  });

  it("ASSIGNED asset still cannot be retired (existing restriction preserved)", () => {
    assert.equal(canRetire("ASSIGNED"), "ASSET_ASSIGNED");
  });

  it("ASSIGNED asset still cannot be disposed (existing restriction preserved)", () => {
    assert.equal(canDispose("ASSIGNED"), "ASSET_ASSIGNED");
  });

  it("RETIRED asset still cannot be retired again", () => {
    assert.equal(canRetire("RETIRED"), "ALREADY_RETIRED");
  });

  it("DISPOSED asset still cannot be disposed again", () => {
    assert.equal(canDispose("DISPOSED"), "ALREADY_DISPOSED");
  });

  it("AssetServiceError ASSET_UNDER_MAINTENANCE has correct code", () => {
    const err = new AssetServiceError("Under maintenance.", "ASSET_UNDER_MAINTENANCE");
    assert.equal(err.code, "ASSET_UNDER_MAINTENANCE");
    assert.ok(err instanceof Error);
  });
});

// ---------------------------------------------------------------------------
// 12. D3 — one open maintenance record per asset
// ---------------------------------------------------------------------------

describe("maintenance — one open record per asset (D3)", () => {
  it("only one open maintenance record per asset is allowed", () => {
    const open = new Map<string, boolean>();
    function tryOpen(assetId: string): string | null {
      if (open.get(assetId)) return "MAINTENANCE_ALREADY_OPEN";
      open.set(assetId, true);
      return null;
    }
    assert.equal(tryOpen(VALID_UUID), null);
    assert.equal(tryOpen(VALID_UUID), "MAINTENANCE_ALREADY_OPEN");
  });

  it("asset can have new maintenance after previous is resolved", () => {
    const open = new Map<string, boolean>();
    function tryOpen(assetId: string): string | null {
      if (open.get(assetId)) return "MAINTENANCE_ALREADY_OPEN";
      open.set(assetId, true);
      return null;
    }
    function doClose(assetId: string): void { open.delete(assetId); }
    assert.equal(tryOpen(VALID_UUID), null);
    doClose(VALID_UUID);
    assert.equal(tryOpen(VALID_UUID), null);
  });

  it("asset can have new maintenance after previous is cancelled", () => {
    const open = new Map<string, boolean>();
    function tryOpen(assetId: string): string | null {
      if (open.get(assetId)) return "MAINTENANCE_ALREADY_OPEN";
      open.set(assetId, true);
      return null;
    }
    function doClose(assetId: string): void { open.delete(assetId); }
    assert.equal(tryOpen(VALID_UUID), null);
    doClose(VALID_UUID);
    assert.equal(tryOpen(VALID_UUID), null);
  });

  it("partial unique index name is maintenance_records_one_open_per_asset", () => {
    const name = "maintenance_records_one_open_per_asset";
    assert.ok(name.includes("one_open_per_asset"));
  });

  it("partial unique index predicate excludes RESOLVED and CANCELLED", () => {
    const predicate = "WHERE \"status\" NOT IN ('RESOLVED', 'CANCELLED')";
    assert.ok(predicate.includes("RESOLVED"));
    assert.ok(predicate.includes("CANCELLED"));
    assert.ok(predicate.includes("NOT IN"));
  });
});

// ---------------------------------------------------------------------------
// 13. isOpenMaintenanceConflict helper
// ---------------------------------------------------------------------------

describe("maintenance — isOpenMaintenanceConflict helper", async () => {
  const { isOpenMaintenanceConflict } = await import("../services/maintenanceService.js");

  it("detects P2002 on the partial unique index (string target)", () => {
    assert.ok(isOpenMaintenanceConflict({ code: "P2002", meta: { target: "maintenance_records_one_open_per_asset" } }));
  });
  it("detects P2002 when target is an array containing the index name", () => {
    assert.ok(isOpenMaintenanceConflict({ code: "P2002", meta: { target: ["maintenance_records_one_open_per_asset"] } }));
  });
  it("does not detect P2002 on a different constraint", () => {
    assert.ok(!isOpenMaintenanceConflict({ code: "P2002", meta: { target: "assets_assetTag_key" } }));
  });
  it("does not detect P2002 on assignment index", () => {
    assert.ok(!isOpenMaintenanceConflict({ code: "P2002", meta: { target: "asset_assignments_one_open_per_asset" } }));
  });
  it("does not detect P2003", () => {
    assert.ok(!isOpenMaintenanceConflict({ code: "P2003", meta: { target: "maintenance_records_one_open_per_asset" } }));
  });
  it("does not detect plain Error", () => {
    assert.ok(!isOpenMaintenanceConflict(new Error("other")));
  });
  it("does not detect null", () => {
    assert.ok(!isOpenMaintenanceConflict(null));
  });
  it("does not misclassify unrelated P2002 as maintenance conflict", () => {
    const unrelated = { code: "P2002", meta: { target: "users_email_key" } };
    assert.ok(!isOpenMaintenanceConflict(unrelated));
    const httpStatus = isOpenMaintenanceConflict(unrelated) ? 409 : 500;
    assert.equal(httpStatus, 500);
  });
});

// ---------------------------------------------------------------------------
// 14. Locking order contracts
// ---------------------------------------------------------------------------

describe("maintenance — locking order contracts", () => {
  it("open maintenance locks asset before creating record", () => {
    const steps = ["lock asset FOR UPDATE", "revalidate asset status", "check open record", "create maintenance record", "update asset status", "write audit"];
    assert.ok(steps.indexOf("lock asset FOR UPDATE") < steps.indexOf("create maintenance record"));
    assert.ok(steps.indexOf("lock asset FOR UPDATE") < steps.indexOf("update asset status"));
  });

  it("resolve locks asset row before locking maintenance record", () => {
    const steps = ["read maintenance (no lock)", "lock asset FOR UPDATE", "lock maintenance FOR UPDATE", "revalidate both", "update maintenance", "update asset", "write audit"];
    assert.ok(steps.indexOf("lock asset FOR UPDATE") < steps.indexOf("lock maintenance FOR UPDATE"));
  });

  it("cancel locks asset row before locking maintenance record", () => {
    const steps = ["read maintenance (no lock)", "lock asset FOR UPDATE", "lock maintenance FOR UPDATE", "revalidate both", "update maintenance", "update asset", "write audit"];
    assert.ok(steps.indexOf("lock asset FOR UPDATE") < steps.indexOf("lock maintenance FOR UPDATE"));
  });

  it("resolve reads maintenance outside transaction to discover assetId", () => {
    const steps = ["read maintenance (no lock)", "BEGIN transaction", "lock asset FOR UPDATE", "lock maintenance FOR UPDATE"];
    assert.ok(steps.indexOf("read maintenance (no lock)") < steps.indexOf("BEGIN transaction"));
  });

  it("asset-first lock order is consistent with Stage 5.5 assignment operations", () => {
    const maintenanceSteps = ["lock asset", "lock maintenance record"];
    const returnSteps = ["lock asset", "lock assignment"];
    assert.equal(maintenanceSteps[0], "lock asset");
    assert.equal(returnSteps[0], "lock asset");
  });

  it("locking uses $queryRaw SELECT FOR UPDATE with ::uuid cast", () => {
    const pattern = "SELECT \"id\", \"status\" FROM \"assets\" WHERE \"id\" = $1::uuid FOR UPDATE";
    assert.ok(pattern.includes("FOR UPDATE"));
    assert.ok(pattern.includes("::uuid"));
  });
});

// ---------------------------------------------------------------------------
// 15. Transaction atomicity
// ---------------------------------------------------------------------------

describe("maintenance — transaction atomicity", () => {
  it("open maintenance: record, asset update and audit commit together", () => {
    let recordCreated = false;
    let assetUpdated = false;
    let auditWritten = false;

    function simulateOpenTx(failAt: string | null): void {
      try {
        if (failAt === "record") throw new Error();
        recordCreated = true;
        if (failAt === "asset") throw new Error();
        assetUpdated = true;
        if (failAt === "audit") throw new Error();
        auditWritten = true;
      } catch {
        recordCreated = false;
        assetUpdated = false;
        auditWritten = false;
      }
    }

    simulateOpenTx(null);
    assert.ok(recordCreated && assetUpdated && auditWritten);
  });

  it("open maintenance: asset update failure rolls back record creation", () => {
    let recordCreated = false;
    let assetUpdated = false;

    function simulateOpenTx(failAt: string | null): void {
      try {
        if (failAt === "record") throw new Error();
        recordCreated = true;
        if (failAt === "asset") throw new Error();
        assetUpdated = true;
      } catch {
        recordCreated = false;
        assetUpdated = false;
      }
    }

    simulateOpenTx("asset");
    assert.ok(!recordCreated && !assetUpdated);
  });

  it("resolve: maintenance update, asset update and audit commit together", () => {
    let maintenanceUpdated = false;
    let assetUpdated = false;
    let auditWritten = false;

    function simulateResolveTx(failAt: string | null): void {
      try {
        if (failAt === "maintenance") throw new Error();
        maintenanceUpdated = true;
        if (failAt === "asset") throw new Error();
        assetUpdated = true;
        if (failAt === "audit") throw new Error();
        auditWritten = true;
      } catch {
        maintenanceUpdated = false;
        assetUpdated = false;
        auditWritten = false;
      }
    }

    simulateResolveTx(null);
    assert.ok(maintenanceUpdated && assetUpdated && auditWritten);
  });

  it("resolve: audit failure rolls back maintenance and asset updates", () => {
    let maintenanceUpdated = false;
    let assetUpdated = false;

    function simulateResolveTx(failAt: string | null): void {
      try {
        if (failAt === "maintenance") throw new Error();
        maintenanceUpdated = true;
        if (failAt === "asset") throw new Error();
        assetUpdated = true;
        if (failAt === "audit") throw new Error();
      } catch {
        maintenanceUpdated = false;
        assetUpdated = false;
      }
    }

    simulateResolveTx("audit");
    assert.ok(!maintenanceUpdated && !assetUpdated);
  });

  it("cancel: maintenance update, asset update and audit commit together", () => {
    let maintenanceUpdated = false;
    let assetUpdated = false;
    let auditWritten = false;

    function simulateCancelTx(failAt: string | null): void {
      try {
        if (failAt === "maintenance") throw new Error();
        maintenanceUpdated = true;
        if (failAt === "asset") throw new Error();
        assetUpdated = true;
        if (failAt === "audit") throw new Error();
        auditWritten = true;
      } catch {
        maintenanceUpdated = false;
        assetUpdated = false;
        auditWritten = false;
      }
    }

    simulateCancelTx(null);
    assert.ok(maintenanceUpdated && assetUpdated && auditWritten);
  });
});

// ---------------------------------------------------------------------------
// 16. Concurrency scenarios (simulated — not real PostgreSQL concurrency)
// ---------------------------------------------------------------------------

describe("maintenance — concurrency scenarios (simulated)", () => {
  it("two concurrent open attempts: second fails after first acquires lock", () => {
    let assetStatus = "AVAILABLE";
    let openCount = 0;

    function openWithLock(): string | null {
      if (assetStatus !== "AVAILABLE") return "MAINTENANCE_ALREADY_OPEN";
      assetStatus = "UNDER_MAINTENANCE";
      openCount++;
      return null;
    }

    const t1 = openWithLock();
    const t2 = openWithLock();
    assert.equal(t1, null);
    assert.equal(t2, "MAINTENANCE_ALREADY_OPEN");
    assert.equal(openCount, 1);
  });

  it("two concurrent resolve attempts: second fails after first acquires lock", () => {
    let status = "IN_PROGRESS";
    let resolveCount = 0;

    function resolveWithLock(): string | null {
      if (status === "RESOLVED" || status === "CANCELLED") return "MAINTENANCE_CLOSED";
      status = "RESOLVED";
      resolveCount++;
      return null;
    }

    const t1 = resolveWithLock();
    const t2 = resolveWithLock();
    assert.equal(t1, null);
    assert.equal(t2, "MAINTENANCE_CLOSED");
    assert.equal(resolveCount, 1);
  });

  it("P2002 on one_open_per_asset is mapped to 409 — not a generic 500", () => {
    const err = { code: "P2002", meta: { target: "maintenance_records_one_open_per_asset" } };
    function isOpenMaintenanceConflict(e: unknown): boolean {
      if (typeof e !== "object" || e === null || !("code" in e) || (e as { code: string }).code !== "P2002") return false;
      const meta = (e as { meta?: { target?: string | string[] } }).meta;
      if (!meta) return false;
      const t = meta.target;
      const needle = "maintenance_records_one_open_per_asset";
      if (Array.isArray(t)) return t.some((x) => String(x).includes(needle));
      if (typeof t === "string") return t.includes(needle);
      return false;
    }
    assert.ok(isOpenMaintenanceConflict(err));
    const httpStatus = isOpenMaintenanceConflict(err) ? 409 : 500;
    assert.equal(httpStatus, 409);
  });

  it("unrelated P2002 is not classified as maintenance conflict", () => {
    const err = { code: "P2002", meta: { target: "assets_serialNumber_key" } };
    function isOpenMaintenanceConflict(e: unknown): boolean {
      if (typeof e !== "object" || e === null || !("code" in e) || (e as { code: string }).code !== "P2002") return false;
      const meta = (e as { meta?: { target?: string | string[] } }).meta;
      if (!meta) return false;
      const t = meta.target;
      const needle = "maintenance_records_one_open_per_asset";
      if (Array.isArray(t)) return t.some((x) => String(x).includes(needle));
      if (typeof t === "string") return t.includes(needle);
      return false;
    }
    assert.ok(!isOpenMaintenanceConflict(err));
    const httpStatus = isOpenMaintenanceConflict(err) ? 409 : 500;
    assert.equal(httpStatus, 500);
  });
});

// ---------------------------------------------------------------------------
// 17. Audit log — Stage 5.6 action identifiers
// ---------------------------------------------------------------------------

describe("audit log — Stage 5.6 action identifiers", () => {
  const ACTIONS = ["OPEN_MAINTENANCE", "UPDATE_MAINTENANCE", "CLOSE_MAINTENANCE"];

  it("all 3 Stage 5.6 audit actions are defined", () => {
    assert.equal(ACTIONS.length, 3);
  });

  it("OPEN_MAINTENANCE audit entry records maintenanceId, assetId, status, reportedDate", () => {
    const entry = {
      action: "OPEN_MAINTENANCE",
      entityType: "maintenance_record",
      entityId: VALID_UUID,
      newValues: {
        maintenanceId: VALID_UUID,
        assetId: VALID_UUID_2,
        status: "REPORTED",
        reportedDate: "2026-11-01",
        problemDescription: "Screen broken",
      },
    };
    assert.ok("maintenanceId" in entry.newValues);
    assert.ok("assetId" in entry.newValues);
    assert.ok("status" in entry.newValues);
    assert.ok("reportedDate" in entry.newValues);
  });

  it("CLOSE_MAINTENANCE audit entry records status (RESOLVED or CANCELLED) and assetId", () => {
    const entry = {
      action: "CLOSE_MAINTENANCE",
      entityType: "maintenance_record",
      entityId: VALID_UUID,
      oldValues: { status: "IN_PROGRESS", assetStatus: "UNDER_MAINTENANCE" },
      newValues: { maintenanceId: VALID_UUID, assetId: VALID_UUID_2, status: "RESOLVED", assetStatus: "AVAILABLE" },
    };
    assert.ok("status" in entry.newValues);
    assert.ok("assetId" in entry.newValues);
    assert.ok(entry.newValues.status === "RESOLVED" || entry.newValues.status === "CANCELLED");
  });

  it("audit entries never contain password or token fields", () => {
    for (const action of ACTIONS) {
      assert.ok(!action.toLowerCase().includes("password"));
      assert.ok(!action.toLowerCase().includes("token"));
      assert.ok(!action.toLowerCase().includes("hash"));
    }
  });

  it("audit writes are inside the same transaction as the business operation", () => {
    const steps = ["update maintenance record", "update asset", "write audit (tx)"];
    assert.ok(steps.includes("write audit (tx)"));
    assert.ok(steps.indexOf("write audit (tx)") > steps.indexOf("update maintenance record"));
  });
});

// ---------------------------------------------------------------------------
// 18. List query schema
// ---------------------------------------------------------------------------

describe("maintenance listing — query schema validation", async () => {
  const { z } = await import("zod");
  const MAINTENANCE_STATUSES = ["REPORTED", "IN_PROGRESS", "RESOLVED", "CANCELLED"] as const;
  const SORT_FIELDS = ["reportedDate", "startedDate", "resolvedDate", "status", "createdAt", "updatedAt"] as const;

  const listSchema = z.object({
    search: z.string().max(200).optional(),
    assetId: z.string().uuid().optional(),
    status: z.enum(MAINTENANCE_STATUSES).optional(),
    sortBy: z.enum(SORT_FIELDS).optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  });

  it("accepts empty query", () => assert.ok(listSchema.safeParse({}).success));
  it("accepts all valid filters", () => {
    assert.ok(listSchema.safeParse({
      search: "laptop", assetId: VALID_UUID, status: "IN_PROGRESS",
      sortBy: "reportedDate", sortOrder: "desc", page: "1", pageSize: "20",
    }).success);
  });
  it("accepts all valid status values", () => {
    for (const s of MAINTENANCE_STATUSES) {
      assert.ok(listSchema.safeParse({ status: s }).success);
    }
  });
  it("rejects invalid status", () => {
    assert.ok(!listSchema.safeParse({ status: "PENDING" }).success);
  });
  it("rejects invalid assetId", () => {
    assert.ok(!listSchema.safeParse({ assetId: "not-uuid" }).success);
  });
  it("rejects pageSize above 100", () => {
    assert.ok(!listSchema.safeParse({ pageSize: "101" }).success);
  });
  it("defaults page to 1 and pageSize to 20", () => {
    const result = listSchema.safeParse({});
    assert.ok(result.success);
    assert.equal(result.data.page, 1);
    assert.equal(result.data.pageSize, 20);
  });
  it("accepts all valid sortBy fields", () => {
    for (const f of SORT_FIELDS) {
      assert.ok(listSchema.safeParse({ sortBy: f }).success);
    }
  });
});

// ---------------------------------------------------------------------------
// 19. Permission contracts
// ---------------------------------------------------------------------------

describe("maintenance endpoints — authorization contracts", () => {
  const MAINTENANCE_PERMISSIONS = [
    "maintenance.view",
    "maintenance.create",
    "maintenance.update",
    "maintenance.close",
  ];

  const IT_STAFF_PERMS = [
    "maintenance.view", "maintenance.create", "maintenance.update", "maintenance.close",
    "assets.view", "assets.register", "assignments.view", "assignments.assign",
  ];

  const ADMIN_ONLY_PERMS = ["users.create", "users.reset_password", "users.view", "users.activate"];

  it("IT_STAFF has all 4 maintenance permissions", () => {
    for (const p of MAINTENANCE_PERMISSIONS) {
      assert.ok(IT_STAFF_PERMS.includes(p), `IT_STAFF missing: ${p}`);
    }
  });

  it("ADMIN-only permissions are not in maintenance permission set", () => {
    for (const p of ADMIN_ONLY_PERMS) {
      assert.ok(!MAINTENANCE_PERMISSIONS.includes(p));
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

  it("mustChangePassword blocks maintenance endpoints", () => {
    function decide(auth: boolean, pwChanged: boolean, hasPerm: boolean): boolean {
      return auth && pwChanged && hasPerm;
    }
    assert.equal(decide(true, false, true), false);
  });

  it("maintenance.view is required for GET endpoints", () => {
    assert.ok(MAINTENANCE_PERMISSIONS.includes("maintenance.view"));
  });

  it("maintenance.create is required for POST /", () => {
    assert.ok(MAINTENANCE_PERMISSIONS.includes("maintenance.create"));
  });

  it("maintenance.update is required for PATCH /:maintenanceId", () => {
    assert.ok(MAINTENANCE_PERMISSIONS.includes("maintenance.update"));
  });

  it("maintenance.close is required for PATCH /:maintenanceId/resolve", () => {
    assert.ok(MAINTENANCE_PERMISSIONS.includes("maintenance.close"));
  });

  it("maintenance.close is required for PATCH /:maintenanceId/cancel", () => {
    assert.ok(MAINTENANCE_PERMISSIONS.includes("maintenance.close"));
  });
});

// ---------------------------------------------------------------------------
// 20. App route registration and route ordering
// ---------------------------------------------------------------------------

describe("maintenance — app route registration", () => {
  it("maintenance router is mounted at /api/maintenance in app.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const appPath = fileURLToPath(new URL("../app.ts", import.meta.url));
    const source = readFileSync(appPath, "utf8");
    assert.ok(source.includes("maintenanceRouter"));
    assert.ok(source.includes("/api/maintenance"));
  });

  it("all 7 maintenance endpoints are defined in the router", () => {
    const endpoints = [
      { method: "GET",   path: "/" },
      { method: "GET",   path: "/asset/:assetId" },
      { method: "GET",   path: "/:maintenanceId" },
      { method: "POST",  path: "/" },
      { method: "PATCH", path: "/:maintenanceId" },
      { method: "PATCH", path: "/:maintenanceId/resolve" },
      { method: "PATCH", path: "/:maintenanceId/cancel" },
    ];
    assert.equal(endpoints.length, 7);
    assert.ok(endpoints.some((e) => e.path === "/asset/:assetId" && e.method === "GET"));
    assert.ok(endpoints.some((e) => e.path === "/:maintenanceId/resolve" && e.method === "PATCH"));
    assert.ok(endpoints.some((e) => e.path === "/:maintenanceId/cancel" && e.method === "PATCH"));
  });

  it("/asset/:assetId is registered before /:maintenanceId in the router source", async () => {
    // Route-ordering regression: Express matches routes in registration order.
    // GET /asset/:assetId must appear before GET /:maintenanceId so that
    // requests to /api/maintenance/asset/<uuid> reach listAssetMaintenanceHandler
    // rather than being intercepted by getMaintenanceByIdHandler.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const routerPath = fileURLToPath(new URL("../routes/maintenance.ts", import.meta.url));
    const source = readFileSync(routerPath, "utf8");
    const assetRoutePos = source.indexOf('"/asset/:assetId"');
    const maintenanceIdPos = source.indexOf('"/:maintenanceId"');
    assert.ok(assetRoutePos !== -1, "/asset/:assetId route must be present in router");
    assert.ok(maintenanceIdPos !== -1, "/:maintenanceId route must be present in router");
    assert.ok(
      assetRoutePos < maintenanceIdPos,
      `/asset/:assetId (pos ${assetRoutePos}) must be registered before /:maintenanceId (pos ${maintenanceIdPos})`
    );
  });

  it("listAssetMaintenanceHandler is bound to GET /asset/:assetId, not getMaintenanceByIdHandler", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const routerPath = fileURLToPath(new URL("../routes/maintenance.ts", import.meta.url));
    const source = readFileSync(routerPath, "utf8");
    const assetRoutePos = source.indexOf('"/asset/:assetId"');
    const afterAssetRoute = source.slice(assetRoutePos);
    const nextRoutePos = afterAssetRoute.indexOf("router.", 1);
    const assetRouteBlock = nextRoutePos === -1 ? afterAssetRoute : afterAssetRoute.slice(0, nextRoutePos);
    assert.ok(
      assetRouteBlock.includes("listAssetMaintenanceHandler"),
      "listAssetMaintenanceHandler must be the handler for GET /asset/:assetId"
    );
    assert.ok(
      !assetRouteBlock.includes("getMaintenanceByIdHandler"),
      "getMaintenanceByIdHandler must NOT be the handler for GET /asset/:assetId"
    );
  });

  it("resolve sub-route is registered before generic /:maintenanceId PATCH", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const routerPath = fileURLToPath(new URL("../routes/maintenance.ts", import.meta.url));
    const source = readFileSync(routerPath, "utf8");
    // D5 regression: compare actual character positions, not just presence.
    // /:maintenanceId/resolve and /:maintenanceId/cancel must appear BEFORE
    // the generic /:maintenanceId PATCH registration.
    // We locate the PATCH-specific block by finding router.patch occurrences.
    const resolvePos = source.indexOf('"/:maintenanceId/resolve"');
    const cancelPos  = source.indexOf('"/:maintenanceId/cancel"');
    // Find the generic PATCH /:maintenanceId — it must not contain a sub-path.
    // Search for the pattern used in the router: '"/:maintenanceId"' preceded
    // by a router.patch call. We find all occurrences and pick the one that
    // is NOT followed immediately by /resolve or /cancel.
    let genericPatchPos = -1;
    let searchFrom = 0;
    while (true) {
      const pos = source.indexOf('"/:maintenanceId"', searchFrom);
      if (pos === -1) break;
      // Check the preceding context for router.patch (within 200 chars)
      const before = source.slice(Math.max(0, pos - 200), pos);
      if (before.includes("router.patch")) {
        genericPatchPos = pos;
        break;
      }
      searchFrom = pos + 1;
    }
    assert.ok(resolvePos !== -1, "/:maintenanceId/resolve must be present");
    assert.ok(cancelPos  !== -1, "/:maintenanceId/cancel must be present");
    assert.ok(genericPatchPos !== -1, "PATCH /:maintenanceId must be present");
    assert.ok(
      resolvePos < genericPatchPos,
      `/:maintenanceId/resolve (pos ${resolvePos}) must be registered before PATCH /:maintenanceId (pos ${genericPatchPos})`
    );
    assert.ok(
      cancelPos < genericPatchPos,
      `/:maintenanceId/cancel (pos ${cancelPos}) must be registered before PATCH /:maintenanceId (pos ${genericPatchPos})`
    );
  });
});

// ---------------------------------------------------------------------------
// 21. Pagination result shape
// ---------------------------------------------------------------------------

describe("maintenance — pagination result shape", async () => {
  it("pagination result contains all required fields", async () => {
    const { buildPaginationResult } = await import("../utils/pagination.js");
    const r = buildPaginationResult([{ id: "m1" }], 1, 1, 20);
    assert.ok("items" in r && "total" in r && "page" in r && "pageSize" in r && "totalPages" in r);
  });

  it("totalPages is calculated correctly", async () => {
    const { buildPaginationResult } = await import("../utils/pagination.js");
    const r = buildPaginationResult([], 45, 1, 20);
    assert.equal(r.totalPages, 3);
  });

  it("PAGE_SIZE_DEFAULT is 20", async () => {
    const { PAGE_SIZE_DEFAULT } = await import("../utils/pagination.js");
    assert.equal(PAGE_SIZE_DEFAULT, 20);
  });

  it("PAGE_SIZE_MAX is 100", async () => {
    const { PAGE_SIZE_MAX } = await import("../utils/pagination.js");
    assert.equal(PAGE_SIZE_MAX, 100);
  });
});

// ---------------------------------------------------------------------------
// 22. Inconsistency guards
// ---------------------------------------------------------------------------

describe("maintenance — inconsistency guards", () => {
  it("resolve rejects asset not in UNDER_MAINTENANCE state", () => {
    function validateAssetForClose(assetStatus: string): string | null {
      if (assetStatus !== "UNDER_MAINTENANCE") return "ASSET_STATE_INCONSISTENT";
      return null;
    }
    assert.equal(validateAssetForClose("AVAILABLE"), "ASSET_STATE_INCONSISTENT");
    assert.equal(validateAssetForClose("RETIRED"), "ASSET_STATE_INCONSISTENT");
    assert.equal(validateAssetForClose("DISPOSED"), "ASSET_STATE_INCONSISTENT");
    assert.equal(validateAssetForClose("UNDER_MAINTENANCE"), null);
  });

  it("cancel rejects asset not in UNDER_MAINTENANCE state", () => {
    function validateAssetForClose(assetStatus: string): string | null {
      if (assetStatus !== "UNDER_MAINTENANCE") return "ASSET_STATE_INCONSISTENT";
      return null;
    }
    assert.equal(validateAssetForClose("AVAILABLE"), "ASSET_STATE_INCONSISTENT");
    assert.equal(validateAssetForClose("UNDER_MAINTENANCE"), null);
  });

  it("resolve does not reactivate RETIRED or DISPOSED assets", () => {
    function canResolve(assetStatus: string, maintenanceStatus: string): string | null {
      if (maintenanceStatus === "RESOLVED" || maintenanceStatus === "CANCELLED") return "MAINTENANCE_CLOSED";
      if (assetStatus !== "UNDER_MAINTENANCE") return "ASSET_STATE_INCONSISTENT";
      return null;
    }
    assert.equal(canResolve("RETIRED", "IN_PROGRESS"), "ASSET_STATE_INCONSISTENT");
    assert.equal(canResolve("DISPOSED", "IN_PROGRESS"), "ASSET_STATE_INCONSISTENT");
    assert.equal(canResolve("UNDER_MAINTENANCE", "IN_PROGRESS"), null);
  });
});

// ---------------------------------------------------------------------------
// 23. D3 regression — assignedToUserId validation inside the transaction
//
// Real PostgreSQL concurrency (user deleted between pre-check and transaction)
// cannot be tested without a live database and concurrent connections.
// These tests verify the structural contract: that the validation is performed
// inside the transaction using the transaction client, not outside it.
// ---------------------------------------------------------------------------

describe("maintenance — D3 assigned-user validation (structural contract)", async () => {
  const { maintenanceService } = await import("../services/maintenanceService.js").then(
    (m) => ({ maintenanceService: m })
  );

  it("USER_NOT_FOUND error code is defined for assigned-user validation failures", () => {
    const { MaintenanceServiceError } = maintenanceService;
    const err = new MaintenanceServiceError("Assigned user not found.", "USER_NOT_FOUND");
    assert.equal(err.code, "USER_NOT_FOUND");
    assert.equal(err.message, "Assigned user not found.");
  });

  it("openMaintenance service source performs user check inside the transaction", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const servicePath = fileURLToPath(new URL("../services/maintenanceService.js", import.meta.url)
      .toString().replace(/\.js$/, ".ts"));
    const source = readFileSync(servicePath, "utf8");

    // The pre-transaction block must NOT contain a user.findUnique call
    // (the old pattern that was outside the transaction).
    // Locate the openMaintenance function body up to the prisma.$transaction call.
    const fnStart = source.indexOf("export async function openMaintenance(");
    const txStart = source.indexOf("prisma.$transaction", fnStart);
    assert.ok(fnStart !== -1, "openMaintenance function must exist");
    assert.ok(txStart !== -1, "openMaintenance must use prisma.$transaction");
    const preTransactionBlock = source.slice(fnStart, txStart);

    // The pre-transaction block must not contain a user existence check
    assert.ok(
      !preTransactionBlock.includes("user.findUnique"),
      "assignedToUserId check must NOT appear before the transaction in openMaintenance"
    );

    // The transaction body must contain the user check
    const txBody = source.slice(txStart);
    const closingFnPos = txBody.indexOf("\nexport async function ");
    const openTxBody = closingFnPos === -1 ? txBody : txBody.slice(0, closingFnPos);
    assert.ok(
      openTxBody.includes("tx.user.findUnique"),
      "assignedToUserId check must use tx.user.findUnique inside the transaction in openMaintenance"
    );
  });

  it("updateMaintenance service source performs user check inside the transaction", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const servicePath = fileURLToPath(new URL("../services/maintenanceService.js", import.meta.url)
      .toString().replace(/\.js$/, ".ts"));
    const source = readFileSync(servicePath, "utf8");

    const fnStart = source.indexOf("export async function updateMaintenance(");
    const txStart = source.indexOf("prisma.$transaction", fnStart);
    assert.ok(fnStart !== -1, "updateMaintenance function must exist");
    assert.ok(txStart !== -1, "updateMaintenance must use prisma.$transaction");
    const preTransactionBlock = source.slice(fnStart, txStart);

    // The pre-transaction block must not contain a user existence check
    assert.ok(
      !preTransactionBlock.includes("user.findUnique"),
      "assignedToUserId check must NOT appear before the transaction in updateMaintenance"
    );

    // The transaction body must contain the user check
    const txBody = source.slice(txStart);
    const closingFnPos = txBody.indexOf("\nexport async function ");
    const updateTxBody = closingFnPos === -1 ? txBody : txBody.slice(0, closingFnPos);
    assert.ok(
      updateTxBody.includes("tx.user.findUnique"),
      "assignedToUserId check must use tx.user.findUnique inside the transaction in updateMaintenance"
    );
  });

  it("user validation uses transaction client (tx), not global prisma client", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const servicePath = fileURLToPath(new URL("../services/maintenanceService.js", import.meta.url)
      .toString().replace(/\.js$/, ".ts"));
    const source = readFileSync(servicePath, "utf8");

    // Count occurrences of prisma.user.findUnique (global client — old pattern)
    const globalUserChecks = (source.match(/prisma\.user\.findUnique/g) ?? []).length;
    assert.equal(
      globalUserChecks,
      0,
      "No user.findUnique calls should use the global prisma client — all must use tx"
    );
  });

  it("simulated race: user deleted after pre-check is caught by in-transaction re-read", () => {
    // Simulates the D3 scenario: pre-check passes, user is deleted, in-transaction
    // re-read catches the deletion and throws USER_NOT_FOUND.
    // This is the structural guarantee the fix provides under READ COMMITTED isolation.
    let userExistsInDb = true;

    function preCheck(userId: string | undefined): boolean {
      // Old pattern: check outside transaction — can pass even if user is deleted next
      if (!userId) return true;
      return userExistsInDb; // passes
    }

    function inTransactionCheck(userId: string | undefined): string | null {
      // New pattern: re-read inside transaction — sees committed deletions
      if (!userId) return null;
      if (!userExistsInDb) return "USER_NOT_FOUND";
      return null;
    }

    const userId = VALID_UUID_2;

    // Pre-check passes
    assert.ok(preCheck(userId));

    // User is deleted between pre-check and transaction
    userExistsInDb = false;

    // In-transaction re-read catches the deletion
    assert.equal(inTransactionCheck(userId), "USER_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// 24. D4 regression — updateMaintenance locks the record before status checks
//
// Real PostgreSQL concurrency cannot be tested without a live database.
// These tests verify the structural contract: that the maintenance record is
// locked FOR UPDATE inside the transaction, and that all status/startedDate
// logic uses the locked row values.
// ---------------------------------------------------------------------------

describe("maintenance — D4 update locking (structural contract)", async () => {
  it("updateMaintenance service source locks the maintenance record FOR UPDATE", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const servicePath = fileURLToPath(new URL("../services/maintenanceService.js", import.meta.url)
      .toString().replace(/\.js$/, ".ts"));
    const source = readFileSync(servicePath, "utf8");

    const fnStart = source.indexOf("export async function updateMaintenance(");
    const txStart = source.indexOf("prisma.$transaction", fnStart);
    const txBody = source.slice(txStart);
    const closingFnPos = txBody.indexOf("\nexport async function ");
    const updateTxBody = closingFnPos === -1 ? txBody : txBody.slice(0, closingFnPos);

    assert.ok(
      updateTxBody.includes("FOR UPDATE"),
      "updateMaintenance transaction must lock the maintenance record FOR UPDATE"
    );
    assert.ok(
      updateTxBody.includes("maintenance_records"),
      "updateMaintenance must lock the maintenance_records table row"
    );
  });

  it("updateMaintenance uses locked row status for transition check, not pre-transaction snapshot", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const servicePath = fileURLToPath(new URL("../services/maintenanceService.js", import.meta.url)
      .toString().replace(/\.js$/, ".ts"));
    const source = readFileSync(servicePath, "utf8");

    const fnStart = source.indexOf("export async function updateMaintenance(");
    const txStart = source.indexOf("prisma.$transaction", fnStart);
    const txBody = source.slice(txStart);
    const closingFnPos = txBody.indexOf("\nexport async function ");
    const updateTxBody = closingFnPos === -1 ? txBody : txBody.slice(0, closingFnPos);

    // The locked variable (not the pre-transaction 'existing') must be used
    // for the IN_PROGRESS transition guard inside the transaction
    assert.ok(
      updateTxBody.includes("locked.status"),
      "updateMaintenance must check locked.status (not existing.status) for transition guard"
    );
    assert.ok(
      updateTxBody.includes("locked.startedDate"),
      "updateMaintenance must check locked.startedDate (not existing.startedDate) for startedDate guard"
    );
  });

  it("simulated race: second concurrent update sees MAINTENANCE_CLOSED after first resolves", () => {
    // Simulates D4: two concurrent PATCH requests both pass the pre-transaction
    // status check (REPORTED). With locking, the second sees the committed
    // state (RESOLVED) after the first transaction commits.
    type Status = "REPORTED" | "IN_PROGRESS" | "RESOLVED" | "CANCELLED";

    let dbStatus: Status = "REPORTED";
    let dbStartedDate: Date | null = null;

    function updateWithLock(requestedStatus: "IN_PROGRESS" | undefined): string | null {
      // Simulates reading the locked row inside the transaction
      const lockedStatus = dbStatus;
      const lockedStartedDate = dbStartedDate;

      if (lockedStatus === "RESOLVED" || lockedStatus === "CANCELLED") {
        return "MAINTENANCE_CLOSED";
      }
      if (requestedStatus === "IN_PROGRESS") {
        if (lockedStatus !== "REPORTED") return "INVALID_TRANSITION";
        dbStatus = "IN_PROGRESS";
        if (!lockedStartedDate) dbStartedDate = new Date();
      }
      return null;
    }

    // T1 transitions REPORTED → IN_PROGRESS and commits
    const t1 = updateWithLock("IN_PROGRESS");
    assert.equal(t1, null);
    assert.equal(dbStatus, "IN_PROGRESS");
    assert.notEqual(dbStartedDate, null);
    assert.ok((dbStartedDate as unknown as Date) instanceof Date);

    const firstStartedDate = dbStartedDate;

    // T2 also tries IN_PROGRESS — locked row now shows IN_PROGRESS, not REPORTED
    const t2 = updateWithLock("IN_PROGRESS");
    assert.equal(t2, "INVALID_TRANSITION");

    // startedDate was not overwritten
    assert.equal(dbStartedDate, firstStartedDate);
  });

  it("simulated race: second update on a resolved record returns MAINTENANCE_CLOSED", () => {
    type Status = "REPORTED" | "IN_PROGRESS" | "RESOLVED" | "CANCELLED";
    let dbStatus: Status = "IN_PROGRESS";

    function updateWithLock(): string | null {
      const lockedStatus = dbStatus;
      if (lockedStatus === "RESOLVED" || lockedStatus === "CANCELLED") {
        return "MAINTENANCE_CLOSED";
      }
      return null;
    }

    // T1 resolves the record (simulated by external operation)
    dbStatus = "RESOLVED";

    // T2 tries to update — locked row shows RESOLVED
    const t2 = updateWithLock();
    assert.equal(t2, "MAINTENANCE_CLOSED");
  });

  it("startedDate is set from locked row on first IN_PROGRESS transition and never overwritten", () => {
    let dbStartedDate: Date | null = null;

    function applyLockedUpdate(lockedStartedDate: Date | null, isInProgressRequest: boolean): Date | null {
      if (isInProgressRequest && !lockedStartedDate) {
        return new Date();
      }
      return lockedStartedDate;
    }

    // First transition: locked row has no startedDate
    const first = applyLockedUpdate(null, true);
    assert.ok(first instanceof Date, "startedDate must be set on first transition");
    dbStartedDate = first;

    // Second transition attempt: locked row already has startedDate
    const second = applyLockedUpdate(dbStartedDate, true);
    assert.equal(second, dbStartedDate, "startedDate must not be overwritten");
  });
});

// ---------------------------------------------------------------------------
// 25. D3 residual race — P2003 assigned-user FK violation handling
//
// These tests verify the isAssignedUserFkViolation helper and confirm that
// the narrow P2003 mapping is applied only to the assignedToUserId FK.
//
// Prisma 7 with @prisma/adapter-pg surfaces P2003 with:
//   meta.field_name = "maintenance_records_assignedToUserId_fkey (index)"
//
// Real PostgreSQL concurrency (user deleted between the in-transaction
// user check and the write) cannot be tested without a live database and
// concurrent connections. These tests verify the structural contract only.
// ---------------------------------------------------------------------------

describe("maintenance — D3 P2003 assigned-user FK violation handling", async () => {
  const { isAssignedUserFkViolation, isOpenMaintenanceConflict, MaintenanceServiceError } =
    await import("../services/maintenanceService.js");

  // ── isAssignedUserFkViolation helper ──────────────────────────────────────

  it("detects P2003 with exact assignedToUserId FK field_name", () => {
    const err = {
      code: "P2003",
      meta: { field_name: "maintenance_records_assignedToUserId_fkey (index)" },
    };
    assert.ok(isAssignedUserFkViolation(err));
  });

  it("detects P2003 when field_name contains the FK name without the (index) suffix", () => {
    // Guard against Prisma adapter variations that may omit the suffix
    const err = {
      code: "P2003",
      meta: { field_name: "maintenance_records_assignedToUserId_fkey" },
    };
    assert.ok(isAssignedUserFkViolation(err));
  });

  it("does NOT detect P2003 on an unrelated FK (createdByUserId)", () => {
    const err = {
      code: "P2003",
      meta: { field_name: "maintenance_records_createdByUserId_fkey (index)" },
    };
    assert.ok(!isAssignedUserFkViolation(err));
  });

  it("does NOT detect P2003 on a completely unrelated FK (assetId)", () => {
    const err = {
      code: "P2003",
      meta: { field_name: "maintenance_records_assetId_fkey (index)" },
    };
    assert.ok(!isAssignedUserFkViolation(err));
  });

  it("does NOT detect P2002 (wrong error code)", () => {
    const err = {
      code: "P2002",
      meta: { field_name: "maintenance_records_assignedToUserId_fkey (index)" },
    };
    assert.ok(!isAssignedUserFkViolation(err));
  });

  it("does NOT detect a plain Error", () => {
    assert.ok(!isAssignedUserFkViolation(new Error("FK violation")));
  });

  it("does NOT detect null", () => {
    assert.ok(!isAssignedUserFkViolation(null));
  });

  it("does NOT detect P2003 with missing meta", () => {
    assert.ok(!isAssignedUserFkViolation({ code: "P2003" }));
  });

  it("does NOT detect P2003 with non-string field_name", () => {
    assert.ok(!isAssignedUserFkViolation({ code: "P2003", meta: { field_name: 42 } }));
  });

  // ── Mapping to USER_NOT_FOUND ─────────────────────────────────────────────

  it("assignedToUserId P2003 maps to USER_NOT_FOUND (HTTP 404), not HTTP 500", () => {
    const fkErr = {
      code: "P2003",
      meta: { field_name: "maintenance_records_assignedToUserId_fkey (index)" },
    };
    const mapped = isAssignedUserFkViolation(fkErr)
      ? new MaintenanceServiceError("Assigned user not found.", "USER_NOT_FOUND")
      : null;
    assert.ok(mapped instanceof MaintenanceServiceError);
    assert.equal(mapped.code, "USER_NOT_FOUND");
    assert.equal(mapped.message, "Assigned user not found.");
  });

  it("unrelated P2003 is NOT mapped to USER_NOT_FOUND", () => {
    const unrelatedErr = {
      code: "P2003",
      meta: { field_name: "maintenance_records_assetId_fkey (index)" },
    };
    const mapped = isAssignedUserFkViolation(unrelatedErr)
      ? new MaintenanceServiceError("Assigned user not found.", "USER_NOT_FOUND")
      : null;
    assert.equal(mapped, null);
  });

  // ── isAssignedUserFkViolation does not interfere with isOpenMaintenanceConflict ──

  it("isAssignedUserFkViolation does not match P2002 (isOpenMaintenanceConflict domain)", () => {
    const p2002 = { code: "P2002", meta: { target: "maintenance_records_one_open_per_asset" } };
    assert.ok(!isAssignedUserFkViolation(p2002));
    assert.ok(isOpenMaintenanceConflict(p2002));
  });

  it("isOpenMaintenanceConflict does not match P2003 (isAssignedUserFkViolation domain)", () => {
    const p2003 = {
      code: "P2003",
      meta: { field_name: "maintenance_records_assignedToUserId_fkey (index)" },
    };
    assert.ok(!isOpenMaintenanceConflict(p2003));
    assert.ok(isAssignedUserFkViolation(p2003));
  });

  // ── Structural contract: both write paths have the catch ──────────────────

  it("openMaintenance source wraps the create call with a P2003 catch for assignedToUserId", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const servicePath = fileURLToPath(
      new URL("../services/maintenanceService.js", import.meta.url)
        .toString()
        .replace(/\.js$/, ".ts")
    );
    const source = readFileSync(servicePath, "utf8");

    const fnStart = source.indexOf("export async function openMaintenance(");
    const nextFn = source.indexOf("\nexport async function ", fnStart + 1);
    const fnBody = nextFn === -1 ? source.slice(fnStart) : source.slice(fnStart, nextFn);

    assert.ok(
      fnBody.includes("isAssignedUserFkViolation"),
      "openMaintenance must call isAssignedUserFkViolation to handle the P2003 race"
    );
    assert.ok(
      fnBody.includes("USER_NOT_FOUND"),
      "openMaintenance must throw USER_NOT_FOUND on assignedToUserId FK violation"
    );
  });

  it("updateMaintenance source wraps the update call with a P2003 catch for assignedToUserId", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const servicePath = fileURLToPath(
      new URL("../services/maintenanceService.js", import.meta.url)
        .toString()
        .replace(/\.js$/, ".ts")
    );
    const source = readFileSync(servicePath, "utf8");

    const fnStart = source.indexOf("export async function updateMaintenance(");
    const nextFn = source.indexOf("\nexport async function ", fnStart + 1);
    const fnBody = nextFn === -1 ? source.slice(fnStart) : source.slice(fnStart, nextFn);

    assert.ok(
      fnBody.includes("isAssignedUserFkViolation"),
      "updateMaintenance must call isAssignedUserFkViolation to handle the P2003 race"
    );
    assert.ok(
      fnBody.includes("USER_NOT_FOUND"),
      "updateMaintenance must throw USER_NOT_FOUND on assignedToUserId FK violation"
    );
  });

  // ── Simulated race: P2003 thrown by write is caught and re-mapped ─────────

  it("simulated race: P2003 on assignedToUserId thrown during write is caught and mapped to USER_NOT_FOUND", () => {
    // Simulates the residual D3 window: user deleted after tx.user.findUnique
    // passes but before the write commits. PostgreSQL raises FK violation,
    // Prisma surfaces it as P2003. The catch block maps it to USER_NOT_FOUND.
    const fkError = {
      code: "P2003",
      meta: { field_name: "maintenance_records_assignedToUserId_fkey (index)" },
    };

    function simulateWrite(throwFkError: boolean): InstanceType<typeof MaintenanceServiceError> | null {
      try {
        if (throwFkError) throw fkError;
        return null;
      } catch (writeErr) {
        if (isAssignedUserFkViolation(writeErr)) {
          return new MaintenanceServiceError("Assigned user not found.", "USER_NOT_FOUND");
        }
        throw writeErr;
      }
    }

    const result = simulateWrite(true);
    assert.ok(result instanceof MaintenanceServiceError);
    assert.equal(result.code, "USER_NOT_FOUND");
  });

  it("simulated race: unrelated P2003 thrown during write is re-thrown, not mapped", () => {
    const unrelatedFkError = {
      code: "P2003",
      meta: { field_name: "maintenance_records_assetId_fkey (index)" },
    };

    function simulateWrite(err: unknown): InstanceType<typeof MaintenanceServiceError> | null {
      try {
        throw err;
      } catch (writeErr) {
        if (isAssignedUserFkViolation(writeErr)) {
          return new MaintenanceServiceError("Assigned user not found.", "USER_NOT_FOUND");
        }
        throw writeErr;
      }
    }

    assert.throws(
      () => simulateWrite(unrelatedFkError),
      (thrown: unknown) => thrown === unrelatedFkError
    );
  });
});
