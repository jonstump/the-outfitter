import { Router } from "express";
import { randomUUID } from "node:crypto";
import rateLimit from "express-rate-limit";
import { db } from "../db.js";

export const loadoutsRouter = Router();

// Per-user ownership boundary (issue #17): every loadout record is scoped to the
// client-issued token that created it. Requests that carry no token (e.g. curl)
// operate on an anonymous, single shared token so the app remains usable without
// frontend changes, while authenticated flows never see or touch each other's data.
const ANON = "anon";

function callerToken(req) {
  const token = req.get("x-loadout-token") || "";
  return typeof token === "string" && token.trim() ? token.trim().slice(0, 200) : ANON;
}

// Basic IP-based throttling on the write/delete endpoints — defense-in-depth
// independent of the ownership model (issue #21).
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

// Wire shape the client's toData()/fromData() (client/src/utils/loadoutCodec.js)
// produces: { v, w, e, tr, n, b }. `v` is the schema version; the rest are
// arrays/numbers/strings of bounded size. Reject anything that doesn't match so
// malformed or arbitrarily large payloads never reach the data file (issue #19).
function isValidData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  if (data.v !== undefined && typeof data.v !== "number") return false;
  if (!Array.isArray(data.w) || data.w.length !== 2) return false;
  if (!data.w.every((slot) => slot === null || (Array.isArray(slot) && slot.length >= 2 && typeof slot[0] === "string"))) return false;
  if (!Array.isArray(data.e) || data.e.length > 8) return false;
  if (!data.e.every((entry) => Array.isArray(entry) && entry.length >= 2 && (entry[0] === "T" || entry[0] === "C") && typeof entry[1] === "string")) return false;
  if (!Array.isArray(data.tr) || data.tr.length > 40) return false;
  if (!data.tr.every((id) => typeof id === "string")) return false;
  if (typeof data.n !== "string" || data.n.length > 200) return false;
  if (data.b !== undefined && (typeof data.b !== "number" || data.b < 0 || data.b > 8)) return false;
  return true;
}

// Express 4 does not forward rejected promises from async handlers to the error
// middleware, so every handler wraps its body in try/catch (issue #18) — a
// corrupt data file, disk-full, or permission error returns a clean 500 instead
// of crashing the process.
loadoutsRouter.get("/", async (_req, res) => {
  try {
    await db.read();
    const token = callerToken(_req);
    const mine = db.data.loadouts
      .filter((l) => l.owner === token)
      .map(({ owner, ...record }) => record);
    res.json(mine);
  } catch (err) {
    console.error("GET /api/loadouts failed:", err);
    res.status(500).json({ error: "failed to read loadouts" });
  }
});

loadoutsRouter.post("/", writeLimiter, async (req, res) => {
  try {
    const { name, data } = req.body || {};
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name must be a non-empty string" });
    }
    if (!isValidData(data)) {
      return res.status(400).json({ error: "data must be a valid loadout payload" });
    }

    const token = callerToken(req);
    await db.read();
    const trimmedName = name.trim();
    const now = new Date().toISOString();
    const existing = db.data.loadouts.find((l) => l.owner === token && l.name === trimmedName);

    let record;
    if (existing) {
      existing.data = data;
      existing.updatedAt = now;
      record = existing;
    } else {
      record = { id: randomUUID(), owner: token, name: trimmedName, data, updatedAt: now };
      db.data.loadouts.push(record);
    }

    await db.write();
    const { owner, ...publicRecord } = record;
    res.status(existing ? 200 : 201).json(publicRecord);
  } catch (err) {
    console.error("POST /api/loadouts failed:", err);
    res.status(500).json({ error: "failed to save loadout" });
  }
});

loadoutsRouter.delete("/:id", writeLimiter, async (req, res) => {
  try {
    const token = callerToken(req);
    await db.read();
    const before = db.data.loadouts.length;
    db.data.loadouts = db.data.loadouts.filter((l) => l.id !== req.params.id || l.owner !== token);
    if (db.data.loadouts.length === before) {
      return res.status(404).json({ error: "loadout not found" });
    }
    await db.write();
    res.status(204).end();
  } catch (err) {
    console.error("DELETE /api/loadouts/:id failed:", err);
    res.status(500).json({ error: "failed to delete loadout" });
  }
});
