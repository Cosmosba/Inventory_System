import type { Request, Response } from "express";
import { z } from "zod";
import {
  listVendors,
  getVendorById,
  createVendor,
  updateVendor,
  activateVendor,
  deactivateVendor,
  VendorServiceError,
} from "../services/vendorService.js";

const listQuerySchema = z.object({
  search: z.string().max(200).optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const idParamSchema = z.object({
  vendorId: z.string().uuid("vendorId must be a valid UUID"),
});

const createSchema = z.object({
  name: z.string().min(1, "name is required").max(200),
  contactName: z.string().max(150).optional(),
  email: z.string().email().max(255).optional(),
  phone: z.string().max(30).optional(),
  address: z.string().max(1000).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  contactName: z.string().max(150).nullable().optional(),
  email: z.string().email().max(255).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
});

function isPrismaUniqueError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002";
}

function handleNotFound(err: unknown, res: Response): boolean {
  if (err instanceof VendorServiceError && err.code === "VENDOR_NOT_FOUND") {
    res.status(404).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

export async function listVendorsHandler(req: Request, res: Response): Promise<void> {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  const result = await listVendors(parsed.data);
  res.status(200).json({ success: true, data: result });
}

export async function getVendorByIdHandler(req: Request, res: Response): Promise<void> {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const vendor = await getVendorById(parsed.data.vendorId);
    res.status(200).json({ success: true, data: { vendor } });
  } catch (err) {
    if (handleNotFound(err, res)) return;
    throw err;
  }
}

export async function createVendorHandler(req: Request, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const vendor = await createVendor(parsed.data, req.user!.id);
    res.status(201).json({ success: true, message: "Vendor created successfully.", data: { vendor } });
  } catch (err) {
    if (isPrismaUniqueError(err)) {
      res.status(409).json({ success: false, message: "A vendor with this information already exists." });
      return;
    }
    throw err;
  }
}

export async function updateVendorHandler(req: Request, res: Response): Promise<void> {
  const paramsParsed = idParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: paramsParsed.error.flatten().fieldErrors });
    return;
  }
  const bodyParsed = updateSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: bodyParsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const vendor = await updateVendor(paramsParsed.data.vendorId, bodyParsed.data, req.user!.id);
    res.status(200).json({ success: true, message: "Vendor updated successfully.", data: { vendor } });
  } catch (err) {
    if (handleNotFound(err, res)) return;
    if (isPrismaUniqueError(err)) {
      res.status(409).json({ success: false, message: "A vendor with this information already exists." });
      return;
    }
    throw err;
  }
}

export async function deactivateVendorHandler(req: Request, res: Response): Promise<void> {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const { alreadyInactive } = await deactivateVendor(parsed.data.vendorId, req.user!.id);
    res.status(200).json({
      success: true,
      message: alreadyInactive ? "Vendor is already inactive." : "Vendor deactivated successfully.",
    });
  } catch (err) {
    if (handleNotFound(err, res)) return;
    throw err;
  }
}

export async function activateVendorHandler(req: Request, res: Response): Promise<void> {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const { alreadyActive } = await activateVendor(parsed.data.vendorId, req.user!.id);
    res.status(200).json({
      success: true,
      message: alreadyActive ? "Vendor is already active." : "Vendor activated successfully.",
    });
  } catch (err) {
    if (handleNotFound(err, res)) return;
    throw err;
  }
}
