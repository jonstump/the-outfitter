import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import {
  callerToken,
  ipLimiter,
  liveRecords,
  publicRecord,
  tokenLimiter,
} from "../lib/ownership.js";

// Ownership primitives (callerToken, liveRecords, the stacked rate limiters) moved to
// ../lib/ownership.js when SPEC-0003 added a second owned collection. Both routers MUST
// agree exactly on what a caller token is and which records are reachable — a divergence
// is a cross-user leak, which is what issue #17 closed. One definition, two importers.

export const loadoutsRouter = Router();

// Wire shape the client's toData()/fromData() (client/src/utils/loadoutCodec.js)
// produces: { w, e, tr, n, b } — item references as numeric catalog indices on
// today's format, and stable string ids once the stable-id codec (#26/#43) lands.
// Reject anything that doesn't match so malformed or arbitrarily large payloads
// never reach the data file (issue #19). Both index and id references are
// accepted so a save recorded by either codec loads; the numeric bounds are
// validation slack, not exact resolution — they reject clearly out-of-range
// indices while the client's own codec drops anything that doesn't resolve.
const WIRE_CATEGORIES = { w: 40, eT: 24, eC: 24, tr: 40 };
const isNonnegInt = (n) => Number.isInteger(n) && n >= 0;
const isId = (s) => typeof s === "string" && s.length > 0 && s.length <= 100;
const isRef = (v, bound) => (isNonnegInt(v) && v < bound) || isId(v);

function isValidData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  if (data.v !== undefined && typeof data.v !== "number") return false;
  if (!Array.isArray(data.w) || data.w.length !== 2) return false;
  if (!data.w.every((slot) => slot === null || (Array.isArray(slot) && slot.length >= 2 && isRef(slot[0], WIRE_CATEGORIES.w) && Number.isInteger(slot[1])))) return false;
  if (!Array.isArray(data.e) || data.e.length > 8) return false;
  if (!data.e.every((entry) => Array.isArray(entry) && entry.length >= 2 && (entry[0] === "T" || entry[0] === "C") && isRef(entry[1], entry[0] === "T" ? WIRE_CATEGORIES.eT : WIRE_CATEGORIES.eC))) return false;
  if (!Array.isArray(data.tr) || data.tr.length > 40) return false;
  if (!data.tr.every((id) => isRef(id, WIRE_CATEGORIES.tr))) return false;
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
    const mine = liveRecords(db.data.loadouts)
      .filter((l) => l.owner === token)
      .map(publicRecord);
    res.json(mine);
  } catch (err) {
    console.error("GET /api/loadouts failed:", err);
    res.status(500).json({ error: "failed to read loadouts" });
  }
});

loadoutsRouter.post("/", ipLimiter, tokenLimiter, async (req, res) => {
  try {
    const { name, data } = req.body || {};
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name must be a non-empty string" });
    }
    if (name.trim().length > 200) {
      return res.status(400).json({ error: "name must be at most 200 characters" });
    }
    if (!isValidData(data)) {
      return res.status(400).json({ error: "data must be a valid loadout payload" });
    }

    const token = callerToken(req);
    await db.read();
    const trimmedName = name.trim();
    const now = new Date().toISOString();
    const existing = liveRecords(db.data.loadouts).find((l) => l.owner === token && l.name === trimmedName);

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
    res.status(existing ? 200 : 201).json(publicRecord(record));
  } catch (err) {
    console.error("POST /api/loadouts failed:", err);
    res.status(500).json({ error: "failed to save loadout" });
  }
});

loadoutsRouter.delete("/:id", ipLimiter, tokenLimiter, async (req, res) => {
  try {
    const token = callerToken(req);
    await db.read();
    const before = db.data.loadouts.length;
    // Filter applies only to live (non-legacy) records; legacy records stay
    // untouched on disk and can never be deleted through the API.
    db.data.loadouts = [
      ...db.data.loadouts.filter((l) => l.legacy),
      ...liveRecords(db.data.loadouts).filter((l) => l.id !== req.params.id || l.owner !== token),
    ];
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
