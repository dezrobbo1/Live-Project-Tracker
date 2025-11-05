import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Serve static files (the front-end)
app.use(express.static(path.join(__dirname, "public")));

// Health check route (optional)
app.get("/healthz", (_, res) => res.send("ok"));

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Live Project Tracker running on port ${PORT}`);
});
