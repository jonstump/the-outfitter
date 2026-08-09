import { Router } from "express";
import { randomUUID } from "node:crypto";
import rateLimit from "express-rate-limit";
import { db } from "../db.js";

export const loadoutsRouter = Router();

// Per-user ownership boundary (issue #17): every loadout record is scoped to the
// client-issued token that created it. Requests that carry no token (e.g. curl)
// never touch another client's data — they get a fresh per-request identity, so
// anything they save is scoped to that single request and invisible to everyone
// else (including their own later no-token requests). There is deliberately no
// shared anonymous bucket: one would expose every legacy no-owner record to any
// request that simply omits the header, recreating the leak #17 closes.
const ANON = "request-scoped";

function callerToken(req) {
  const token = req.get("x-loadout-token") || "";
  if (typeof token === "string" && token.trim()) return token.trim().slice(0, 200);
  // Anonymous requests get a random identity so they can't observe/overwrite
  // any persisted scope, including each other's.
  return `${ANON}:${randomUUID()}`;
}

// Basic throttling on the write/delete endpoints — defense-in-depth
// independent of the ownership model (issue #21). Keyed by client token where
// one is present so users sharing a NAT don't collectively trip a per-IP limit;
// anonymous (no-token) requests fall back to IP.
function writeLimiterKey(req) {
  const token = req.get("x-loadout-token");
  return token && typeof token === "string" && token.trim() ? `tok:${token.trim().slice(0, 200)}` : req.ip;
}

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => writeLimiterKey(req),
});

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
