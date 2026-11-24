/**
 * Seed: roles and permissions
 *
 * Idempotent — safe to run multiple times.
 * Uses upsert so existing rows are never duplicated.
 *
 * Roles:       ADMIN, IT_STAFF
 * Permissions: users.create, users.reset_password, users.view, users.activate, users.deactivate
 * Assignments: ADMIN receives all five; IT_STAFF receives none.
 *
 * Run from server/:
 *   npx tsx src/scripts/seedRolesAndPermissions.ts
 */

import "dotenv/config";
import prisma from "../config/database.js";

async function seed(): Promise<void> {
  // ── Roles ────────────────────────────────────────────────────────────────
  const adminRole = await prisma.role.upsert({
    where: { name: "ADMIN" },
    update: {},
    create: { name: "ADMIN", description: "System administrator with full access" },
  });

  await prisma.role.upsert({
    where: { name: "IT_STAFF" },
    update: {},
    create: { name: "IT_STAFF", description: "Ordinary IT staff member" },
  });

  // ── Permissions ──────────────────────────────────────────────────────────
  const usersCreatePerm = await prisma.permission.upsert({
    where: { name: "users.create" },
    update: {},
    create: { name: "users.create", description: "Create new user accounts" },
  });

  const usersResetPasswordPerm = await prisma.permission.upsert({
    where: { name: "users.reset_password" },
    update: {},
    create: { name: "users.reset_password", description: "Reset a user account password" },
  });

  // ── Role → Permission assignments ────────────────────────────────────────
  // ADMIN receives users.create and users.reset_password.
  // IT_STAFF intentionally receives neither.
  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: { roleId: adminRole.id, permissionId: usersCreatePerm.id },
    },
    update: {},
    create: { roleId: adminRole.id, permissionId: usersCreatePerm.id },
  });

  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: { roleId: adminRole.id, permissionId: usersResetPasswordPerm.id },
    },
    update: {},
    create: { roleId: adminRole.id, permissionId: usersResetPasswordPerm.id },
  });

  const usersViewPerm = await prisma.permission.upsert({
    where: { name: "users.view" },
    update: {},
    create: { name: "users.view", description: "View user accounts" },
  });

  const usersActivatePerm = await prisma.permission.upsert({
    where: { name: "users.activate" },
    update: {},
    create: { name: "users.activate", description: "Activate user accounts" },
  });

  const usersDeactivatePerm = await prisma.permission.upsert({
    where: { name: "users.deactivate" },
    update: {},
    create: { name: "users.deactivate", description: "Deactivate user accounts" },
  });

  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: adminRole.id, permissionId: usersViewPerm.id } },
    update: {},
    create: { roleId: adminRole.id, permissionId: usersViewPerm.id },
  });

  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: adminRole.id, permissionId: usersActivatePerm.id } },
    update: {},
    create: { roleId: adminRole.id, permissionId: usersActivatePerm.id },
  });

  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: adminRole.id, permissionId: usersDeactivatePerm.id } },
    update: {},
    create: { roleId: adminRole.id, permissionId: usersDeactivatePerm.id },
  });

  console.log(
    "Seed complete: ADMIN and IT_STAFF roles created; users.create, users.reset_password, users.view, users.activate, users.deactivate assigned to ADMIN only."
  );
}

seed()
  .catch((err: Error) => {
    console.error("Seed failed:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
