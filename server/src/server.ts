import "dotenv/config";
import app from "./app.js";

const PORT = process.env.PORT ?? "5000";
const HOST = process.env.HOST ?? "127.0.0.1";

app.listen(Number(PORT), HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
}).on("error", (err: Error) => {
  console.error("Failed to start server:", err.message);
  process.exit(1);
});
