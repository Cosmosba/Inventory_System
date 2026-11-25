import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./utils/env.js";
import { validateOrigin } from "./middleware/validateOrigin.js";
import healthRouter from "./routes/health.js";
import authRouter from "./routes/auth.js";
import usersRouter from "./routes/users.js";
import departmentsRouter from "./routes/departments.js";
import locationsRouter from "./routes/locations.js";
import assetCategoriesRouter from "./routes/assetCategories.js";
import vendorsRouter from "./routes/vendors.js";
import employeesRouter from "./routes/employees.js";
import assetsRouter from "./routes/assets.js";
import stockRouter from "./routes/stock.js";
import purchasesRouter from "./routes/purchases.js";

const app = express();

// ---------------------------------------------------------------------------
// CORS — credentialed requests require an explicit origin, never a wildcard.
// Set FRONTEND_ORIGIN in .env for development and production.
// ---------------------------------------------------------------------------
if (env.FRONTEND_ORIGIN) {
  app.use(
    cors({
      origin: env.FRONTEND_ORIGIN,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
    })
  );
}

app.use(express.json());
app.use(cookieParser());

// ---------------------------------------------------------------------------
// CSRF protection — centralized Origin validation for all state-changing
// requests (POST, PUT, PATCH, DELETE). Mounted before all route handlers so
// every current and future route is covered automatically.
// GET, HEAD and OPTIONS pass through unconditionally.
// ---------------------------------------------------------------------------
app.use(validateOrigin);

app.use("/api", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/departments", departmentsRouter);
app.use("/api/locations", locationsRouter);
app.use("/api/asset-categories", assetCategoriesRouter);
app.use("/api/vendors", vendorsRouter);
app.use("/api/employees", employeesRouter);
app.use("/api/assets", assetsRouter);
app.use("/api/stock", stockRouter);
app.use("/api/purchases", purchasesRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: "Internal server error" });
});

export default app;
