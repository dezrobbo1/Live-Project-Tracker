// server.js (ESM)
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

// __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");

// Keep iteration snappy: prevent stale cache for html/js/css
app.disable("etag");
app.use((req, res, next) => {
  if (/\.(js|css|html)$/.test(req.url)) {
    res.set("Cache-Control", "no-store");
  } else {
    res.set("Cache-Control", "public, max-age=300");
  }
  next();
});

// Serve static files from /public as the site root
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

// Fallback to index.html
app.get("*", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Live Project Tracker running on :${port}`));
