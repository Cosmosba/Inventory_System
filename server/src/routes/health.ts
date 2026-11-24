import { Router, Request, Response } from "express";
import prisma from "../config/database.js";

const router = Router();

router.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "Inventory Management System API is running",
    timestamp: new Date().toISOString(),
  });
});

router.get("/health/ready", async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      success: true,
      message: "Database connection is ready",
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      success: false,
      message: "Database unavailable",
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
