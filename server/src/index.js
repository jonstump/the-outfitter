import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { loadoutsRouter } from "./routes/loadouts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4100;

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/loadouts", loadoutsRouter);

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

app.listen(PORT, () => {
  console.log(`The Outfitter server listening on http://localhost:${PORT}`);
});
