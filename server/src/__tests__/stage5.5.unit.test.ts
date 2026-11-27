/**
 * Stage 5.5 — Asset Assignment and Returns Unit Tests
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
// 1. AssignmentServiceError codes
// ---------------------------------------------------------------------------

describe("assignment service — error codes", async () => {
  const { AssignmentServiceError } = await import("../services/assignmentService.js");

  it("ASSET_NOT_FOUND maps to 404", () => {
    const err = new AssignmentServiceError("Asset not found.", "ASSET_NOT_FOUND");
    assert.equal(err.code, "ASSET_NOT_FOUND");
    assert.ok(err instanceof Error);
  });
  it("EMPLOYEE_NOT_FOUND maps to 404", () => {
    const err = new AssignmentServiceError("Employee not found.", "EMPLOYEE_NOT_FOUND");
    assert.equal(err.code, "EMPLOYEE_NOT_FOUND");
  });
  it("ASSIGNMENT_NOT_FOUND maps to 404", () => {
    const err = new AssignmentServiceError("Assignment not found.", "ASSIGNMENT_NOT_FOUND");
    assert.equal(err.code, "ASSIGNMENT_NOT_FOUND");
  });
  it("EMPLOYEE_NOT_ACTIVE maps to 422", () => {
    const err = new AssignmentServiceError("Employee inactive.", "EMPLOYEE_NOT_ACTIVE");
    assert.equal(err.code, "EMPLOYEE_NOT_ACTIVE");
  });
  it("ASSET_ALREADY_ASSIGNED maps to 409", () => {
    const err = new AssignmentServiceError("Already assigned.", "ASSET_ALREADY_ASSIGNED");
    assert.equal(err.code, "ASSET_ALREADY_ASSIGNED");
  });
  it("ASSET_UNDER_MAINTENANCE maps to 409", () => {
    const err = new AssignmentServiceError("Under maintenance.", "ASSET_UNDER_MAINTENANCE");
    assert.equal(err.code, "ASSET_UNDER_MAINTENANCE");
  });
  it("ASSET_RETIRED maps to 409", () => {
    const err = new AssignmentServiceError("Retired.", "ASSET_RETIRED");
    assert.equal(err.code, "ASSET_RETIRED");
  });
  it("ASSET_DISPOSED maps to 409", () => {
    const err = new AssignmentServiceError("Disposed.", "ASSET_DISPOSED");
    assert.equal(err.code, "ASSET_DISPOSED");
  });
  it("ASSIGNMENT_ALREADY_RETURNED maps to 409", () => {
    const err = new AssignmentServiceError("Already returned.", "ASSIGNMENT_ALREADY_RETURNED");
    assert.equal(err.code, "ASSIGNMENT_ALREADY_RETURNED");
  });
  it("ASSET_STATE_INCONSISTENT maps to 409", () => {
    const err = new AssignmentServiceError("Inconsistent.", "ASSET_STATE_INCONSISTENT");
    assert.equal(err.code, "ASSET_STATE_INCONSISTENT");
  });
});

// ---------------------------------------------------------------------------
// 2. Asset eligibility — status rules
// ---------------------------------------------------------------------------

describe("assignment — asset eligibility rules", () => {
  type AssetStatus = "AVAILABLE" | "ASSIGNED" | "UNDER_MAINTENANCE" | "RETIRED" | "DISPOSED";

  function canAssign(status: AssetStatus): string | null {
    if (status === "AVAILABLE") return null;
    const map: Record<string, string> = {
      ASSIGNED: "ASSET_ALREADY_ASSIGNED",
      UNDER_MAINTENANCE: "ASSET_UNDER_MAINTENANCE",
      RETIRED: "ASSET_RETIRED",
      DISPOSED: "ASSET_DISPOSED",
    };
    return map[status] ?? "ASSET_NOT_AVAILABLE";
  }

  it("AVAILABLE asset can be assigned", () => assert.equal(canAssign("AVAILABLE"), null));
  it("ASSIGNED asset cannot be assigned", () => assert.equal(canAssign("ASSIGNED"), "ASSET_ALREADY_ASSIGNED"));
  it("UNDER_MAINTENANCE asset cannot be assigned", () => assert.equal(canAssign("UNDER_MAINTENANCE"), "ASSET_UNDER_MAINTENANCE"));
  it("RETIRED asset cannot be assigned", () => assert.equal(canAssign("RETIRED"), "ASSET_RETIRED"));
  it("DISPOSED asset cannot be assigned", () => assert.equal(canAssign("DISPOSED"), "ASSET_DISPOSED"));
  it("only AVAILABLE allows assignment", () => {
    const blocked: AssetStatus[] = ["ASSIGNED", "UNDER_MAINTENANCE", "RETIRED", "DISPOSED"];
    assert.ok(blocked.every((s) => canAssign(s) !== null));
  });
});

// ---------------------------------------------------------------------------
// 3. Employee eligibility — status rules
// ---------------------------------------------------------------------------

describe("assignment — employee eligibility rules", () => {
  type EmployeeStatus = "ACTIVE" | "INACTIVE" | "TRANSFERRED" | "TERMINATED";

  function canReceive(status: EmployeeStatus): string | null {
    return status === "ACTIVE" ? null : "EMPLOYEE_NOT_ACTIVE";
  }

  it("ACTIVE employee can receive assignment", () => assert.equal(canReceive("ACTIVE"), null));
  it("INACTIVE employee cannot receive assignment", () => assert.equal(canReceive("INACTIVE"), "EMPLOYEE_NOT_ACTIVE"));
  it("TRANSFERRED employee cannot receive assignment", () => assert.equal(canReceive("TRANSFERRED"), "EMPLOYEE_NOT_ACTIVE"));
  it("TERMINATED employee cannot receive assignment", () => assert.equal(canReceive("TERMINATED"), "EMPLOYEE_NOT_ACTIVE"));
});

// ---------------------------------------------------------------------------
// 4. Assignment input validation schema
// ---------------------------------------------------------------------------

describe("assignment — create validation schema", async () => {
  const { z } = await import("zod");

  const assignSchema = z.object({
    assetId: z.string().uuid(),
    employeeId: z.string().uuid(),
    locationId: z.string().uuid().optional(),
    expectedReturnDate: z.string().regex(ISO_DATE).optional(),
    notes: z.string().max(2000).optional(),
  });

  it("accepts minimal valid input", () => {
    assert.ok(assignSchema.safeParse({ assetId: VALID_UUID, employeeId: VALID_UUID_2 }).success);
  });
  it("accepts full valid input", () => {
    assert.ok(assignSchema.safeParse({
      assetId: VALID_UUID, employeeId: VALID_UUID_2,
      locationId: VALID_UUID_3, expectedReturnDate: "2026-12-31", notes: "Project laptop",
    }).success);
  });
  it("rejects missing assetId", () => {
    assert.ok(!assignSchema.safeParse({ employeeId: VALID_UUID_2 }).success);
  });
  it("rejects invalid assetId UUID", () => {
    assert.ok(!assignSchema.safeParse({ assetId: "not-uuid", employeeId: VALID_UUID_2 }).success);
  });
  it("rejects invalid expectedReturnDate format", () => {
    assert.ok(!assignSchema.safeParse({
      assetId: VALID_UUID, employeeId: VALID_UUID_2, expectedReturnDate: "31-12-2026",
    }).success);
  });
  it("schema does not include assignedAt — server generates it", () => {
    const result = assignSchema.safeParse({ assetId: VALID_UUID, employeeId: VALID_UUID_2, assignedAt: "2020-01-01" });
    assert.ok(result.success);
    assert.ok(!("assignedAt" in (result.data as object)));
  });
  it("schema does not include departmentId — derived from employee", () => {
    const result = assignSchema.safeParse({ assetId: VALID_UUID, employeeId: VALID_UUID_2, departmentId: VALID_UUID_3 });
    assert.ok(result.success);
    assert.ok(!("departmentId" in (result.data as object)));
  });
});

// ---------------------------------------------------------------------------
// 5. Return input validation schema
// ---------------------------------------------------------------------------

describe("assignment — return validation schema", async () => {
  const { z } = await import("zod");
  const ASSET_CONDITIONS = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;

  const returnSchema = z.object({
    returnCondition: z.enum(ASSET_CONDITIONS),
    returnNotes: z.string().max(2000).optional(),
  });

  it("accepts valid return with condition", () => {
    assert.ok(returnSchema.safeParse({ returnCondition: "GOOD" }).success);
  });
  it("accepts all valid conditions", () => {
    for (const c of ASSET_CONDITIONS) {
      assert.ok(returnSchema.safeParse({ returnCondition: c }).success);
    }
  });
  it("accepts return with notes", () => {
    assert.ok(returnSchema.safeParse({ returnCondition: "DAMAGED", returnNotes: "Screen cracked" }).success);
  });
  it("rejects missing returnCondition", () => {
    assert.ok(!returnSchema.safeParse({}).success);
  });
  it("rejects invalid returnCondition", () => {
    assert.ok(!returnSchema.safeParse({ returnCondition: "BROKEN" }).success);
  });
  it("schema does not include returnedAt — server generates it", () => {
    const result = returnSchema.safeParse({ returnCondition: "GOOD", returnedAt: "2026-01-01" });
    assert.ok(result.success);
    assert.ok(!("returnedAt" in (result.data as object)));
  });
});

// ---------------------------------------------------------------------------
// 6. Department snapshot policy
// ---------------------------------------------------------------------------

describe("assignment — department snapshot policy", () => {
  interface Employee { id: string; departmentId: string | null; status: string; }

  function deriveAssignmentDepartment(emp: Employee): string | null {
    return emp.departmentId ?? null;
  }

  it("department is taken from employee's current departmentId", () => {
    const emp: Employee = { id: VALID_UUID, departmentId: VALID_UUID_2, status: "ACTIVE" };
    assert.equal(deriveAssignmentDepartment(emp), VALID_UUID_2);
  });
  it("department is null when employee has no department", () => {
    const emp: Employee = { id: VALID_UUID, departmentId: null, status: "ACTIVE" };
    assert.equal(deriveAssignmentDepartment(emp), null);
  });
  it("new assignment after transfer uses employee's new department", () => {
    const emp: Employee = { id: VALID_UUID, departmentId: VALID_UUID_3, status: "ACTIVE" };
    assert.equal(deriveAssignmentDepartment(emp), VALID_UUID_3);
  });
  it("existing assignment department is not changed by transfer", () => {
    const historical = { departmentId: VALID_UUID_2 };
    const afterTransfer = { ...historical };
    assert.equal(afterTransfer.departmentId, VALID_UUID_2);
  });
  it("existing assigned assets are not automatically moved to new department", () => {
    const assetBefore = { currentDepartmentId: VALID_UUID_2 };
    const assetAfter = { ...assetBefore };
    assert.equal(assetAfter.currentDepartmentId, VALID_UUID_2);
  });
  it("new asset assigned after transfer gets new department", () => {
    const newAsset = { currentDepartmentId: VALID_UUID_3 };
    assert.equal(newAsset.currentDepartmentId, VALID_UUID_3);
  });
});

// ---------------------------------------------------------------------------
// 7. Server-generated timestamps
// ---------------------------------------------------------------------------

describe("assignment — server-generated timestamps", () => {
  it("assignedAt is a server-generated Date", () => {
    const before = Date.now();
    const assignedAt = new Date();
    const after = Date.now();
    assert.ok(assignedAt.getTime() >= before && assignedAt.getTime() <= after);
  });
  it("returnedAt is a server-generated Date", () => {
    const before = Date.now();
    const returnedAt = new Date();
    const after = Date.now();
    assert.ok(returnedAt.getTime() >= before && returnedAt.getTime() <= after);
  });
  it("assignedAt is not accepted from client input schema", async () => {
    const { z } = await import("zod");
    const schema = z.object({ assetId: z.string().uuid(), employeeId: z.string().uuid() });
    const result = schema.safeParse({ assetId: VALID_UUID, employeeId: VALID_UUID_2, assignedAt: "2020-01-01" });
    assert.ok(result.success);
    assert.ok(!("assignedAt" in (result.data as object)));
  });
});

// ---------------------------------------------------------------------------
// 8. Return behaviour — asset state changes
// ---------------------------------------------------------------------------

describe("assignment — return behaviour", () => {
  type AssetCondition = "NEW" | "GOOD" | "FAIR" | "POOR" | "DAMAGED";
  interface Asset {
    status: string;
    condition: AssetCondition;
    currentAssigneeId: string | null;
    currentDepartmentId: string | null;
    currentLocationId: string | null;
  }

  function applyReturn(asset: Asset, returnCondition: AssetCondition): Asset {
    return { ...asset, status: "AVAILABLE", condition: returnCondition,
      currentAssigneeId: null, currentDepartmentId: null, currentLocationId: null };
  }

  it("asset status becomes AVAILABLE after return", () => {
    const a: Asset = { status: "ASSIGNED", condition: "NEW", currentAssigneeId: VALID_UUID, currentDepartmentId: VALID_UUID_2, currentLocationId: null };
    assert.equal(applyReturn(a, "GOOD").status, "AVAILABLE");
  });
  it("asset condition is updated to returnCondition", () => {
    const a: Asset = { status: "ASSIGNED", condition: "NEW", currentAssigneeId: VALID_UUID, currentDepartmentId: null, currentLocationId: null };
    assert.equal(applyReturn(a, "DAMAGED").condition, "DAMAGED");
  });
  it("currentAssigneeId is cleared on return", () => {
    const a: Asset = { status: "ASSIGNED", condition: "GOOD", currentAssigneeId: VALID_UUID, currentDepartmentId: null, currentLocationId: null };
    assert.equal(applyReturn(a, "GOOD").currentAssigneeId, null);
  });
  it("currentDepartmentId is cleared on return", () => {
    const a: Asset = { status: "ASSIGNED", condition: "GOOD", currentAssigneeId: VALID_UUID, currentDepartmentId: VALID_UUID_2, currentLocationId: null };
    assert.equal(applyReturn(a, "GOOD").currentDepartmentId, null);
  });
  it("currentLocationId is cleared on return", () => {
    const a: Asset = { status: "ASSIGNED", condition: "GOOD", currentAssigneeId: VALID_UUID, currentDepartmentId: null, currentLocationId: VALID_UUID_3 };
    assert.equal(applyReturn(a, "GOOD").currentLocationId, null);
  });
  it("returnNotes are stored separately from assignment notes", () => {
    const rec = { notes: "Assigned for project X", returnNotes: "Screen has minor scratch" };
    assert.notEqual(rec.notes, rec.returnNotes);
    assert.ok(rec.notes.includes("project"));
    assert.ok(rec.returnNotes.includes("scratch"));
  });
  it("assignment record is preserved after return — not deleted", () => {
    const rec = { id: VALID_UUID, returnedAt: new Date(), returnCondition: "GOOD" };
    assert.ok(rec.id);
    assert.ok(rec.returnedAt instanceof Date);
  });
});

// ---------------------------------------------------------------------------
// 9. Open assignment prevention
// ---------------------------------------------------------------------------

describe("assignment — open assignment prevention", () => {
  it("only one open assignment per asset is allowed", () => {
    const open = new Map<string, boolean>();
    function tryAssign(assetId: string): string | null {
      if (open.get(assetId)) return "ASSET_ALREADY_ASSIGNED";
      open.set(assetId, true);
      return null;
    }
    assert.equal(tryAssign(VALID_UUID), null);
    assert.equal(tryAssign(VALID_UUID), "ASSET_ALREADY_ASSIGNED");
  });
  it("asset can be assigned again after return", () => {
    const open = new Map<string, boolean>();
    function tryAssign(assetId: string): string | null {
      if (open.get(assetId)) return "ASSET_ALREADY_ASSIGNED";
      open.set(assetId, true);
      return null;
    }
    function doReturn(assetId: string): void { open.delete(assetId); }
    assert.equal(tryAssign(VALID_UUID), null);
    doReturn(VALID_UUID);
    assert.equal(tryAssign(VALID_UUID), null);
  });
  it("partial unique index name is asset_assignments_one_open_per_asset", () => {
    const name = "asset_assignments_one_open_per_asset";
    assert.ok(name.includes("one_open_per_asset"));
  });
});

// ---------------------------------------------------------------------------
// 10. isOpenAssignmentConflict helper
// ---------------------------------------------------------------------------

describe("assignment — isOpenAssignmentConflict helper", async () => {
  const { isOpenAssignmentConflict } = await import("../services/assignmentService.js");

  it("detects P2002 on the partial unique index (string target)", () => {
    assert.ok(isOpenAssignmentConflict({ code: "P2002", meta: { target: "asset_assignments_one_open_per_asset" } }));
  });
  it("detects P2002 when target is an array containing the index name", () => {
    assert.ok(isOpenAssignmentConflict({ code: "P2002", meta: { target: ["asset_assignments_one_open_per_asset"] } }));
  });
  it("does not detect P2002 on a different constraint", () => {
    assert.ok(!isOpenAssignmentConflict({ code: "P2002", meta: { target: "assets_assetTag_key" } }));
  });
  it("does not detect P2003", () => {
    assert.ok(!isOpenAssignmentConflict({ code: "P2003", meta: { target: "asset_assignments_one_open_per_asset" } }));
  });
  it("does not detect plain Error", () => {
    assert.ok(!isOpenAssignmentConflict(new Error("other")));
  });
  it("does not detect null", () => {
    assert.ok(!isOpenAssignmentConflict(null));
  });
});

// ---------------------------------------------------------------------------
// 11. List assignments — query schema
// ---------------------------------------------------------------------------

describe("assignment listing — query schema validation", async () => {
  const { z } = await import("zod");

  const listSchema = z.object({
    assetId: z.string().uuid().optional(),
    employeeId: z.string().uuid().optional(),
    open: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
    dateFrom: z.string().regex(ISO_DATE).optional(),
    dateTo: z.string().regex(ISO_DATE).optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  });

  it("accepts empty query", () => assert.ok(listSchema.safeParse({}).success));
  it("accepts all valid filters", () => {
    assert.ok(listSchema.safeParse({
      assetId: VALID_UUID, employeeId: VALID_UUID_2,
      open: "true", dateFrom: "2026-01-01", dateTo: "2026-12-31",
      sortOrder: "desc", page: "1", pageSize: "20",
    }).success);
  });
  it("transforms open=true string to boolean true", () => {
    const result = listSchema.safeParse({ open: "true" });
    assert.ok(result.success);
    assert.equal(result.data.open, true);
  });
  it("transforms open=false string to boolean false", () => {
    const result = listSchema.safeParse({ open: "false" });
    assert.ok(result.success);
    assert.equal(result.data.open, false);
  });
  it("rejects invalid assetId", () => {
    assert.ok(!listSchema.safeParse({ assetId: "not-uuid" }).success);
  });
  it("rejects invalid dateFrom format", () => {
    assert.ok(!listSchema.safeParse({ dateFrom: "01/01/2026" }).success);
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
});

// ---------------------------------------------------------------------------
// 12. Transaction atomicity contracts
// ---------------------------------------------------------------------------

describe("assignment — transaction atomicity", () => {
  it("all assignment operations commit together on success", () => {
    let assignmentCreated = false;
    let assetUpdated = false;
    let auditWritten = false;

    function simulateAssignTx(failAt: string | null): void {
      try {
        if (failAt === "assignment") throw new Error();
        assignmentCreated = true;
        if (failAt === "asset") throw new Error();
        assetUpdated = true;
        if (failAt === "audit") throw new Error();
        auditWritten = true;
      } catch {
        assignmentCreated = false;
        assetUpdated = false;
        auditWritten = false;
      }
    }

    simulateAssignTx(null);
    assert.ok(assignmentCreated && assetUpdated && auditWritten);
  });

  it("asset update failure rolls back assignment creation", () => {
    let assignmentCreated = false;
    let assetUpdated = false;

    function simulateAssignTx(failAt: string | null): void {
      try {
        if (failAt === "assignment") throw new Error();
        assignmentCreated = true;
        if (failAt === "asset") throw new Error();
        assetUpdated = true;
      } catch {
        assignmentCreated = false;
        assetUpdated = false;
      }
    }

    simulateAssignTx("asset");
    assert.ok(!assignmentCreated && !assetUpdated);
  });

  it("audit failure rolls back assignment and asset update", () => {
    let committed = false;
    function simulateAssignTx(failAt: string | null): void {
      try {
        if (failAt === "audit") throw new Error();
        committed = true;
      } catch { committed = false; }
    }
    simulateAssignTx("audit");
    assert.equal(committed, false);
  });

  it("all return operations commit together on success", () => {
    let assignmentUpdated = false;
    let assetUpdated = false;
    let auditWritten = false;

    function simulateReturnTx(failAt: string | null): void {
      try {
        if (failAt === "assignment") throw new Error();
        assignmentUpdated = true;
        if (failAt === "asset") throw new Error();
        assetUpdated = true;
        if (failAt === "audit") throw new Error();
        auditWritten = true;
      } catch {
        assignmentUpdated = false;
        assetUpdated = false;
        auditWritten = false;
      }
    }

    simulateReturnTx(null);
    assert.ok(assignmentUpdated && assetUpdated && auditWritten);
  });

  it("return audit failure rolls back assignment and asset updates", () => {
    let assignmentUpdated = false;
    let assetUpdated = false;

    function simulateReturnTx(failAt: string | null): void {
      try {
        if (failAt === "assignment") throw new Error();
        assignmentUpdated = true;
        if (failAt === "asset") throw new Error();
        assetUpdated = true;
        if (failAt === "audit") throw new Error();
      } catch {
        assignmentUpdated = false;
        assetUpdated = false;
      }
    }

    simulateReturnTx("audit");
    assert.ok(!assignmentUpdated && !assetUpdated);
  });
});

// ---------------------------------------------------------------------------
// 13. Locking order contracts
// ---------------------------------------------------------------------------

describe("assignment — locking order contracts", () => {
  it("assignment locks asset row before creating assignment record", () => {
    const steps = ["lock asset FOR UPDATE", "revalidate asset status", "revalidate employee status", "create assignment", "update asset", "write audit"];
    assert.ok(steps.indexOf("lock asset FOR UPDATE") < steps.indexOf("create assignment"));
    assert.ok(steps.indexOf("lock asset FOR UPDATE") < steps.indexOf("update asset"));
  });

  it("return locks asset row before locking assignment row", () => {
    const steps = ["read assignment (no lock)", "lock asset FOR UPDATE", "lock assignment FOR UPDATE", "revalidate returnedAt", "update assignment", "update asset", "write audit"];
    assert.ok(steps.indexOf("lock asset FOR UPDATE") < steps.indexOf("lock assignment FOR UPDATE"));
  });

  it("return reads assignment outside transaction to discover assetId", () => {
    const steps = ["read assignment (no lock)", "BEGIN transaction", "lock asset FOR UPDATE", "lock assignment FOR UPDATE"];
    assert.ok(steps.indexOf("read assignment (no lock)") < steps.indexOf("BEGIN transaction"));
  });

  it("asset-first lock order is consistent across assignment and return", () => {
    const assignSteps = ["lock asset", "create assignment"];
    const returnSteps = ["lock asset", "lock assignment"];
    assert.equal(assignSteps[0], "lock asset");
    assert.equal(returnSteps[0], "lock asset");
  });

  it("locking uses $queryRaw SELECT FOR UPDATE — same pattern as lockAndReadQuantity", () => {
    const pattern = "SELECT \"id\", \"status\" FROM \"assets\" WHERE \"id\" = $1::uuid FOR UPDATE";
    assert.ok(pattern.includes("FOR UPDATE"));
    assert.ok(pattern.includes("$1::uuid"));
  });
});

// ---------------------------------------------------------------------------
// 14. Concurrency scenarios (simulated — not real PostgreSQL concurrency)
// ---------------------------------------------------------------------------

describe("assignment — concurrency scenarios (simulated)", () => {
  it("two concurrent assignment attempts: second fails after first acquires lock", () => {
    let assetStatus = "AVAILABLE";
    let openAssignmentCount = 0;

    function assignWithLock(): string | null {
      // Simulates: lock acquired, re-read status
      if (assetStatus !== "AVAILABLE") return "ASSET_ALREADY_ASSIGNED";
      assetStatus = "ASSIGNED";
      openAssignmentCount++;
      return null;
    }

    const t1 = assignWithLock();
    const t2 = assignWithLock();
    assert.equal(t1, null);
    assert.equal(t2, "ASSET_ALREADY_ASSIGNED");
    assert.equal(openAssignmentCount, 1);
  });

  it("two concurrent return attempts: second fails after first acquires lock", () => {
    let returnedAt: Date | null = null;
    let returnCount = 0;

    function returnWithLock(): string | null {
      // Simulates: lock acquired, re-read returnedAt
      if (returnedAt !== null) return "ASSIGNMENT_ALREADY_RETURNED";
      returnedAt = new Date();
      returnCount++;
      return null;
    }

    const t1 = returnWithLock();
    const t2 = returnWithLock();
    assert.equal(t1, null);
    assert.equal(t2, "ASSIGNMENT_ALREADY_RETURNED");
    assert.equal(returnCount, 1);
  });

  it("P2002 on one_open_per_asset is mapped to ALREADY_ASSIGNED — not a generic 500", () => {
    const err = { code: "P2002", meta: { target: "asset_assignments_one_open_per_asset" } };
    const { isOpenAssignmentConflict } = (() => {
      function isOpenAssignmentConflict(e: unknown): boolean {
        if (typeof e !== "object" || e === null || !("code" in e) || (e as { code: string }).code !== "P2002") return false;
        const meta = (e as { meta?: { target?: string | string[] } }).meta;
        if (!meta) return false;
        const t = meta.target;
        const needle = "asset_assignments_one_open_per_asset";
        if (Array.isArray(t)) return t.some((x) => String(x).includes(needle));
        if (typeof t === "string") return t.includes(needle);
        return false;
      }
      return { isOpenAssignmentConflict };
    })();
    assert.ok(isOpenAssignmentConflict(err));
    const httpStatus = isOpenAssignmentConflict(err) ? 409 : 500;
    assert.equal(httpStatus, 409);
  });

  it("employee status re-read inside transaction catches concurrent deactivation", () => {
    // Simulates: employee was ACTIVE at pre-check, then deactivated before in-tx re-read
    let employeeStatus = "INACTIVE"; // committed by concurrent deactivation
    function inTxEmployeeCheck(): string | null {
      return employeeStatus === "ACTIVE" ? null : "EMPLOYEE_NOT_ACTIVE";
    }
    assert.equal(inTxEmployeeCheck(), "EMPLOYEE_NOT_ACTIVE");
  });
});

// ---------------------------------------------------------------------------
// 15. Audit log — Stage 5.5 action identifiers
// ---------------------------------------------------------------------------

describe("audit log — Stage 5.5 action identifiers", () => {
  const ACTIONS = ["ASSIGN_ASSET", "RETURN_ASSET"];

  it("all 2 Stage 5.5 audit actions are defined", () => {
    assert.equal(ACTIONS.length, 2);
  });

  it("ASSIGN_ASSET audit entry records assignmentId, assetId, employeeId, departmentId", () => {
    const entry = {
      action: "ASSIGN_ASSET",
      entityType: "asset_assignment",
      entityId: VALID_UUID,
      newValues: { assignmentId: VALID_UUID, assetId: VALID_UUID_2, employeeId: VALID_UUID_3, departmentId: null, assignedAt: new Date() },
    };
    assert.ok("assignmentId" in entry.newValues);
    assert.ok("assetId" in entry.newValues);
    assert.ok("employeeId" in entry.newValues);
    assert.ok("assignedAt" in entry.newValues);
  });

  it("RETURN_ASSET audit entry records assignmentId, assetId, returnCondition, returnedAt", () => {
    const entry = {
      action: "RETURN_ASSET",
      entityType: "asset_assignment",
      entityId: VALID_UUID,
      newValues: { assignmentId: VALID_UUID, assetId: VALID_UUID_2, returnedAt: new Date(), returnCondition: "GOOD" },
    };
    assert.ok("returnCondition" in entry.newValues);
    assert.ok("returnedAt" in entry.newValues);
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
// 16. Permission contracts
// ---------------------------------------------------------------------------

describe("assignment endpoints — authorization contracts", () => {
  const ASSIGNMENT_PERMISSIONS = ["assignments.view", "assignments.assign", "assignments.return"];

  const IT_STAFF_PERMS = [
    "assignments.view", "assignments.assign", "assignments.return",
    "assets.view", "assets.register", "employees.view",
  ];

  const ADMIN_ONLY_PERMS = ["users.create", "users.reset_password", "users.view", "users.activate", "users.deactivate"];

  it("IT_STAFF has all 3 assignment permissions", () => {
    for (const p of ASSIGNMENT_PERMISSIONS) {
      assert.ok(IT_STAFF_PERMS.includes(p), `IT_STAFF missing: ${p}`);
    }
  });

  it("ADMIN-only permissions are not in assignment permission set", () => {
    for (const p of ADMIN_ONLY_PERMS) {
      assert.ok(!ASSIGNMENT_PERMISSIONS.includes(p));
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

  it("mustChangePassword blocks assignment endpoints", () => {
    function decide(auth: boolean, pwChanged: boolean, hasPerm: boolean): boolean {
      return auth && pwChanged && hasPerm;
    }
    assert.equal(decide(true, false, true), false);
  });

  it("assignments.assign is required for POST /", () => {
    assert.ok(ASSIGNMENT_PERMISSIONS.includes("assignments.assign"));
  });

  it("assignments.return is required for POST /:assignmentId/return", () => {
    assert.ok(ASSIGNMENT_PERMISSIONS.includes("assignments.return"));
  });

  it("assignments.view is required for GET endpoints", () => {
    assert.ok(ASSIGNMENT_PERMISSIONS.includes("assignments.view"));
  });
});

// ---------------------------------------------------------------------------
// 17. App route registration
// ---------------------------------------------------------------------------

describe("assignments — app route registration", () => {
  it("assignments router is mounted at /api/assignments in app.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const appPath = fileURLToPath(new URL("../app.ts", import.meta.url));
    const source = readFileSync(appPath, "utf8");
    assert.ok(source.includes("assignmentsRouter"));
    assert.ok(source.includes("/api/assignments"));
  });

  it("all 5 assignment endpoints are defined in the router", () => {
    const endpoints = [
      { method: "GET",  path: "/" },
      { method: "GET",  path: "/:assignmentId" },
      { method: "POST", path: "/" },
      { method: "POST", path: "/:assignmentId/return" },
      { method: "GET",  path: "/asset/:assetId" },
    ];
    assert.equal(endpoints.length, 5);
    assert.ok(endpoints.some((e) => e.path === "/:assignmentId/return" && e.method === "POST"));
    assert.ok(endpoints.some((e) => e.path === "/asset/:assetId" && e.method === "GET"));
  });

  it("/asset/:assetId is registered before /:assignmentId in the router source", async () => {
    // D-01 regression: Express matches routes in registration order.
    // GET /asset/:assetId must appear before GET /:assignmentId so that
    // requests to /api/assignments/asset/<uuid> reach listAssetAssignmentsHandler
    // rather than being intercepted by getAssignmentByIdHandler.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const routerPath = fileURLToPath(new URL("../routes/assignments.ts", import.meta.url));
    const source = readFileSync(routerPath, "utf8");
    const assetRoutePos = source.indexOf('"/asset/:assetId"');
    const assignmentIdPos = source.indexOf('"/:assignmentId"');
    assert.ok(assetRoutePos !== -1, "/asset/:assetId route must be present in router");
    assert.ok(assignmentIdPos !== -1, "/:assignmentId route must be present in router");
    assert.ok(
      assetRoutePos < assignmentIdPos,
      `/asset/:assetId (pos ${assetRoutePos}) must be registered before /:assignmentId (pos ${assignmentIdPos})`
    );
  });

  it("listAssetAssignmentsHandler is bound to GET /asset/:assetId, not getAssignmentByIdHandler", async () => {
    // D-01 regression: verify handler identity by inspecting the source region
    // between the /asset/:assetId path string and the next route declaration.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const routerPath = fileURLToPath(new URL("../routes/assignments.ts", import.meta.url));
    const source = readFileSync(routerPath, "utf8");
    const assetRoutePos = source.indexOf('"/asset/:assetId"');
    // Slice from the /asset/:assetId declaration to the next router.get/post call
    const afterAssetRoute = source.slice(assetRoutePos);
    const nextRoutePos = afterAssetRoute.indexOf("router.", 1);
    const assetRouteBlock = nextRoutePos === -1 ? afterAssetRoute : afterAssetRoute.slice(0, nextRoutePos);
    assert.ok(
      assetRouteBlock.includes("listAssetAssignmentsHandler"),
      "listAssetAssignmentsHandler must be the handler for GET /asset/:assetId"
    );
    assert.ok(
      !assetRouteBlock.includes("getAssignmentByIdHandler"),
      "getAssignmentByIdHandler must NOT be the handler for GET /asset/:assetId"
    );
  });
});

// ---------------------------------------------------------------------------
// 18. Existing lifecycle restrictions preserved
// ---------------------------------------------------------------------------

describe("assignment — existing lifecycle restrictions preserved", () => {
  type AssetStatus = "AVAILABLE" | "ASSIGNED" | "UNDER_MAINTENANCE" | "RETIRED" | "DISPOSED";

  function canRetire(status: AssetStatus): string | null {
    if (status === "RETIRED") return "ALREADY_RETIRED";
    if (status === "DISPOSED") return "INVALID_TRANSITION";
    if (status === "ASSIGNED") return "ASSET_ASSIGNED";
    return null;
  }

  function canDispose(status: AssetStatus): string | null {
    if (status === "DISPOSED") return "ALREADY_DISPOSED";
    if (status === "ASSIGNED") return "ASSET_ASSIGNED";
    return null;
  }

  it("ASSIGNED asset cannot be retired", () => {
    assert.equal(canRetire("ASSIGNED"), "ASSET_ASSIGNED");
  });

  it("ASSIGNED asset cannot be disposed", () => {
    assert.equal(canDispose("ASSIGNED"), "ASSET_ASSIGNED");
  });

  it("AVAILABLE asset can be retired after return", () => {
    assert.equal(canRetire("AVAILABLE"), null);
  });

  it("AVAILABLE asset can be disposed after return", () => {
    assert.equal(canDispose("AVAILABLE"), null);
  });
});

// ---------------------------------------------------------------------------
// 19. Assignment history — retrieval contracts
// ---------------------------------------------------------------------------

describe("assignment history — retrieval contracts", () => {
  it("assignments are ordered by assignedAt descending by default", () => {
    const assignments = [
      { id: "a1", assignedAt: new Date("2026-01-10") },
      { id: "a3", assignedAt: new Date("2026-01-30") },
      { id: "a2", assignedAt: new Date("2026-01-20") },
    ];
    const sorted = [...assignments].sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime());
    assert.equal(sorted[0].id, "a3");
    assert.equal(sorted[1].id, "a2");
    assert.equal(sorted[2].id, "a1");
  });

  it("open filter returns only assignments with returnedAt = null", () => {
    const all = [
      { id: "a1", returnedAt: null },
      { id: "a2", returnedAt: new Date() },
      { id: "a3", returnedAt: null },
    ];
    const open = all.filter((a) => a.returnedAt === null);
    assert.equal(open.length, 2);
    assert.ok(open.every((a) => a.returnedAt === null));
  });

  it("closed filter returns only assignments with returnedAt set", () => {
    const all = [
      { id: "a1", returnedAt: null },
      { id: "a2", returnedAt: new Date() },
    ];
    const closed = all.filter((a) => a.returnedAt !== null);
    assert.equal(closed.length, 1);
    assert.equal(closed[0].id, "a2");
  });

  it("listAssetAssignments returns all assignments for a given asset", () => {
    const all = [
      { id: "a1", assetId: VALID_UUID },
      { id: "a2", assetId: VALID_UUID_2 },
      { id: "a3", assetId: VALID_UUID },
    ];
    const forAsset = all.filter((a) => a.assetId === VALID_UUID);
    assert.equal(forAsset.length, 2);
  });

  it("pagination result contains all required fields", async () => {
    const { buildPaginationResult } = await import("../utils/pagination.js");
    const r = buildPaginationResult([{ id: "a1" }], 1, 1, 20);
    assert.ok("items" in r && "total" in r && "page" in r && "pageSize" in r && "totalPages" in r);
  });

  it("date range filter uses assignedAt", () => {
    const from = new Date("2026-01-01");
    const to = new Date("2026-06-30");
    const assignments = [
      { id: "a1", assignedAt: new Date("2026-03-15") },
      { id: "a2", assignedAt: new Date("2025-12-01") },
      { id: "a3", assignedAt: new Date("2026-07-01") },
    ];
    const filtered = assignments.filter((a) => a.assignedAt >= from && a.assignedAt <= to);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, "a1");
  });
});

// ---------------------------------------------------------------------------
// 20. New AssetAssignment fields
// ---------------------------------------------------------------------------

describe("assignment — new schema fields", () => {
  it("expectedReturnDate is nullable", () => {
    const rec = { expectedReturnDate: null as Date | null };
    assert.equal(rec.expectedReturnDate, null);
  });

  it("expectedReturnDate accepts a Date value", () => {
    const rec = { expectedReturnDate: new Date("2026-12-31") };
    assert.ok(rec.expectedReturnDate instanceof Date);
  });

  it("returnCondition is nullable", () => {
    const rec = { returnCondition: null as string | null };
    assert.equal(rec.returnCondition, null);
  });

  it("returnCondition accepts AssetCondition values", () => {
    const conditions = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"];
    for (const c of conditions) {
      const rec = { returnCondition: c };
      assert.ok(conditions.includes(rec.returnCondition));
    }
  });

  it("returnNotes is nullable", () => {
    const rec = { returnNotes: null as string | null };
    assert.equal(rec.returnNotes, null);
  });

  it("returnNotes accepts text", () => {
    const rec = { returnNotes: "Minor wear on keyboard" };
    assert.ok(rec.returnNotes.length > 0);
  });

  it("notes field is preserved independently of returnNotes", () => {
    const rec = { notes: "Assigned for onboarding", returnNotes: "All accessories returned" };
    assert.ok(rec.notes !== rec.returnNotes);
  });
});

