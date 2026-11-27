import type { Request, Response } from "express";
import { z } from "zod";
import {
  assignAsset,
  returnAsset,
  listAssignments,
  getAssignmentById,
  listAssetAssignments,
  AssignmentServiceError,
  isOpenAssignmentConflict,
} from "../services/assignmentService.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ASSET_CONDITIONS = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const assignmentIdParamSchema = z.object({
  assignmentId: z.string().uuid("assignmentId must be a valid UUID"),
});

const assetIdParamSchema = z.object({
  assetId: z.string().uuid("assetId must be a valid UUID"),
});

const assignSchema = z.object({
  assetId: z.string().uuid("assetId must be a valid UUID"),
  employeeId: z.string().uuid("employeeId must be a valid UUID"),
  locationId: z.string().uuid().optional(),
  expectedReturnDate: z.string().regex(ISO_DATE, "expectedReturnDate must be YYYY-MM-DD").optional(),
  notes: z.string().max(2000).optional(),
});

const returnSchema = z.object({
  returnCondition: z.enum(ASSET_CONDITIONS),
  returnNotes: z.string().max(2000).optional(),
});

const listQuerySchema = z.object({
  assetId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  open: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  dateFrom: z.string().regex(ISO_DATE, "dateFrom must be YYYY-MM-DD").optional(),
  dateTo: z.string().regex(ISO_DATE, "dateTo must be YYYY-MM-DD").optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

function handleAssignmentServiceError(err: unknown, res: Response): boolean {
  if (!(err instanceof AssignmentServiceError)) return false;
  switch (err.code) {
    case "ASSIGNMENT_NOT_FOUND":
    case "ASSET_NOT_FOUND":
    case "EMPLOYEE_NOT_FOUND":
    case "LOCATION_NOT_FOUND":
      res.status(404).json({ success: false, message: err.message });
      return true;
    case "EMPLOYEE_NOT_ACTIVE":
      res.status(422).json({ success: false, message: err.message });
      return true;
    case "ASSET_ALREADY_ASSIGNED":
    case "ASSET_UNDER_MAINTENANCE":
    case "ASSET_RETIRED":
    case "ASSET_DISPOSED":
    case "ASSET_NOT_AVAILABLE":
    case "ASSIGNMENT_ALREADY_RETURNED":
    case "ASSET_STATE_INCONSISTENT":
      res.status(409).json({ success: false, message: err.message });
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function assignAssetHandler(req: Request, res: Response): Promise<void> {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const assignment = await assignAsset(parsed.data, req.user!.id);
    res.status(201).json({ success: true, message: "Asset assigned successfully.", data: { assignment } });
  } catch (err) {
    if (handleAssignmentServiceError(err, res)) return;
    if (isOpenAssignmentConflict(err)) {
      res.status(409).json({ success: false, message: "Asset already has an open assignment." });
      return;
    }
    throw err;
  }
}

export async function returnAssetHandler(req: Request, res: Response): Promise<void> {
  const paramsParsed = assignmentIdParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: paramsParsed.error.flatten().fieldErrors });
    return;
  }
  const bodyParsed = returnSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: bodyParsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const assignment = await returnAsset(paramsParsed.data.assignmentId, bodyParsed.data, req.user!.id);
    res.status(200).json({ success: true, message: "Asset returned successfully.", data: { assignment } });
  } catch (err) {
    if (handleAssignmentServiceError(err, res)) return;
    throw err;
  }
}

export async function listAssignmentsHandler(req: Request, res: Response): Promise<void> {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  const result = await listAssignments(parsed.data);
  res.status(200).json({ success: true, data: result });
}

export async function getAssignmentByIdHandler(req: Request, res: Response): Promise<void> {
  const parsed = assignmentIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const assignment = await getAssignmentById(parsed.data.assignmentId);
    res.status(200).json({ success: true, data: { assignment } });
  } catch (err) {
    if (handleAssignmentServiceError(err, res)) return;
    throw err;
  }
}

export async function listAssetAssignmentsHandler(req: Request, res: Response): Promise<void> {
  const parsed = assetIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const assignments = await listAssetAssignments(parsed.data.assetId);
    res.status(200).json({ success: true, data: { assignments } });
  } catch (err) {
    if (handleAssignmentServiceError(err, res)) return;
    throw err;
  }
}
