import path from "node:path";
import { fileURLToPath } from "node:url";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbFile = path.join(__dirname, "..", "data", "db.json");

const defaultData = { loadouts: [] };

export const db = new Low(new JSONFile(dbFile), defaultData);

await db.read();
db.data ||= defaultData;
db.data.loadouts ||= [];
await db.write();
