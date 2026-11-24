import "dotenv/config";
import http from "http";
import app from "./app.js";
import prisma from "./config/database.js";

const PORT = process.env.PORT ?? "5000";
const HOST = process.env.HOST ?? "127.0.0.1";

async function start(): Promise<void> {
  await prisma.$connect();

  const server = http.createServer(app);

  server.listen(Number(PORT), HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
  });

  server.on("error", (err: Error) => {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  });

  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`${signal} received — shutting down gracefully`);

    server.close(async (err?: Error) => {
      if (err) {
        console.error("Error closing HTTP server:", err.message);
      }

      try {
        await prisma.$disconnect();
        console.log("Database disconnected");
      } catch (disconnectErr) {
        console.error("Error disconnecting database:", (disconnectErr as Error).message);
      }

      process.exit(err ? 1 : 0);
    });
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((err: Error) => {
  console.error("Failed to start:", err.message);
  process.exit(1);
});
