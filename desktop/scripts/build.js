#!/usr/bin/env node
// npm scripts run through cmd.exe on Windows, not bash — `$(...)` command
// substitution (the obvious one-liner fix) only works on macOS/Linux, and
// release.yml's package job runs a windows-latest leg. This derives
// Electron's actually-installed version in plain Node (portable) and passes
// it to electron-builder explicitly via --config.electronVersion, so the
// packaged runtime version can never silently drift from what's installed —
// same rationale as ADR-0004's Node-version-pin rule, applied to Electron.
//
// Without this, electron-builder can't compute the Electron version on its
// own in this npm-workspaces layout (electron is hoisted to the repo root's
// node_modules, not desktop/node_modules) — see
// https://github.com/electron-userland/electron-builder/issues/3984.

const { execFileSync } = require("node:child_process");
const path = require("node:path");

const electronVersion = require("electron/package.json").version;

execFileSync(
  "npx",
  ["electron-builder", `--config.electronVersion=${electronVersion}`],
  {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
    // npx resolves to npx.cmd on Windows; execFileSync needs the shell to
    // find it there. Not needed (and not used) on macOS/Linux.
    shell: process.platform === "win32",
  }
);
