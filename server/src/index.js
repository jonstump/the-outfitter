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

if (process.env.NODE_ENV === "production") {
  const clientDist = path.join(__dirname, "..", "..", "client", "dist");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`The Outfitter server listening on http://localhost:${PORT}`);
});
