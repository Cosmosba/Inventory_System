import type { Request, Response } from "express";
import { z } from "zod";
import {
  listLocations,
  getLocationById,
  createLocation,
  updateLocation,
  LocationServiceError,
} from "../services/locationService.js";

const listQuerySchema = z.object({
  search: z.string().max(200).optional(),
  departmentId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const idParamSchema = z.object({
  locationId: z.string().uuid("locationId must be a valid UUID"),
});

const createSchema = z.object({
  name: z.string().min(1, "name is required").max(150),
  building: z.string().max(100).optional(),
  room: z.string().max(50).optional(),
  departmentId: z.string().uuid().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  building: z.string().max(100).nullable().optional(),
  room: z.string().max(50).nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
});

function isPrismaUniqueError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002";
}

export async function listLocationsHandler(req: Request, res: Response): Promise<void> {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  const result = await listLocations(parsed.data);
  res.status(200).json({ success: true, data: result });
}

export async function getLocationByIdHandler(req: Request, res: Response): Promise<void> {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const loc = await getLocationById(parsed.data.locationId);
    res.status(200).json({ success: true, data: { location: loc } });
  } catch (err) {
    if (err instanceof LocationServiceError && err.code === "LOCATION_NOT_FOUND") {
      res.status(404).json({ success: false, message: err.message });
      return;
    }
    throw err;
  }
}

export async function createLocationHandler(req: Request, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const loc = await createLocation(parsed.data, req.user!.id);
    res.status(201).json({ success: true, message: "Location created successfully.", data: { location: loc } });
  } catch (err) {
    if (err instanceof LocationServiceError && err.code === "DEPARTMENT_NOT_FOUND") {
      res.status(404).json({ success: false, message: err.message });
      return;
    }
    if (isPrismaUniqueError(err)) {
      res.status(409).json({ success: false, message: "A location with this name already exists." });
      return;
    }
    throw err;
  }
}

export async function updateLocationHandler(req: Request, res: Response): Promise<void> {
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
    const loc = await updateLocation(paramsParsed.data.locationId, bodyParsed.data, req.user!.id);
    res.status(200).json({ success: true, message: "Location updated successfully.", data: { location: loc } });
  } catch (err) {
    if (err instanceof LocationServiceError) {
      if (err.code === "LOCATION_NOT_FOUND" || err.code === "DEPARTMENT_NOT_FOUND") {
        res.status(404).json({ success: false, message: err.message });
        return;
      }
    }
    if (isPrismaUniqueError(err)) {
      res.status(409).json({ success: false, message: "A location with this name already exists." });
      return;
    }
    throw err;
  }
}
