import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Covers: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback",
// SPEC-0001 REQ "Consistent Visual Presentation", SPEC-0001 REQ "Attribution"
//
// Sibling config (rather than a `test` block bolted onto vite.config.js) so the dev/build config
// stays focused on the app itself and the test runner config can evolve independently. Reuses the
// same @vitejs/plugin-react setup as vite.config.js since Vitest is Vite-native — no second
// bundler/runner philosophy (e.g. Jest) introduced into the project, per issue #9.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.js"],
  },
});
