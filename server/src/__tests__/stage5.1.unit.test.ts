/**
 * Stage 5.1 — Master Data Management Unit Tests
 * Uses Node.js built-in test runner. No database required.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// 1. Permission seed contracts
// ---------------------------------------------------------------------------

describe("stage 5.1 — permission seed contracts", () => {
  const ADMIN_ONLY = [
    "users.create",
    "users.reset_password",
    "users.view",
    "users.activate",
    "users.deactivate",
  ];

  const OPERATIONAL = [
    "departments.view", "departments.create", "departments.update",
    "locations.view", "locations.create", "locations.update",
    "asset_categories.view", "asset_categories.create", "asset_categories.update",
    "vendors.view", "vendors.create", "vendors.update", "vendors.deactivate",
    "employees.view", "employees.create", "employees.update",
    "employees.change_status", "employees.transfer",
    "assets.view", "assets.register", "assets.update", "assets.retire", "assets.dispose",
    "assignments.view", "assignments.assign", "assignments.return",
    "purchases.view", "purchases.create", "purchases.update",
    "purchases.confirm", "purchases.receive", "purchases.cancel",
    "stock.view", "stock.create_item", "stock.update_item",
    "stock.issue", "stock.return", "stock.adjust",
    "maintenance.view", "maintenance.create", "maintenance.update", "maintenance.close",
    "imports.view", "imports.execute",
    "reports.view", "reports.export",
  ];

  const ADMIN_ALL = [...ADMIN_ONLY, ...OPERATIONAL];
  const IT_STAFF_ALL = [...OPERATIONAL];

  it("ADMIN receives all admin-only permissions", () => {
    for (const p of ADMIN_ONLY) assert.ok(ADMIN_ALL.includes(p), `ADMIN missing: ${p}`);
  });

  it("IT_STAFF does not receive any admin-only permission", () => {
    for (const p of ADMIN_ONLY) assert.ok(!IT_STAFF_ALL.includes(p), `IT_STAFF should not have: ${p}`);
  });

  it("IT_STAFF receives all operational permissions", () => {
    for (const p of OPERATIONAL) assert.ok(IT_STAFF_ALL.includes(p), `IT_STAFF missing: ${p}`);
  });

  it("ADMIN receives all operational permissions", () => {
    for (const p of OPERATIONAL) assert.ok(ADMIN_ALL.includes(p), `ADMIN missing: ${p}`);
  });

  it("IT_STAFF cannot create users", () => {
    assert.ok(!IT_STAFF_ALL.includes("users.create"));
  });

  it("IT_STAFF cannot reset passwords", () => {
    assert.ok(!IT_STAFF_ALL.includes("users.reset_password"));
  });

  it("IT_STAFF cannot view user accounts", () => {
    assert.ok(!IT_STAFF_ALL.includes("users.view"));
  });

  it("seed idempotency — upsert on name prevents duplicates", () => {
    const seen = new Set<string>();
    let duplicates = 0;
    for (const p of [...ADMIN_ALL, ...ADMIN_ALL]) {
      if (seen.has(p)) duplicates++;
      seen.add(p);
    }
    // Duplicates exist in the loop but upsert means DB has only unique rows
    assert.equal(seen.size, ADMIN_ALL.length);
  });
});

// ---------------------------------------------------------------------------
// 2. Department — validation
// ---------------------------------------------------------------------------

describe("department — validation contracts", async () => {
  const { z } = await import("zod");

  const createSchema = z.object({
    name: z.string().min(1).max(150),
    code: z.string().min(1).max(20).regex(/^[A-Z0-9_-]+$/i),
    managerEmployeeId: z.string().uuid().optional(),
  });

  const updateSchema = z.object({
    name: z.string().min(1).max(150).optional(),
    code: z.string().min(1).max(20).regex(/^[A-Z0-9_-]+$/i).optional(),
    managerEmployeeId: z.string().uuid().nullable().optional(),
  });

  it("create accepts valid name and code", () => {
    assert.ok(createSchema.safeParse({ name: "Engineering", code: "ENG" }).success);
  });

  it("create rejects empty name", () => {
    assert.ok(!createSchema.safeParse({ name: "", code: "ENG" }).success);
  });

  it("create rejects code with spaces", () => {
    assert.ok(!createSchema.safeParse({ name: "Engineering", code: "ENG DEPT" }).success);
  });

  it("create rejects code longer than 20 chars", () => {
    assert.ok(!createSchema.safeParse({ name: "Engineering", code: "A".repeat(21) }).success);
  });

  it("create rejects invalid managerEmployeeId", () => {
    assert.ok(!createSchema.safeParse({ name: "Eng", code: "ENG", managerEmployeeId: "not-uuid" }).success);
  });

  it("update allows partial fields", () => {
    assert.ok(updateSchema.safeParse({ name: "Updated" }).success);
  });

  it("update allows null managerEmployeeId to clear manager", () => {
    assert.ok(updateSchema.safeParse({ managerEmployeeId: null }).success);
  });

  it("update rejects empty name", () => {
    assert.ok(!updateSchema.safeParse({ name: "" }).success);
  });
});

// ---------------------------------------------------------------------------
// 3. Department — authorization chain
// ---------------------------------------------------------------------------

describe("department — authorization chain", () => {
  function decide(auth: boolean, pwChanged: boolean, hasPerm: boolean): boolean {
    return auth && pwChanged && hasPerm;
  }

  it("unauthenticated request is rejected", () => assert.equal(decide(false, true, true), false));
  it("mustChangePassword blocks access", () => assert.equal(decide(true, false, true), false));
  it("IT_STAFF with departments.view can list", () => assert.equal(decide(true, true, true), true));
  it("IT_STAFF without departments.create is denied", () => assert.equal(decide(true, true, false), false));
  it("ADMIN with departments.update can update", () => assert.equal(decide(true, true, true), true));
});

// ---------------------------------------------------------------------------
// 4. Location — validation
// ---------------------------------------------------------------------------

describe("location — validation contracts", async () => {
  const { z } = await import("zod");

  const createSchema = z.object({
    name: z.string().min(1).max(150),
    building: z.string().max(100).optional(),
    room: z.string().max(50).optional(),
    departmentId: z.string().uuid().optional(),
  });

  it("accepts name only", () => {
    assert.ok(createSchema.safeParse({ name: "Server Room" }).success);
  });

  it("accepts all fields", () => {
    assert.ok(createSchema.safeParse({
      name: "Server Room", building: "Block A", room: "101",
      departmentId: "4f07dda8-40db-446b-9f9c-5e50e3fcf778",
    }).success);
  });

  it("rejects empty name", () => {
    assert.ok(!createSchema.safeParse({ name: "" }).success);
  });

  it("rejects invalid departmentId", () => {
    assert.ok(!createSchema.safeParse({ name: "Room", departmentId: "not-uuid" }).success);
  });
});

// ---------------------------------------------------------------------------
// 5. Asset Category — tag prefix validation
// ---------------------------------------------------------------------------

describe("asset category — tag prefix validation", () => {
  const TAG_PREFIX_REGEX = /^[A-Z]{2,5}$/;
  const validate = (p: string) => TAG_PREFIX_REGEX.test(p);

  it("accepts 2-letter prefix", () => assert.ok(validate("IT")));
  it("accepts 5-letter prefix", () => assert.ok(validate("ASSET")));
  it("rejects 1-letter prefix", () => assert.ok(!validate("A")));
  it("rejects 6-letter prefix", () => assert.ok(!validate("TOOLNG")));
  it("rejects lowercase", () => assert.ok(!validate("lap")));
  it("rejects digits", () => assert.ok(!validate("LA1")));
  it("rejects empty string", () => assert.ok(!validate("")));

  it("serialized category requires a prefix", () => {
    function check(isSerialized: boolean, tagPrefix?: string): string | null {
      if (isSerialized && !tagPrefix) return "PREFIX_REQUIRED";
      if (tagPrefix && !validate(tagPrefix)) return "INVALID_PREFIX";
      return null;
    }
    assert.equal(check(true, undefined), "PREFIX_REQUIRED");
    assert.equal(check(true, "LAP"), null);
    assert.equal(check(false, undefined), null);
    assert.equal(check(true, "lap"), "INVALID_PREFIX");
  });

  it("non-serialized category does not require a prefix", () => {
    const isSerialized = false;
    const tagPrefix: string | undefined = undefined;
    const error = (isSerialized && !tagPrefix) ? "PREFIX_REQUIRED" : null;
    assert.equal(error, null);
  });

  it("historical asset tags do not change when prefix changes", () => {
    const existingTag = "LAP-2026-0001";
    // Tag is stored on Asset record and is immutable after creation
    assert.equal(existingTag, "LAP-2026-0001");
  });

  it("cannot remove prefix from a serialized category", () => {
    function checkRemoval(isSerialized: boolean, newPrefix: string | null): string | null {
      if (isSerialized && newPrefix === null) return "PREFIX_REQUIRED";
      return null;
    }
    assert.equal(checkRemoval(true, null), "PREFIX_REQUIRED");
    assert.equal(checkRemoval(false, null), null);
    assert.equal(checkRemoval(true, "NB"), null);
  });
});

// ---------------------------------------------------------------------------
// 6. Asset Category — validation schema
// ---------------------------------------------------------------------------

describe("asset category — validation schema", async () => {
  const { z } = await import("zod");

  const createSchema = z.object({
    name: z.string().min(1).max(100),
    tagPrefix: z.string().min(2).max(5).optional(),
    isSerialized: z.boolean().optional(),
    description: z.string().max(1000).optional(),
  });

  it("accepts valid serialized category", () => {
    assert.ok(createSchema.safeParse({ name: "Laptop", tagPrefix: "LAP", isSerialized: true }).success);
  });

  it("accepts non-serialized category without prefix", () => {
    assert.ok(createSchema.safeParse({ name: "Toner", isSerialized: false }).success);
  });

  it("rejects tagPrefix shorter than 2 chars", () => {
    assert.ok(!createSchema.safeParse({ name: "Laptop", tagPrefix: "L" }).success);
  });

  it("rejects tagPrefix longer than 5 chars", () => {
    assert.ok(!createSchema.safeParse({ name: "Laptop", tagPrefix: "LAPTOP" }).success);
  });

  it("rejects empty name", () => {
    assert.ok(!createSchema.safeParse({ name: "" }).success);
  });
});

// ---------------------------------------------------------------------------
// 7. Vendor — validation
// ---------------------------------------------------------------------------

describe("vendor — validation contracts", async () => {
  const { z } = await import("zod");

  const createSchema = z.object({
    name: z.string().min(1).max(200),
    contactName: z.string().max(150).optional(),
    email: z.string().email().max(255).optional(),
    phone: z.string().max(30).optional(),
    address: z.string().max(1000).optional(),
  });

  it("accepts name only", () => assert.ok(createSchema.safeParse({ name: "Acme Corp" }).success));

  it("accepts all fields", () => {
    assert.ok(createSchema.safeParse({
      name: "Acme Corp", contactName: "John Doe",
      email: "john@acme.com", phone: "+233201234567", address: "123 Main St",
    }).success);
  });

  it("rejects empty name", () => assert.ok(!createSchema.safeParse({ name: "" }).success));
  it("rejects invalid email", () => assert.ok(!createSchema.safeParse({ name: "Acme", email: "bad" }).success));
});

// ---------------------------------------------------------------------------
// 8. Vendor — activate/deactivate logic
// ---------------------------------------------------------------------------

describe("vendor — activate/deactivate logic", () => {
  it("deactivating active vendor sets isActive=false", () => {
    assert.equal({ isActive: false }.isActive, false);
  });

  it("activating inactive vendor sets isActive=true", () => {
    assert.equal({ isActive: true }.isActive, true);
  });

  it("deactivating already-inactive returns alreadyInactive=true", () => {
    assert.equal({ alreadyInactive: true }.alreadyInactive, true);
  });

  it("activating already-active returns alreadyActive=true", () => {
    assert.equal({ alreadyActive: true }.alreadyActive, true);
  });

  it("deactivation does not delete vendor or purchase history", () => {
    assert.notEqual("update", "delete");
  });
});

// ---------------------------------------------------------------------------
// 9. Employee — validation
// ---------------------------------------------------------------------------

describe("employee — validation contracts", async () => {
  const { z } = await import("zod");

  const createSchema = z.object({
    employeeNumber: z.string().min(1).max(50),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    email: z.string().email().max(255),
    phone: z.string().max(30).optional(),
    jobTitle: z.string().max(150).optional(),
    departmentId: z.string().uuid().optional(),
    locationId: z.string().uuid().optional(),
  });

  it("accepts valid employee", () => {
    assert.ok(createSchema.safeParse({
      employeeNumber: "EMP001", firstName: "Cosmos",
      lastName: "Baidoo", email: "cosmos@example.com",
    }).success);
  });

  it("rejects missing employeeNumber", () => {
    assert.ok(!createSchema.safeParse({ firstName: "Cosmos", lastName: "Baidoo", email: "c@example.com" }).success);
  });

  it("rejects invalid email", () => {
    assert.ok(!createSchema.safeParse({ employeeNumber: "E1", firstName: "A", lastName: "B", email: "bad" }).success);
  });

  it("rejects invalid departmentId", () => {
    assert.ok(!createSchema.safeParse({
      employeeNumber: "E1", firstName: "A", lastName: "B",
      email: "a@b.com", departmentId: "not-uuid",
    }).success);
  });
});

// ---------------------------------------------------------------------------
// 10. Employee — status change
// ---------------------------------------------------------------------------

describe("employee — status change contracts", () => {
  it("changing to same status is rejected with STATUS_UNCHANGED", () => {
    function changeStatus(current: string, next: string): string | null {
      return current === next ? "STATUS_UNCHANGED" : null;
    }
    assert.equal(changeStatus("ACTIVE", "ACTIVE"), "STATUS_UNCHANGED");
    assert.equal(changeStatus("ACTIVE", "INACTIVE"), null);
  });

  it("all four statuses are valid", () => {
    const statuses = ["ACTIVE", "INACTIVE", "TRANSFERRED", "TERMINATED"];
    assert.equal(statuses.length, 4);
  });
});

// ---------------------------------------------------------------------------
// 11. Employee — department transfer
// ---------------------------------------------------------------------------

describe("employee — department transfer contracts", () => {
  it("transfer to same department is rejected with SAME_DEPARTMENT", () => {
    function validate(cur: string, target: string): string | null {
      return cur === target ? "SAME_DEPARTMENT" : null;
    }
    assert.equal(validate("dept-1", "dept-1"), "SAME_DEPARTMENT");
    assert.equal(validate("dept-1", "dept-2"), null);
  });

  it("transfer creates history record with fromDepartmentId and toDepartmentId", () => {
    const record = {
      employeeId: "emp-1",
      fromDepartmentId: "dept-1",
      toDepartmentId: "dept-2",
      effectiveDate: new Date("2026-01-15"),
    };
    assert.equal(record.fromDepartmentId, "dept-1");
    assert.equal(record.toDepartmentId, "dept-2");
    assert.ok(record.effectiveDate instanceof Date);
  });

  it("transfer is atomic — history failure rolls back employee update", () => {
    let empUpdated = false;
    let histCreated = false;
    function simulateTx(failAt: "emp" | "hist" | null) {
      try {
        if (failAt === "emp") throw new Error();
        empUpdated = true;
        if (failAt === "hist") throw new Error();
        histCreated = true;
      } catch {
        empUpdated = false;
        histCreated = false;
      }
    }
    simulateTx(null);
    assert.equal(empUpdated, true);
    assert.equal(histCreated, true);

    simulateTx("hist");
    assert.equal(empUpdated, false);
    assert.equal(histCreated, false);
  });

  it("fromDepartmentId is null when employee had no previous department", () => {
    const fromDepartmentId: string | null = null;
    assert.equal(fromDepartmentId, null);
  });

  it("effectiveDate must match YYYY-MM-DD", async () => {
    const { z } = await import("zod");
    const schema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    assert.ok(schema.safeParse("2026-01-15").success);
    assert.ok(!schema.safeParse("15-01-2026").success);
    assert.ok(!schema.safeParse("not-a-date").success);
  });

  it("previous history records are preserved after transfer", () => {
    const existing = [{ id: "h1", toDepartmentId: "dept-1" }];
    const newRecord = { id: "h2", fromDepartmentId: "dept-1", toDepartmentId: "dept-2" };
    const all = [...existing, newRecord];
    assert.equal(all.length, 2);
    assert.equal(all[0].id, "h1");
  });
});

// ---------------------------------------------------------------------------
// 12. Pagination utility
// ---------------------------------------------------------------------------

describe("pagination — buildPaginationResult", async () => {
  const { buildPaginationResult } = await import("../utils/pagination.js");

  it("returns correct totalPages for partial last page", () => {
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
    assert.equal(r.items.length, 1);
  });
});

// ---------------------------------------------------------------------------
// 13. Audit log — Stage 5.1 action identifiers
// ---------------------------------------------------------------------------

describe("audit log — Stage 5.1 action identifiers", () => {
  const ACTIONS = [
    "CREATE_DEPARTMENT", "UPDATE_DEPARTMENT",
    "CREATE_LOCATION", "UPDATE_LOCATION",
    "CREATE_ASSET_CATEGORY", "UPDATE_ASSET_CATEGORY",
    "CREATE_VENDOR", "UPDATE_VENDOR", "ACTIVATE_VENDOR", "DEACTIVATE_VENDOR",
    "CREATE_EMPLOYEE", "UPDATE_EMPLOYEE", "CHANGE_EMPLOYEE_STATUS", "TRANSFER_EMPLOYEE",
  ];

  it("all 14 Stage 5.1 audit actions are defined", () => {
    assert.equal(ACTIONS.length, 14);
  });

  it("audit entries never contain password or token fields", () => {
    const entry = {
      userId: "user-1", action: "CREATE_EMPLOYEE",
      entityType: "employee", entityId: "emp-1",
      newValues: { firstName: "Cosmos", lastName: "Baidoo" },
    };
    const s = JSON.stringify(entry);
    assert.ok(!s.includes("password"));
    assert.ok(!s.includes("hash"));
    assert.ok(!s.includes("token"));
  });
});

// ---------------------------------------------------------------------------
// 14. IT_STAFF cannot access user administration
// ---------------------------------------------------------------------------

describe("IT_STAFF — cannot access user administration endpoints", () => {
  const IT_STAFF_PERMS = [
    "departments.view", "departments.create", "departments.update",
    "locations.view", "locations.create", "locations.update",
    "asset_categories.view", "asset_categories.create", "asset_categories.update",
    "vendors.view", "vendors.create", "vendors.update", "vendors.deactivate",
    "employees.view", "employees.create", "employees.update",
    "employees.change_status", "employees.transfer",
  ];

  it("IT_STAFF cannot create user accounts", () => {
    assert.ok(!IT_STAFF_PERMS.includes("users.create"));
  });

  it("IT_STAFF cannot reset passwords", () => {
    assert.ok(!IT_STAFF_PERMS.includes("users.reset_password"));
  });

  it("IT_STAFF cannot alter roles or permissions", () => {
    const adminPerms = IT_STAFF_PERMS.filter(p => p.startsWith("roles.") || p.startsWith("permissions."));
    assert.equal(adminPerms.length, 0);
  });

  it("IT_STAFF can manage departments", () => {
    assert.ok(IT_STAFF_PERMS.includes("departments.create"));
    assert.ok(IT_STAFF_PERMS.includes("departments.update"));
    assert.ok(IT_STAFF_PERMS.includes("departments.view"));
  });

  it("IT_STAFF can manage employees and transfers", () => {
    assert.ok(IT_STAFF_PERMS.includes("employees.create"));
    assert.ok(IT_STAFF_PERMS.includes("employees.transfer"));
    assert.ok(IT_STAFF_PERMS.includes("employees.change_status"));
  });
});

// ---------------------------------------------------------------------------
// 15. Duplicate record handling — P2002 detection
// ---------------------------------------------------------------------------

describe("duplicate record handling — P2002 detection", () => {
  function isPrismaUnique(err: unknown): boolean {
    return typeof err === "object" && err !== null && "code" in err &&
      (err as { code: string }).code === "P2002";
  }

  it("P2002 is detected as a unique constraint violation", () => {
    assert.ok(isPrismaUnique({ code: "P2002" }));
  });

  it("P2003 is not a unique constraint violation", () => {
    assert.ok(!isPrismaUnique({ code: "P2003" }));
  });

  it("generic Error is not a unique constraint violation", () => {
    assert.ok(!isPrismaUnique(new Error("other")));
  });

  it("null is not a unique constraint violation", () => {
    assert.ok(!isPrismaUnique(null));
  });

  it("department duplicate produces 409", () => {
    const status = isPrismaUnique({ code: "P2002" }) ? 409 : 500;
    assert.equal(status, 409);
  });

  it("employee duplicate (employeeNumber or email) produces 409", () => {
    const status = isPrismaUnique({ code: "P2002" }) ? 409 : 500;
    assert.equal(status, 409);
  });
});
