import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";

export const loadoutsRouter = Router();

loadoutsRouter.get("/", async (_req, res) => {
  await db.read();
  res.json(db.data.loadouts);
});

loadoutsRouter.post("/", async (req, res) => {
  const { name, data } = req.body || {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name must be a non-empty string" });
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return res.status(400).json({ error: "data must be an object" });
  }

  await db.read();
  const trimmedName = name.trim();
  const now = new Date().toISOString();
  const existing = db.data.loadouts.find((l) => l.name === trimmedName);

  let record;
  if (existing) {
    existing.data = data;
    existing.updatedAt = now;
    record = existing;
  } else {
    record = { id: randomUUID(), name: trimmedName, data, updatedAt: now };
    db.data.loadouts.push(record);
  }

  await db.write();
  res.status(existing ? 200 : 201).json(record);
});

loadoutsRouter.delete("/:id", async (req, res) => {
  await db.read();
  const before = db.data.loadouts.length;
  db.data.loadouts = db.data.loadouts.filter((l) => l.id !== req.params.id);
  if (db.data.loadouts.length === before) {
    return res.status(404).json({ error: "loadout not found" });
  }
  await db.write();
  res.status(204).end();
});
