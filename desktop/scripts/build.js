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
  [
    "electron-builder",
    `--config.electronVersion=${electronVersion}`,
    // Fixed 2026-08-19 (second real v0.1.0 attempt): CI's log carried a line
    // this local machine's builds never showed — "artifacts will be
    // published  reason=tag is defined tag=v0.1.0". electron-builder
    // auto-detects a CI environment (GITHUB_ACTIONS, etc.) running against a
    // git ref that looks like a release tag and switches into publish mode,
    // which does more than a plain build — and that's exactly the
    // environment difference this local machine's runs never exercised
    // (no CI env vars, no tag-shaped GITHUB_REF), which is why removing
    // express as a runtime dependency fixed the crash locally but not in
    // CI: the "installing production dependencies" step and the
    // app-builder-bin ENOENT that follows it are still present here too,
    // logged identically. We aren't ready to actually publish releases yet
    // — no GitHub Release creation is wired up, this pipeline only uploads
    // build-run artifacts — so there's no reason to let electron-builder
    // attempt any publish-related behavior at all. `--publish=never`
    // disables it outright.
    "--publish=never",
  ],
  {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
    // npx resolves to npx.cmd on Windows; execFileSync needs the shell to
    // find it there. Not needed (and not used) on macOS/Linux.
    shell: process.platform === "win32",
  }
);
