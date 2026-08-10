import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { loadoutsRouter } from "./routes/loadouts.js";
import { loadoutListsRouter } from "./routes/loadoutLists.js";
import { hunterFavoritesRouter } from "./routes/hunterFavorites.js";
import { db } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4100;

const app = express();

// Trust one reverse-proxy hop so express-rate-limit's IP keying works (and
// doesn't throw ER_ERL_UNEXPECTED_X_FORWARDED_FOR) behind nginx/Render/Fly.
app.set("trust proxy", 1);

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

// Explicit body-size cap (SPEC-0003 Security Requirements). express.json() defaults to
// 100kb implicitly; stating it means the limit is a decision on the record rather than a
// framework default that could shift under an upgrade. Loadout and list payloads are
// small — this is generous.
app.use(express.json({ limit: "64kb" }));

app.use("/api/loadouts", loadoutsRouter);
app.use("/api/loadout-lists", loadoutListsRouter);
// Governing: SPEC-0003 REQ "Favorite Hunters". Token-scoped like everything above it; the
// 64kb body cap already declared covers it, and both writes address the hunter in the path
// rather than the body, so neither carries one worth capping separately.
app.use("/api/hunter-favorites", hunterFavoritesRouter);

// Lightweight liveness endpoint for orchestrators/load balancers (issue #31).
app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

if (process.env.NODE_ENV === "production") {
  const clientDist = path.join(__dirname, "..", "..", "client", "dist");
  app.use(express.static(clientDist));
  // SPA fallback for deep links/refreshes. Registered as a plain middleware, not a
  // route pattern, so it behaves identically on Express 4 (where `/{*splat}`
  // wildcards were parsed as literals and matched nothing) and Express 5 (where
  // Express 4's bare `*` throws at startup). /healthz is registered above, so a
  // liveness probe is never shadowed by this fallback.
  app.use((_req, res) => {
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
