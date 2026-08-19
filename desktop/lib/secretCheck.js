const crypto = require("node:crypto");

// Governing: SPEC-0005 REQ "Authenticated Loopback Boundary", issue #503.
//
// The desktop host binds the server to 127.0.0.1 on an ephemeral port so no
// non-loopback address can reach it. But loopback is still reachable by any
// process on the same machine, so a boundary that stops at "bind to loopback"
// is not a boundary at all — any local script can curl the port. The launch
// secret is what makes the boundary real: every `/api` request must carry a
// header (`X-Desktop-Secret`) whose value matches the current launch's secret,
// a 256-bit random value generated fresh on every launch and held in memory
// only. A request without the header, or with a stale header from a prior
// launch, is rejected with 403 before any router runs.
//
// The check uses `crypto.timingSafeEqual` rather than `===` to avoid a timing
// side-channel that would let an attacker brute-force the secret one byte at a
// time by measuring response time. The comparison is length-checked first
// (timingSafeEqual throws on mismatched lengths).
//
// `/healthz` is deliberately left unauthenticated — it is a liveness probe
// that carries no loadout data and needs to answer to orchestrators.

/**
 * Build the secret-check middleware for a given launch secret.
 *
 * @param {string|null} secret — The launch secret, or null when running the
 *   self-hosted target (no secret check applies outside the desktop host).
 * @returns {import("express").RequestHandler} Express middleware that rejects
 *   `/api` requests without the correct `X-Desktop-Secret` header.
 */
function createSecretCheck(secret) {
  if (!secret) {
    return (_req, _res, next) => next();
  }
  const secretBuffer = Buffer.from(secret, "utf8");
  return (req, res, next) => {
    const presented = req.get("x-desktop-secret");
    if (!presented) {
      return res.status(403).json({ error: "desktop secret required" });
    }
    const presentedBuffer = Buffer.from(presented, "utf8");
    if (
      presentedBuffer.length !== secretBuffer.length ||
      !crypto.timingSafeEqual(presentedBuffer, secretBuffer)
    ) {
      return res.status(403).json({ error: "invalid desktop secret" });
    }
    next();
  };
}

/**
 * Generate a fresh 256-bit launch secret as a hex string.
 *
 * MUST NOT be written to disk, logged, embedded in the packaged app, or
 * derived from anything stable across launches. Held in memory only.
 */
function generateLaunchSecret() {
  return crypto.randomBytes(32).toString("hex");
}

module.exports = { createSecretCheck, generateLaunchSecret };
