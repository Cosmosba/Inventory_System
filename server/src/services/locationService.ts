import prisma from "../config/database.js";
import { writeAuditTx } from "./auditService.js";
import { buildPaginationResult, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "../utils/pagination.js";
import type { PaginationResult } from "../utils/pagination.js";

export class LocationServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "LocationServiceError";
  }
}

export interface LocationListItem {
  id: string;
  name: string;
  building: string | null;
  room: string | null;
  departmentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  department: { id: string; name: string } | null;
}

export interface LocationDetail extends LocationListItem {
  _count: { employees: number; assets: number };
}

export interface ListLocationsInput {
  search?: string;
  departmentId?: string;
  page?: number;
  pageSize?: number;
}

export async function listLocations(
  input: ListLocationsInput
): Promise<PaginationResult<LocationListItem>> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, input.pageSize ?? PAGE_SIZE_DEFAULT));

  const where: Record<string, unknown> = {};
  if (input.departmentId) where.departmentId = input.departmentId;
  if (input.search) {
    const term = input.search.trim();
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { building: { contains: term, mode: "insensitive" } },
      { room: { contains: term, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await prisma.$transaction([
    prisma.location.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        building: true,
        room: true,
        departmentId: true,
        createdAt: true,
        updatedAt: true,
        department: { select: { id: true, name: true } },
      },
    }),
    prisma.location.count({ where }),
  ]);

  return buildPaginationResult(rows, total, page, pageSize);
}

export async function getLocationById(id: string): Promise<LocationDetail> {
  const loc = await prisma.location.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      building: true,
      room: true,
      departmentId: true,
      createdAt: true,
      updatedAt: true,
      department: { select: { id: true, name: true } },
      _count: { select: { employees: true, assets: true } },
    },
  });

  if (!loc) throw new LocationServiceError("Location not found.", "LOCATION_NOT_FOUND");
  return loc;
}

export interface CreateLocationInput {
  name: string;
  building?: string;
  room?: string;
  departmentId?: string;
}

export async function createLocation(
  input: CreateLocationInput,
  initiatorUserId: string
): Promise<LocationDetail> {
  if (input.departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: input.departmentId } });
    if (!dept) throw new LocationServiceError("Department not found.", "DEPARTMENT_NOT_FOUND");
  }

  const loc = await prisma.$transaction(async (tx) => {
    const created = await tx.location.create({
      data: {
        name: input.name.trim(),
        building: input.building?.trim() ?? null,
        room: input.room?.trim() ?? null,
        departmentId: input.departmentId ?? null,
      },
      select: {
        id: true,
        name: true,
        building: true,
        room: true,
        departmentId: true,
        createdAt: true,
        updatedAt: true,
        department: { select: { id: true, name: true } },
        _count: { select: { employees: true, assets: true } },
      },
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "CREATE_LOCATION",
        entityType: "location",
        entityId: created.id,
        newValues: { name: created.name, building: created.building, room: created.room },
      },
      tx
    );

    return created;
  });

  return loc;
}

export interface UpdateLocationInput {
  name?: string;
  building?: string | null;
  room?: string | null;
  departmentId?: string | null;
}

export async function updateLocation(
  id: string,
  input: UpdateLocationInput,
  initiatorUserId: string
): Promise<LocationDetail> {
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) throw new LocationServiceError("Location not found.", "LOCATION_NOT_FOUND");

  if (input.departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: input.departmentId } });
    if (!dept) throw new LocationServiceError("Department not found.", "DEPARTMENT_NOT_FOUND");
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if ("building" in input) data.building = input.building?.trim() ?? null;
  if ("room" in input) data.room = input.room?.trim() ?? null;
  if ("departmentId" in input) data.departmentId = input.departmentId ?? null;

  const loc = await prisma.$transaction(async (tx) => {
    const updated = await tx.location.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        building: true,
        room: true,
        departmentId: true,
        createdAt: true,
        updatedAt: true,
        department: { select: { id: true, name: true } },
        _count: { select: { employees: true, assets: true } },
      },
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "UPDATE_LOCATION",
        entityType: "location",
        entityId: id,
        oldValues: { name: existing.name, building: existing.building, room: existing.room },
        newValues: data as Record<string, unknown>,
      },
      tx
    );

    return updated;
  });

  return loc;
}
