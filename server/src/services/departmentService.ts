import prisma from "../config/database.js";
import { writeAuditTx } from "./auditService.js";
import { buildPaginationResult, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "../utils/pagination.js";
import type { PaginationResult } from "../utils/pagination.js";

export class DepartmentServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "DepartmentServiceError";
  }
}

export interface DepartmentListItem {
  id: string;
  name: string;
  code: string;
  managerEmployeeId: string | null;
  createdAt: Date;
  updatedAt: Date;
  manager: { id: string; firstName: string; lastName: string } | null;
}

export interface DepartmentDetail extends DepartmentListItem {
  _count: { employees: number; locations: number };
}

export interface ListDepartmentsInput {
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function listDepartments(
  input: ListDepartmentsInput
): Promise<PaginationResult<DepartmentListItem>> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, input.pageSize ?? PAGE_SIZE_DEFAULT));

  const where = input.search
    ? {
        OR: [
          { name: { contains: input.search.trim(), mode: "insensitive" as const } },
          { code: { contains: input.search.trim(), mode: "insensitive" as const } },
        ],
      }
    : {};

  const [rows, total] = await prisma.$transaction([
    prisma.department.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        managerEmployeeId: true,
        createdAt: true,
        updatedAt: true,
        manager: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.department.count({ where }),
  ]);

  return buildPaginationResult(rows, total, page, pageSize);
}

export async function getDepartmentById(id: string): Promise<DepartmentDetail> {
  const dept = await prisma.department.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      code: true,
      managerEmployeeId: true,
      createdAt: true,
      updatedAt: true,
      manager: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { employees: true, locations: true } },
    },
  });

  if (!dept) throw new DepartmentServiceError("Department not found.", "DEPARTMENT_NOT_FOUND");
  return dept;
}

export interface CreateDepartmentInput {
  name: string;
  code: string;
  managerEmployeeId?: string;
}

export async function createDepartment(
  input: CreateDepartmentInput,
  initiatorUserId: string
): Promise<DepartmentDetail> {
  // Validate manager exists if provided
  if (input.managerEmployeeId) {
    const emp = await prisma.employee.findUnique({ where: { id: input.managerEmployeeId } });
    if (!emp) throw new DepartmentServiceError("Manager employee not found.", "EMPLOYEE_NOT_FOUND");
  }

  const dept = await prisma.$transaction(async (tx) => {
    const created = await tx.department.create({
      data: {
        name: input.name.trim(),
        code: input.code.trim().toUpperCase(),
        managerEmployeeId: input.managerEmployeeId ?? null,
      },
      select: {
        id: true,
        name: true,
        code: true,
        managerEmployeeId: true,
        createdAt: true,
        updatedAt: true,
        manager: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { employees: true, locations: true } },
      },
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "CREATE_DEPARTMENT",
        entityType: "department",
        entityId: created.id,
        newValues: { name: created.name, code: created.code },
      },
      tx
    );

    return created;
  });

  return dept;
}

export interface UpdateDepartmentInput {
  name?: string;
  code?: string;
  managerEmployeeId?: string | null;
}

export async function updateDepartment(
  id: string,
  input: UpdateDepartmentInput,
  initiatorUserId: string
): Promise<DepartmentDetail> {
  const existing = await prisma.department.findUnique({ where: { id } });
  if (!existing) throw new DepartmentServiceError("Department not found.", "DEPARTMENT_NOT_FOUND");

  if (input.managerEmployeeId) {
    const emp = await prisma.employee.findUnique({ where: { id: input.managerEmployeeId } });
    if (!emp) throw new DepartmentServiceError("Manager employee not found.", "EMPLOYEE_NOT_FOUND");
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.code !== undefined) data.code = input.code.trim().toUpperCase();
  if ("managerEmployeeId" in input) data.managerEmployeeId = input.managerEmployeeId ?? null;

  const dept = await prisma.$transaction(async (tx) => {
    const updated = await tx.department.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        code: true,
        managerEmployeeId: true,
        createdAt: true,
        updatedAt: true,
        manager: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { employees: true, locations: true } },
      },
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "UPDATE_DEPARTMENT",
        entityType: "department",
        entityId: id,
        oldValues: { name: existing.name, code: existing.code },
        newValues: data as Record<string, unknown>,
      },
      tx
    );

    return updated;
  });

  return dept;
}
