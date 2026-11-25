/**
 * Seed: roles and permissions
 *
 * Idempotent — safe to run multiple times.
 * Uses upsert so existing rows are never duplicated.
 *
 * Roles:       ADMIN, IT_STAFF
 *
 * ADMIN-only permissions (user administration):
 *   users.create, users.reset_password, users.view, users.activate, users.deactivate
 *
 * Operational permissions (both ADMIN and IT_STAFF):
 *   departments.view, departments.create, departments.update
 *   locations.view, locations.create, locations.update
 *   asset_categories.view, asset_categories.create, asset_categories.update
 *   vendors.view, vendors.create, vendors.update, vendors.deactivate
 *   employees.view, employees.create, employees.update,
 *   employees.change_status, employees.transfer
 *   assets.view, assets.register, assets.update, assets.retire, assets.dispose
 *   assignments.view, assignments.assign, assignments.return
 *   purchases.view, purchases.create, purchases.update,
 *   purchases.confirm, purchases.receive, purchases.cancel
 *   stock.view, stock.create_item, stock.update_item,
 *   stock.issue, stock.return, stock.adjust
 *   maintenance.view, maintenance.create, maintenance.update, maintenance.close
 *   imports.view, imports.execute
 *   reports.view, reports.export
 *
 * Run from server/:
 *   npx tsx src/scripts/seedRolesAndPermissions.ts
 */

import "dotenv/config";
import prisma from "../config/database.js";

// ---------------------------------------------------------------------------
// Permission definitions
// ---------------------------------------------------------------------------

const ADMIN_ONLY_PERMISSIONS: Array<{ name: string; description: string }> = [
  { name: "users.create",         description: "Create new user accounts" },
  { name: "users.reset_password", description: "Reset a user account password" },
  { name: "users.view",           description: "View user accounts" },
  { name: "users.activate",       description: "Activate user accounts" },
  { name: "users.deactivate",     description: "Deactivate user accounts" },
];

const OPERATIONAL_PERMISSIONS: Array<{ name: string; description: string }> = [
  // Departments
  { name: "departments.view",   description: "List and view departments" },
  { name: "departments.create", description: "Create new departments" },
  { name: "departments.update", description: "Edit department details" },
  // Locations
  { name: "locations.view",   description: "List and view locations" },
  { name: "locations.create", description: "Create new locations" },
  { name: "locations.update", description: "Edit location details" },
  // Asset categories
  { name: "asset_categories.view",   description: "List and view asset categories" },
  { name: "asset_categories.create", description: "Create new asset categories" },
  { name: "asset_categories.update", description: "Edit asset category details" },
  // Vendors
  { name: "vendors.view",       description: "List and view vendors" },
  { name: "vendors.create",     description: "Create new vendors" },
  { name: "vendors.update",     description: "Edit vendor details" },
  { name: "vendors.deactivate", description: "Deactivate a vendor" },
  // Employees
  { name: "employees.view",          description: "List and view employees" },
  { name: "employees.create",        description: "Create new employee records" },
  { name: "employees.update",        description: "Edit employee details" },
  { name: "employees.change_status", description: "Change employee status" },
  { name: "employees.transfer",      description: "Record a department transfer" },
  // Assets
  { name: "assets.view",     description: "List and view assets" },
  { name: "assets.register", description: "Register a new serialized asset" },
  { name: "assets.update",   description: "Edit asset details" },
  { name: "assets.retire",   description: "Mark an asset as retired" },
  { name: "assets.dispose",  description: "Mark an asset as disposed" },
  // Assignments
  { name: "assignments.view",   description: "View asset assignment history" },
  { name: "assignments.assign", description: "Assign an asset to an employee" },
  { name: "assignments.return", description: "Record an asset return" },
  // Purchases
  { name: "purchases.view",    description: "List and view purchase orders" },
  { name: "purchases.create",  description: "Create a draft purchase order" },
  { name: "purchases.update",  description: "Edit a draft purchase order" },
  { name: "purchases.confirm", description: "Confirm a purchase order" },
  { name: "purchases.receive", description: "Receive a purchase order" },
  { name: "purchases.cancel",  description: "Cancel a purchase order" },
  // Stock
  { name: "stock.view",        description: "View stock items and movement history" },
  { name: "stock.create_item", description: "Create a new stock item definition" },
  { name: "stock.update_item", description: "Edit stock item details" },
  { name: "stock.issue",       description: "Issue stock to an employee or department" },
  { name: "stock.return",      description: "Record a stock return" },
  { name: "stock.adjust",      description: "Record a stock adjustment" },
  // Maintenance
  { name: "maintenance.view",   description: "View maintenance records" },
  { name: "maintenance.create", description: "Report a new maintenance issue" },
  { name: "maintenance.update", description: "Update a maintenance record" },
  { name: "maintenance.close",  description: "Resolve or cancel a maintenance record" },
  // Imports
  { name: "imports.view",    description: "View import batch history" },
  { name: "imports.execute", description: "Upload and execute an Excel import" },
  // Reports
  { name: "reports.view",   description: "View all reports and analytics" },
  { name: "reports.export", description: "Export reports to Excel/CSV" },
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed(): Promise<void> {
  // ── Roles ────────────────────────────────────────────────────────────────
  const adminRole = await prisma.role.upsert({
    where: { name: "ADMIN" },
    update: {},
    create: { name: "ADMIN", description: "System administrator with full access" },
  });

  const itStaffRole = await prisma.role.upsert({
    where: { name: "IT_STAFF" },
    update: {},
    create: { name: "IT_STAFF", description: "Ordinary IT staff member" },
  });

  // ── Upsert all permissions and collect their IDs ─────────────────────────
  const adminOnlyIds: string[] = [];
  for (const perm of ADMIN_ONLY_PERMISSIONS) {
    const record = await prisma.permission.upsert({
      where: { name: perm.name },
      update: {},
      create: perm,
    });
    adminOnlyIds.push(record.id);
  }

  const operationalIds: string[] = [];
  for (const perm of OPERATIONAL_PERMISSIONS) {
    const record = await prisma.permission.upsert({
      where: { name: perm.name },
      update: {},
      create: perm,
    });
    operationalIds.push(record.id);
  }

  // ── Assign ADMIN-only permissions to ADMIN ───────────────────────────────
  for (const permissionId of adminOnlyIds) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId } },
      update: {},
      create: { roleId: adminRole.id, permissionId },
    });
  }

  // ── Assign operational permissions to both ADMIN and IT_STAFF ────────────
  for (const permissionId of operationalIds) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId } },
      update: {},
      create: { roleId: adminRole.id, permissionId },
    });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: itStaffRole.id, permissionId } },
      update: {},
      create: { roleId: itStaffRole.id, permissionId },
    });
  }

  const totalPerms = ADMIN_ONLY_PERMISSIONS.length + OPERATIONAL_PERMISSIONS.length;
  console.log(
    `Seed complete: ADMIN (${ADMIN_ONLY_PERMISSIONS.length + OPERATIONAL_PERMISSIONS.length} permissions), ` +
    `IT_STAFF (${OPERATIONAL_PERMISSIONS.length} permissions). ` +
    `${totalPerms} total permission identifiers.`
  );
}

seed()
  .catch((err: Error) => {
    console.error("Seed failed:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
