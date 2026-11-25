import prisma from "../config/database.js";
import { writeAuditTx } from "./auditService.js";
import { buildPaginationResult, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "../utils/pagination.js";
import type { PaginationResult } from "../utils/pagination.js";

export class VendorServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "VendorServiceError";
  }
}

export interface VendorListItem {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface VendorDetail extends VendorListItem {
  address: string | null;
  _count: { purchases: number };
}

export interface ListVendorsInput {
  search?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listVendors(
  input: ListVendorsInput
): Promise<PaginationResult<VendorListItem>> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, input.pageSize ?? PAGE_SIZE_DEFAULT));

  const where: Record<string, unknown> = {};
  if (input.isActive !== undefined) where.isActive = input.isActive;
  if (input.search) {
    const term = input.search.trim();
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { contactName: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await prisma.$transaction([
    prisma.vendor.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        contactName: true,
        email: true,
        phone: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.vendor.count({ where }),
  ]);

  return buildPaginationResult(rows, total, page, pageSize);
}

export async function getVendorById(id: string): Promise<VendorDetail> {
  const vendor = await prisma.vendor.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      contactName: true,
      email: true,
      phone: true,
      address: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { purchases: true } },
    },
  });

  if (!vendor) throw new VendorServiceError("Vendor not found.", "VENDOR_NOT_FOUND");
  return vendor;
}

export interface CreateVendorInput {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
}

export async function createVendor(
  input: CreateVendorInput,
  initiatorUserId: string
): Promise<VendorDetail> {
  const vendor = await prisma.$transaction(async (tx) => {
    const created = await tx.vendor.create({
      data: {
        name: input.name.trim(),
        contactName: input.contactName?.trim() ?? null,
        email: input.email?.trim().toLowerCase() ?? null,
        phone: input.phone?.trim() ?? null,
        address: input.address?.trim() ?? null,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        contactName: true,
        email: true,
        phone: true,
        address: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { purchases: true } },
      },
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "CREATE_VENDOR",
        entityType: "vendor",
        entityId: created.id,
        newValues: { name: created.name },
      },
      tx
    );

    return created;
  });

  return vendor;
}

export interface UpdateVendorInput {
  name?: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}

export async function updateVendor(
  id: string,
  input: UpdateVendorInput,
  initiatorUserId: string
): Promise<VendorDetail> {
  const existing = await prisma.vendor.findUnique({ where: { id } });
  if (!existing) throw new VendorServiceError("Vendor not found.", "VENDOR_NOT_FOUND");

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if ("contactName" in input) data.contactName = input.contactName?.trim() ?? null;
  if ("email" in input) data.email = input.email?.trim().toLowerCase() ?? null;
  if ("phone" in input) data.phone = input.phone?.trim() ?? null;
  if ("address" in input) data.address = input.address?.trim() ?? null;

  const vendor = await prisma.$transaction(async (tx) => {
    const updated = await tx.vendor.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        contactName: true,
        email: true,
        phone: true,
        address: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { purchases: true } },
      },
    });

    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "UPDATE_VENDOR",
        entityType: "vendor",
        entityId: id,
        oldValues: { name: existing.name },
        newValues: data as Record<string, unknown>,
      },
      tx
    );

    return updated;
  });

  return vendor;
}

export async function deactivateVendor(
  id: string,
  initiatorUserId: string
): Promise<{ alreadyInactive: boolean }> {
  const existing = await prisma.vendor.findUnique({ where: { id } });
  if (!existing) throw new VendorServiceError("Vendor not found.", "VENDOR_NOT_FOUND");

  if (!existing.isActive) return { alreadyInactive: true };

  await prisma.$transaction(async (tx) => {
    await tx.vendor.update({ where: { id }, data: { isActive: false } });
    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "DEACTIVATE_VENDOR",
        entityType: "vendor",
        entityId: id,
        newValues: { isActive: false },
      },
      tx
    );
  });

  return { alreadyInactive: false };
}

export async function activateVendor(
  id: string,
  initiatorUserId: string
): Promise<{ alreadyActive: boolean }> {
  const existing = await prisma.vendor.findUnique({ where: { id } });
  if (!existing) throw new VendorServiceError("Vendor not found.", "VENDOR_NOT_FOUND");

  if (existing.isActive) return { alreadyActive: true };

  await prisma.$transaction(async (tx) => {
    await tx.vendor.update({ where: { id }, data: { isActive: true } });
    await writeAuditTx(
      {
        userId: initiatorUserId,
        action: "ACTIVATE_VENDOR",
        entityType: "vendor",
        entityId: id,
        newValues: { isActive: true },
      },
      tx
    );
  });

  return { alreadyActive: false };
}
