import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Governing: desktop/lib/prefsPure.js's 2026-08-19 fix note.
//
// Manually verifying a locally packaged build (ahead of the first tagged
// release) found that lib/prefsPure.js was written in ESM (import/export)
// while everything else in desktop/ is CommonJS (require/module.exports, no
// "type": "module" in package.json) — main.js's real `require("./lib/
// prefsPure")` crashed with "SyntaxError: Cannot use import statement
// outside a module" on first real launch. Vitest never caught it: every
// other test in this suite reaches these files through Vitest's own
// import/require transform (esbuild), which is agnostic to a file's actual
// module-system declaration and silently papers over exactly this mismatch.
//
// This test bypasses Vitest's transform layer AND plain `node` — it spawns
// Electron's own bundled runtime (via ELECTRON_RUN_AS_NODE=1, the same
// technique release.yml's parity check uses) and has IT run a real
// `require(...)`. That distinction is load-bearing, confirmed the hard way
// while writing this test: this machine's local `node` (a newer patch than
// what Electron 33 bundles) transparently supports `require()`-ing an ESM
// file and did NOT reproduce the crash, while Electron's actual bundled
// runtime does not support that and fails exactly the way the shipped app
// did. A test using plain `node` here would have been a false negative —
// green in CI, broken in the packaged app, the exact failure mode this test
// exists to catch.
//
// Scoped to the two files in desktop/ explicitly documented as having "no
// Electron dependency" (lib/prefsPure.js, lib/secretCheck.js) — every other
// file here requires("electron") at module scope, which behaves specially
// only inside a real Electron process and isn't meaningfully testable this
// way.
describe("desktop/lib files load under Electron's real bundled CommonJS loader (regression)", () => {
  const libDir = path.join(__dirname, "..", "lib");

  it.each(["prefsPure.js", "secretCheck.js"])(
    "%s is loadable via require() under Electron's actual bundled Node, not just a newer local `node` or Vitest's transform",
    (filename) => {
      const filePath = path.join(libDir, filename);
      expect(() => {
        execFileSync(
          "npx",
          ["electron", "-e", `require(${JSON.stringify(filePath)})`],
          {
            stdio: "pipe",
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
            shell: process.platform === "win32",
          }
        );
      }).not.toThrow();
    }
  );
});
