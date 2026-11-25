import type { Request, Response } from "express";
import { z } from "zod";
import {
  listDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  DepartmentServiceError,
} from "../services/departmentService.js";

const listQuerySchema = z.object({
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const idParamSchema = z.object({
  departmentId: z.string().uuid("departmentId must be a valid UUID"),
});

const createSchema = z.object({
  name: z.string().min(1, "name is required").max(150),
  code: z
    .string()
    .min(1, "code is required")
    .max(20)
    .regex(/^[A-Z0-9_-]+$/i, "code may only contain letters, digits, _ and -"),
  managerEmployeeId: z.string().uuid().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  code: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Z0-9_-]+$/i)
    .optional(),
  managerEmployeeId: z.string().uuid().nullable().optional(),
});

export async function listDepartmentsHandler(req: Request, res: Response): Promise<void> {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  const result = await listDepartments(parsed.data);
  res.status(200).json({ success: true, data: result });
}

export async function getDepartmentByIdHandler(req: Request, res: Response): Promise<void> {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const dept = await getDepartmentById(parsed.data.departmentId);
    res.status(200).json({ success: true, data: { department: dept } });
  } catch (err) {
    if (err instanceof DepartmentServiceError && err.code === "DEPARTMENT_NOT_FOUND") {
      res.status(404).json({ success: false, message: err.message });
      return;
    }
    throw err;
  }
}

export async function createDepartmentHandler(req: Request, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const dept = await createDepartment(parsed.data, req.user!.id);
    res.status(201).json({ success: true, message: "Department created successfully.", data: { department: dept } });
  } catch (err) {
    if (err instanceof DepartmentServiceError) {
      if (err.code === "EMPLOYEE_NOT_FOUND") {
        res.status(404).json({ success: false, message: err.message });
        return;
      }
    }
    if (isPrismaUniqueError(err)) {
      res.status(409).json({ success: false, message: "A department with this name or code already exists." });
      return;
    }
    throw err;
  }
}

export async function updateDepartmentHandler(req: Request, res: Response): Promise<void> {
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
    const dept = await updateDepartment(paramsParsed.data.departmentId, bodyParsed.data, req.user!.id);
    res.status(200).json({ success: true, message: "Department updated successfully.", data: { department: dept } });
  } catch (err) {
    if (err instanceof DepartmentServiceError) {
      if (err.code === "DEPARTMENT_NOT_FOUND") {
        res.status(404).json({ success: false, message: err.message });
        return;
      }
      if (err.code === "EMPLOYEE_NOT_FOUND") {
        res.status(404).json({ success: false, message: err.message });
        return;
      }
    }
    if (isPrismaUniqueError(err)) {
      res.status(409).json({ success: false, message: "A department with this name or code already exists." });
      return;
    }
    throw err;
  }
}

function isPrismaUniqueError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}
