import express, { Request, Response, NextFunction } from "express";
import healthRouter from "./routes/health.js";

const app = express();

app.use(express.json());

app.use("/api", healthRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: "Internal server error" });
});

export default app;
