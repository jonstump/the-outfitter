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
 * Framework-agnostic (2026-08-19, see fix note in main.js): reads
 * `req.headers` directly and writes the response via the plain
 * `http.ServerResponse` methods (`writeHead`/`end`) rather than Express's
 * `req.get()`/`res.status()`/`res.json()` conveniences. Both work
 * identically whether `req`/`res` are plain Node `http` objects or Express's
 * (which extend the same base classes), so this same function now composes
 * with either — desktop/main.js no longer needs Express at all just to use
 * this middleware.
 *
 * @param {string|null} secret — The launch secret, or null when running the
 *   self-hosted target (no secret check applies outside the desktop host).
 * @returns {(req: import("http").IncomingMessage, res: import("http").ServerResponse, next: () => void) => void}
 *   Middleware that rejects `/api` requests without the correct
 *   `X-Desktop-Secret` header.
 */
function createSecretCheck(secret) {
  if (!secret) {
    return (_req, _res, next) => next();
  }
  const secretBuffer = Buffer.from(secret, "utf8");
  return (req, res, next) => {
    const presented = req.headers["x-desktop-secret"];
    if (!presented) {
      return sendJsonError(res, 403, "desktop secret required");
    }
    const presentedBuffer = Buffer.from(presented, "utf8");
    if (
      presentedBuffer.length !== secretBuffer.length ||
      !crypto.timingSafeEqual(presentedBuffer, secretBuffer)
    ) {
      return sendJsonError(res, 403, "invalid desktop secret");
    }
    next();
  };
}

function sendJsonError(res, status, error) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error }));
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
