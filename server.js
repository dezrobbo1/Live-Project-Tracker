// server.js
const express = require("express");
const path = require("path");
const app = express();

const PUBLIC_DIR = path.join(__dirname, "public");

// Stop aggressive caching for app assets while we're iterating
app.disable("etag");
app.use((req, res, next) => {
  if (/\.(js|css|html)$/.test(req.url)) {
    res.set("Cache-Control", "no-store");
  } else {
    res.set("Cache-Control", "public, max-age=300");
  }
  next();
});

// Serve /public as the web root
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

// Fallback: serve index.html for unknown paths (helps with simple navigation)
app.get("*", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Live Project Tracker running on :${port}`));
