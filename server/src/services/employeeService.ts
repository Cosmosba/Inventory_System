import prisma from "../config/database.js";
import { writeAuditTx } from "./auditService.js";
import { buildPaginationResult, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "../utils/pagination.js";
import type { PaginationResult } from "../utils/pagination.js";
import type { EmployeeStatus } from "../../generated/prisma/enums.js";

export class EmployeeServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "EmployeeServiceError";
  }
}

export interface EmployeeListItem {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  jobTitle: string | null;
  status: EmployeeStatus;
  departmentId: string | null;
  locationId: string | null;
  createdAt: Date;
  updatedAt: Date;
  department: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
}

export interface EmployeeDetail extends EmployeeListItem {
  departmentHistory: Array<{
    id: string;
    fromDepartmentId: string | null;
    toDepartmentId: string;
    effectiveDate: Date;
    reason: string | null;
    createdAt: Date;
    fromDepartment: { name: string } | null;
    toDepartment: { name: string };
  }>;
  user: { id: string; username: string; isActive: boolean } | null;
}

export interface ListEmployeesInput {
  search?: string;
  status?: EmployeeStatus;
  departmentId?: string;
  page?: number;
  pageSize?: number;
}

export async function listEmployees(
  input: ListEmployeesInput
): Promise<PaginationResult<EmployeeListItem>> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, input.pageSize ?? PAGE_SIZE_DEFAULT));

  const where: Record<string, unknown> = {};
  if (input.status) where.status = input.status;
  if (input.departmentId) where.departmentId = input.departmentId;
  if (input.search) {
    const term = input.search.trim();
    where.OR = [
      { firstName: { contains: term, mode: "insensitive" } },
      { lastName: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
      { employeeNumber: { contains: term, mode: "insensitive" } },
      { jobTitle: { contains: term, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await prisma.$transaction([
    prisma.employee.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        jobTitle: true,
        status: true,
        departmentId: true,
        locationId: true,
        createdAt: true,
        updatedAt: true,
        department: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
      },
    }),
    prisma.employee.count({ where }),
  ]);

  return buildPaginationResult(rows, total, page, pageSize);
}

export async function getEmployeeById(id: string): Promise<EmployeeDetail> {
  const emp = await prisma.employee.findUnique({
    where: { id },
    select: {
      id: true,
      employeeNumber: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      jobTitle: true,
      status: true,
      departmentId: true,
      locationId: true,
      createdAt: true,
      updatedAt: true,
      department: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      departmentHistory: {
        orderBy: { effectiveDate: "desc" },
        select: {
          id: true,
          fromDepartmentId: true,
          toDepartmentId: true,
          effectiveDate: true,
          reason: true,
          createdAt: true,
          fromDepartment: { select: { name: true } },
          toDepartment: { select: { name: true } },
        },
      },
      user: { select: { id: true, username: true, isActive: true } },
    },
  });

  if (!emp) throw new EmployeeServiceError("Employee not found.", "EMPLOYEE_NOT_FOUND");
  return emp;
}

export interface CreateEmployeeInput {
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  jobTitle?: string;
  departmentId?: string;
  locationId?: string;
}

export async function createEmployee(
  input: CreateEmployeeInput,
  initiatorUserId: string
): Promise<EmployeeDetail> {
  if (input.departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: input.departmentId } });
    if (!dept) throw new EmployeeServiceError("Department not found.", "DEPARTMENT_NOT_FOUND");
  }
  if (input.locationId) {
    const loc = await prisma.location.findUnique({ where: { id: input.locationId } });
    if (!loc) throw new EmployeeServiceError("Location not found.", "LOCATION_NOT_FOUND");
  }

  const emp = await prisma.$transaction(async (tx) => {
    const created = await tx.employee.create({
      data: {
        employeeNumber: input.employeeNumber.trim(),
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        email: input.email.trim().toLowerCase(),
        phone: input.phone?.trim() ?? null,
        jobTitle: input.jobTitle?.trim() ?? null,
        departmentId: input.departmentId ?? null,
        locationId: input.locationId ?? null,
        status: "ACTIVE",
      },
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        jobTitle: true,
        status: true,
        departmentId: true,
        locationId: true,
        createdAt: true,
        updatedAt: true,
        department: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        departmentHistory: {
          orderBy: { effectiveDate: "desc" },
          select: {
            id: true,
            fromDepartmentId: true,
            toDepartmentId: true,
            effectiveDate: true,
            reason: true,
            createdAt: true,
            fromDepartment: { select: { name: true } },
            toDepartment: { select: { name: true } },
          },
        },
        user: { select: { id: true, username: true, isActive: true } },
      },
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "CREATE_EMPLOYEE",
        entityType: "employee",
        entityId: created.id,
        newValues: {
          employeeNumber: created.employeeNumber,
          firstName: created.firstName,
          lastName: created.lastName,
          email: created.email,
        },
      },
      tx
    );

    return created;
  });

  return emp;
}

export interface UpdateEmployeeInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
  jobTitle?: string | null;
  locationId?: string | null;
}

export async function updateEmployee(
  id: string,
  input: UpdateEmployeeInput,
  initiatorUserId: string
): Promise<EmployeeDetail> {
  const existing = await prisma.employee.findUnique({ where: { id } });
  if (!existing) throw new EmployeeServiceError("Employee not found.", "EMPLOYEE_NOT_FOUND");

  if (input.locationId) {
    const loc = await prisma.location.findUnique({ where: { id: input.locationId } });
    if (!loc) throw new EmployeeServiceError("Location not found.", "LOCATION_NOT_FOUND");
  }

  const data: Record<string, unknown> = {};
  if (input.firstName !== undefined) data.firstName = input.firstName.trim();
  if (input.lastName !== undefined) data.lastName = input.lastName.trim();
  if (input.email !== undefined) data.email = input.email.trim().toLowerCase();
  if ("phone" in input) data.phone = input.phone?.trim() ?? null;
  if ("jobTitle" in input) data.jobTitle = input.jobTitle?.trim() ?? null;
  if ("locationId" in input) data.locationId = input.locationId ?? null;

  const emp = await prisma.$transaction(async (tx) => {
    const updated = await tx.employee.update({
      where: { id },
      data,
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        jobTitle: true,
        status: true,
        departmentId: true,
        locationId: true,
        createdAt: true,
        updatedAt: true,
        department: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        departmentHistory: {
          orderBy: { effectiveDate: "desc" },
          select: {
            id: true,
            fromDepartmentId: true,
            toDepartmentId: true,
            effectiveDate: true,
            reason: true,
            createdAt: true,
            fromDepartment: { select: { name: true } },
            toDepartment: { select: { name: true } },
          },
        },
        user: { select: { id: true, username: true, isActive: true } },
      },
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "UPDATE_EMPLOYEE",
        entityType: "employee",
        entityId: id,
        oldValues: { firstName: existing.firstName, lastName: existing.lastName, email: existing.email },
        newValues: data as Record<string, unknown>,
      },
      tx
    );

    return updated;
  });

  return emp;
}

export interface ChangeEmployeeStatusInput {
  status: EmployeeStatus;
  reason?: string;
}

export async function changeEmployeeStatus(
  id: string,
  input: ChangeEmployeeStatusInput,
  initiatorUserId: string
): Promise<EmployeeDetail> {
  const existing = await prisma.employee.findUnique({ where: { id } });
  if (!existing) throw new EmployeeServiceError("Employee not found.", "EMPLOYEE_NOT_FOUND");

  if (existing.status === input.status) {
    throw new EmployeeServiceError(
      `Employee status is already ${input.status}.`,
      "STATUS_UNCHANGED"
    );
  }

  const emp = await prisma.$transaction(async (tx) => {
    const updated = await tx.employee.update({
      where: { id },
      data: { status: input.status },
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        jobTitle: true,
        status: true,
        departmentId: true,
        locationId: true,
        createdAt: true,
        updatedAt: true,
        department: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        departmentHistory: {
          orderBy: { effectiveDate: "desc" },
          select: {
            id: true,
            fromDepartmentId: true,
            toDepartmentId: true,
            effectiveDate: true,
            reason: true,
            createdAt: true,
            fromDepartment: { select: { name: true } },
            toDepartment: { select: { name: true } },
          },
        },
        user: { select: { id: true, username: true, isActive: true } },
      },
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "CHANGE_EMPLOYEE_STATUS",
        entityType: "employee",
        entityId: id,
        oldValues: { status: existing.status },
        newValues: { status: input.status, reason: input.reason },
      },
      tx
    );

    return updated;
  });

  return emp;
}

export interface TransferEmployeeInput {
  toDepartmentId: string;
  effectiveDate: string; // ISO date string YYYY-MM-DD
  reason?: string;
}

export async function transferEmployee(
  id: string,
  input: TransferEmployeeInput,
  initiatorUserId: string
): Promise<EmployeeDetail> {
  const existing = await prisma.employee.findUnique({ where: { id } });
  if (!existing) throw new EmployeeServiceError("Employee not found.", "EMPLOYEE_NOT_FOUND");

  const toDept = await prisma.department.findUnique({ where: { id: input.toDepartmentId } });
  if (!toDept) throw new EmployeeServiceError("Target department not found.", "DEPARTMENT_NOT_FOUND");

  if (existing.departmentId === input.toDepartmentId) {
    throw new EmployeeServiceError(
      "Employee is already in the target department.",
      "SAME_DEPARTMENT"
    );
  }

  const effectiveDate = new Date(input.effectiveDate);
  if (isNaN(effectiveDate.getTime())) {
    throw new EmployeeServiceError("Invalid effective date.", "INVALID_DATE");
  }

  const emp = await prisma.$transaction(async (tx) => {
    // Update employee's current department
    const updated = await tx.employee.update({
      where: { id },
      data: { departmentId: input.toDepartmentId },
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        jobTitle: true,
        status: true,
        departmentId: true,
        locationId: true,
        createdAt: true,
        updatedAt: true,
        department: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        departmentHistory: {
          orderBy: { effectiveDate: "desc" },
          select: {
            id: true,
            fromDepartmentId: true,
            toDepartmentId: true,
            effectiveDate: true,
            reason: true,
            createdAt: true,
            fromDepartment: { select: { name: true } },
            toDepartment: { select: { name: true } },
          },
        },
        user: { select: { id: true, username: true, isActive: true } },
      },
    });

    // Create history record
    await tx.employeeDepartmentHistory.create({
      data: {
        employeeId: id,
        fromDepartmentId: existing.departmentId,
        toDepartmentId: input.toDepartmentId,
        effectiveDate,
        reason: input.reason?.trim() ?? null,
        recordedByUserId: initiatorUserId,
      },
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "TRANSFER_EMPLOYEE",
        entityType: "employee",
        entityId: id,
        oldValues: { departmentId: existing.departmentId },
        newValues: {
          departmentId: input.toDepartmentId,
          effectiveDate: input.effectiveDate,
          reason: input.reason,
        },
      },
      tx
    );

    return updated;
  });

  return emp;
}
