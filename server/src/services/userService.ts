import prisma from "../config/database.js";
import { hashPassword } from "./passwordService.js";
import { revokeAllSessionsTx } from "./sessionService.js";

/**
 * Generates the default password for a new account.
 *
 * Rule: first two letters of firstName + full lastName, all lowercase, trimmed.
 * Example: Cosmos Baidoo → cobaidoo
 *
 * Throws if either name is missing or too short to produce a valid password.
 */
export function generateDefaultPassword(firstName: string, lastName: string): string {
  const first = firstName.trim();
  const last = lastName.trim();

  if (first.length < 2) {
    throw new Error(
      "Employee first name must be at least 2 characters to generate a default password."
    );
  }
  if (last.length < 1) {
    throw new Error(
      "Employee last name must not be empty to generate a default password."
    );
  }

  return (first.slice(0, 2) + last).toLowerCase();
}

export interface CreateUserInput {
  username: string;
  email: string;
  employeeId: string;
}

export interface CreatedUserResult {
  id: string;
  username: string;
  email: string;
  employeeId: string;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  /** Plaintext default password — return to the administrator once only. Never log. */
  defaultPassword: string;
}

/**
 * Creates a new user account linked to an existing employee.
 *
 * - Validates the employee exists and has no existing account.
 * - Generates and hashes the default password.
 * - Sets mustChangePassword = true.
 * - Never stores or returns the password hash in the result.
 */
export async function createUser(input: CreateUserInput): Promise<CreatedUserResult> {
  const { username, email, employeeId } = input;

  // Verify employee exists
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, firstName: true, lastName: true },
  });

  if (!employee) {
    throw new UserServiceError("Employee not found.", "EMPLOYEE_NOT_FOUND");
  }

  // Generate default password before any DB writes
  const defaultPassword = generateDefaultPassword(employee.firstName, employee.lastName);
  const passwordHash = await hashPassword(defaultPassword);

  // Create the user — DB unique constraints on username, email, employeeId
  // will throw a Prisma P2002 error if duplicates exist; the controller handles that.
  const user = await prisma.user.create({
    data: {
      username,
      email,
      passwordHash,
      employeeId,
      isActive: true,
      mustChangePassword: true,
    },
    select: {
      id: true,
      username: true,
      email: true,
      employeeId: true,
      isActive: true,
      mustChangePassword: true,
      createdAt: true,
    },
  });

  return {
    ...user,
    employeeId: user.employeeId as string,
    defaultPassword,
  };
}

export class UserServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "UserServiceError";
  }
}

export interface ResetPasswordResult {
  /** Plaintext default password — return to the administrator once only. Never log. */
  defaultPassword: string;
}

/**
 * Resets a user account's password to the employee-derived default.
 *
 * - Confirms the target user exists.
 * - Retrieves the linked employee record for name-based password generation.
 * - Generates and hashes the default password.
 * - Sets mustChangePassword = true.
 * - Never stores or returns the password hash in the result.
 *
 * Session revocation is the caller's responsibility.
 */
export async function resetUserPassword(
  targetUserId: string,
  initiatorUserId: string
): Promise<ResetPasswordResult> {
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, employeeId: true },
  });

  if (!user) {
    throw new UserServiceError("User not found.", "USER_NOT_FOUND");
  }

  if (!user.employeeId) {
    throw new UserServiceError(
      "This user account is not linked to an employee record.",
      "NO_EMPLOYEE_RECORD"
    );
  }

  const employee = await prisma.employee.findUnique({
    where: { id: user.employeeId },
    select: { firstName: true, lastName: true },
  });

  if (!employee) {
    throw new UserServiceError(
      "The linked employee record could not be found.",
      "EMPLOYEE_NOT_FOUND"
    );
  }

  // generateDefaultPassword validates names and throws UserServiceError-compatible
  // errors if they are missing or too short.
  const defaultPassword = generateDefaultPassword(employee.firstName, employee.lastName);
  const passwordHash = await hashPassword(defaultPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: targetUserId },
      data: { passwordHash, mustChangePassword: true },
    });

    await tx.auditLog.create({
      data: {
        userId: initiatorUserId,
        action: "RESET_PASSWORD",
        entityType: "user",
        entityId: targetUserId,
        newValues: { mustChangePassword: true },
      },
    });
  });

  return { defaultPassword };
}

// ---------------------------------------------------------------------------
// List / search users
// ---------------------------------------------------------------------------

export interface ListUsersInput {
  search?: string;
  isActive?: boolean;
  page: number;
  pageSize: number;
}

export interface UserListItem {
  id: string;
  username: string;
  email: string;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  employee: { firstName: string; lastName: string } | null;
  roles: string[];
}

export interface ListUsersResult {
  users: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listUsers(input: ListUsersInput): Promise<ListUsersResult> {
  const { search, isActive, page, pageSize } = input;

  const where: NonNullable<Parameters<typeof prisma.user.findMany>[0]>["where"] = {};

  if (isActive !== undefined) {
    where.isActive = isActive;
  }

  if (search) {
    const term = search.trim();
    where.OR = [
      { username: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
      {
        employee: {
          OR: [
            { firstName: { contains: term, mode: "insensitive" } },
            { lastName: { contains: term, mode: "insensitive" } },
          ],
        },
      },
    ];
  }

  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        username: true,
        email: true,
        isActive: true,
        mustChangePassword: true,
        createdAt: true,
        lastLoginAt: true,
        employee: { select: { firstName: true, lastName: true } },
        roles: { select: { role: { select: { name: true } } } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      isActive: u.isActive,
      mustChangePassword: u.mustChangePassword,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      employee: u.employee,
      roles: u.roles.map((r) => r.role.name),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ---------------------------------------------------------------------------
// Get single user
// ---------------------------------------------------------------------------

export interface UserDetail {
  id: string;
  username: string;
  email: string;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  employee: { firstName: string; lastName: string; email: string; jobTitle: string | null } | null;
  roles: string[];
  auditHistory: Array<{
    action: string;
    initiatorId: string | null;
    createdAt: Date;
    newValues: unknown;
  }>;
}

export async function getUserById(targetUserId: string): Promise<UserDetail> {
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      username: true,
      email: true,
      isActive: true,
      mustChangePassword: true,
      createdAt: true,
      lastLoginAt: true,
      employee: {
        select: { firstName: true, lastName: true, email: true, jobTitle: true },
      },
      roles: { select: { role: { select: { name: true } } } },
    },
  });

  if (!user) {
    throw new UserServiceError("User not found.", "USER_NOT_FOUND");
  }

  const auditHistory = await prisma.auditLog.findMany({
    where: { entityType: "user", entityId: targetUserId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { action: true, userId: true, createdAt: true, newValues: true },
  });

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    employee: user.employee,
    roles: user.roles.map((r) => r.role.name),
    auditHistory: auditHistory.map((a) => ({
      action: a.action,
      initiatorId: a.userId,
      createdAt: a.createdAt,
      newValues: a.newValues,
    })),
  };
}

// ---------------------------------------------------------------------------
// Activate user
// ---------------------------------------------------------------------------

export async function activateUser(
  targetUserId: string,
  initiatorUserId: string
): Promise<{ alreadyActive: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, isActive: true },
  });

  if (!user) {
    throw new UserServiceError("User not found.", "USER_NOT_FOUND");
  }

  if (user.isActive) {
    return { alreadyActive: true };
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: targetUserId },
      data: { isActive: true },
    });

    await tx.auditLog.create({
      data: {
        userId: initiatorUserId,
        action: "ACTIVATE_USER",
        entityType: "user",
        entityId: targetUserId,
        newValues: { isActive: true },
      },
    });
  });

  return { alreadyActive: false };
}

// ---------------------------------------------------------------------------
// Deactivate user
// ---------------------------------------------------------------------------

export async function deactivateUser(
  targetUserId: string,
  initiatorUserId: string
): Promise<{ alreadyInactive: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      isActive: true,
      roles: { select: { role: { select: { name: true } } } },
    },
  });

  if (!user) {
    throw new UserServiceError("User not found.", "USER_NOT_FOUND");
  }

  // Already-inactive: revoke any outstanding sessions (idempotent safety net
  // for retry after a prior partial failure) but do NOT create a duplicate
  // audit entry. Session revocation is still inside a transaction so a
  // revocation failure does not silently succeed.
  if (!user.isActive) {
    await prisma.$transaction(async (tx) => {
      await revokeAllSessionsTx(targetUserId, tx);
    });
    return { alreadyInactive: true };
  }

  const isAdmin = user.roles.some((r) => r.role.name === "ADMIN");

  if (isAdmin) {
    // Concurrency-safe check: use Serializable isolation so two concurrent
    // deactivations of the last two admins cannot both succeed.
    // No schema migration required — this is a transaction isolation strategy.
    await prisma.$transaction(
      async (tx) => {
        const activeAdminCount = await tx.user.count({
          where: {
            isActive: true,
            roles: { some: { role: { name: "ADMIN" } } },
          },
        });

        if (activeAdminCount <= 1) {
          throw new UserServiceError(
            "Cannot deactivate the last active administrator account.",
            "LAST_ADMIN"
          );
        }

        await tx.user.update({
          where: { id: targetUserId },
          data: { isActive: false },
        });

        await tx.auditLog.create({
          data: {
            userId: initiatorUserId,
            action: "DEACTIVATE_USER",
            entityType: "user",
            entityId: targetUserId,
            newValues: { isActive: false },
          },
        });

        await revokeAllSessionsTx(targetUserId, tx);
      },
      { isolationLevel: "Serializable" }
    );
  } else {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetUserId },
        data: { isActive: false },
      });

      await tx.auditLog.create({
        data: {
          userId: initiatorUserId,
          action: "DEACTIVATE_USER",
          entityType: "user",
          entityId: targetUserId,
          newValues: { isActive: false },
        },
      });

      await revokeAllSessionsTx(targetUserId, tx);
    });
  }

  return { alreadyInactive: false };
}
