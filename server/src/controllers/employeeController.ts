import type { Request, Response } from "express";
import { z } from "zod";
import {
  listEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  changeEmployeeStatus,
  transferEmployee,
  EmployeeServiceError,
} from "../services/employeeService.js";

const EMPLOYEE_STATUSES = ["ACTIVE", "INACTIVE", "TRANSFERRED", "TERMINATED"] as const;

const listQuerySchema = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  departmentId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const idParamSchema = z.object({
  employeeId: z.string().uuid("employeeId must be a valid UUID"),
});

const createSchema = z.object({
  employeeNumber: z.string().min(1, "employeeNumber is required").max(50),
  firstName: z.string().min(1, "firstName is required").max(100),
  lastName: z.string().min(1, "lastName is required").max(100),
  email: z.string().email().max(255),
  phone: z.string().max(30).optional(),
  jobTitle: z.string().max(150).optional(),
  departmentId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
});

const updateSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().max(255).optional(),
  phone: z.string().max(30).nullable().optional(),
  jobTitle: z.string().max(150).nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
});

const changeStatusSchema = z.object({
  status: z.enum(EMPLOYEE_STATUSES),
  reason: z.string().max(500).optional(),
});

const transferSchema = z.object({
  toDepartmentId: z.string().uuid("toDepartmentId must be a valid UUID"),
  effectiveDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveDate must be YYYY-MM-DD"),
  reason: z.string().max(500).optional(),
});

function isPrismaUniqueError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002";
}

function handleNotFound(err: unknown, res: Response): boolean {
  if (err instanceof EmployeeServiceError && err.code === "EMPLOYEE_NOT_FOUND") {
    res.status(404).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

export async function listEmployeesHandler(req: Request, res: Response): Promise<void> {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  const result = await listEmployees(parsed.data);
  res.status(200).json({ success: true, data: result });
}

export async function getEmployeeByIdHandler(req: Request, res: Response): Promise<void> {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const emp = await getEmployeeById(parsed.data.employeeId);
    res.status(200).json({ success: true, data: { employee: emp } });
  } catch (err) {
    if (handleNotFound(err, res)) return;
    throw err;
  }
}

export async function createEmployeeHandler(req: Request, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const emp = await createEmployee(parsed.data, req.user!.id);
    res.status(201).json({ success: true, message: "Employee created successfully.", data: { employee: emp } });
  } catch (err) {
    if (err instanceof EmployeeServiceError) {
      if (err.code === "DEPARTMENT_NOT_FOUND" || err.code === "LOCATION_NOT_FOUND") {
        res.status(404).json({ success: false, message: err.message });
        return;
      }
    }
    if (isPrismaUniqueError(err)) {
      res.status(409).json({ success: false, message: "An employee with this employee number or email already exists." });
      return;
    }
    throw err;
  }
}

export async function updateEmployeeHandler(req: Request, res: Response): Promise<void> {
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
    const emp = await updateEmployee(paramsParsed.data.employeeId, bodyParsed.data, req.user!.id);
    res.status(200).json({ success: true, message: "Employee updated successfully.", data: { employee: emp } });
  } catch (err) {
    if (handleNotFound(err, res)) return;
    if (err instanceof EmployeeServiceError && err.code === "LOCATION_NOT_FOUND") {
      res.status(404).json({ success: false, message: err.message });
      return;
    }
    if (isPrismaUniqueError(err)) {
      res.status(409).json({ success: false, message: "An employee with this email already exists." });
      return;
    }
    throw err;
  }
}

export async function changeEmployeeStatusHandler(req: Request, res: Response): Promise<void> {
  const paramsParsed = idParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: paramsParsed.error.flatten().fieldErrors });
    return;
  }
  const bodyParsed = changeStatusSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: bodyParsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const emp = await changeEmployeeStatus(paramsParsed.data.employeeId, bodyParsed.data, req.user!.id);
    res.status(200).json({ success: true, message: "Employee status updated.", data: { employee: emp } });
  } catch (err) {
    if (handleNotFound(err, res)) return;
    if (err instanceof EmployeeServiceError && err.code === "STATUS_UNCHANGED") {
      res.status(409).json({ success: false, message: err.message });
      return;
    }
    throw err;
  }
}

export async function transferEmployeeHandler(req: Request, res: Response): Promise<void> {
  const paramsParsed = idParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: paramsParsed.error.flatten().fieldErrors });
    return;
  }
  const bodyParsed = transferSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ success: false, message: "Validation failed", errors: bodyParsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const emp = await transferEmployee(paramsParsed.data.employeeId, bodyParsed.data, req.user!.id);
    res.status(200).json({ success: true, message: "Employee transferred successfully.", data: { employee: emp } });
  } catch (err) {
    if (handleNotFound(err, res)) return;
    if (err instanceof EmployeeServiceError) {
      if (err.code === "DEPARTMENT_NOT_FOUND") {
        res.status(404).json({ success: false, message: err.message });
        return;
      }
      if (err.code === "SAME_DEPARTMENT") {
        res.status(409).json({ success: false, message: err.message });
        return;
      }
      if (err.code === "INVALID_DATE") {
        res.status(400).json({ success: false, message: err.message });
        return;
      }
    }
    throw err;
  }
}
