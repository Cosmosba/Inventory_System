import prisma from "../config/database.js";
import { hashPassword } from "./passwordService.js";

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
