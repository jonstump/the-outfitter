import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { loadoutsRouter } from "./routes/loadouts.js";
import { db } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4100;
const isProd = process.env.NODE_ENV === "production";

const app = express();

// The app is designed as a single origin serving both the API and the built
// client (see README), so same-origin requests never need CORS. In dev, Vite's
// proxy forwards /api to this server with a browser-like Origin header; allowing
// only localhost dev origins keeps a third-party site from scripting the API on
// a visitor's behalf (issue #30). Set CORS_ORIGIN to open it up deliberately.
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (process.env.NODE_ENV !== "production") {
  allowedOrigins.push("http://127.0.0.1:5173", "http://localhost:5173");
}
app.use(
  cors({
    origin: (origin, callback) => {
      // No Origin header (curl, same-origin fetch, same-server static) is always fine.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("CORS origin not allowed"));
    },
  })
);

app.use(express.json());

app.use("/api/loadouts", loadoutsRouter);

// Lightweight liveness/readiness endpoint for orchestrators/load balancers (issue #31).
app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

if (isProd) {
  const clientDist = path.join(__dirname, "..", "..", "client", "dist");
  app.use(express.static(clientDist));
  // SPA fallback. Named wildcard instead of Express 4's bare "*" so an Express 5
  // upgrade (path-to-regexp v6+) doesn't throw at route-registration time (issue #32).
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// Final error handler (issue #18): async route failures and CORS rejections land
// here as a clean 500/403 instead of an unhandled rejection crashing the process.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err && err.message === "CORS origin not allowed") {
    return res.status(403).json({ error: "origin not allowed" });
  }
  console.error("Unhandled server error:", err);
  res.status(500).json({ error: "internal server error" });
});

app.listen(PORT, () => {
  console.log(`The Outfitter server listening on http://localhost:${PORT}`);
});
