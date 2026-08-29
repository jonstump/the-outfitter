import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
const { createSecretCheck, generateLaunchSecret } = require("../lib/secretCheck.js");

// Governing: SPEC-0005 REQ "Authenticated Loopback Boundary", issue #503.
//
// SCOPE: this file tests `createSecretCheck` IN ISOLATION — does it accept a
// good secret, reject a bad/absent/stale one, and compare in constant time.
// It does NOT test whether production actually calls it for a given request.
//
// That distinction is not pedantic; it is #517. `buildApp` below mounts the
// check with `app.use("/api", check)`, which was production's wiring before
// #510 replaced it with a hand-rolled path test in `desktop/main.js`. Express
// resolves `app.use("/api", ...)` case-insensitively and therefore guarded
// `/API/loadouts` correctly, so every test here stayed green while production
// — which no longer used this wiring — served `/API/loadouts` unauthenticated.
// A test harness that is more correct than the code it stands in for reports
// success it has not earned.
//
// The predicate that decides whether the check runs, and a test built on
// production's ACTUAL handler shape, both live in `desktop/lib/apiPath.js` and
// `desktop/tests/apiPath.test.js`. When changing the boundary, change them
// there. Do not treat a green run of this file as evidence the boundary holds.

function buildApp(secret) {
  const app = express();
  const check = createSecretCheck(secret);
  app.use("/api", check);
  app.get("/api/test", (_req, res) => res.json({ ok: true }));
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("createSecretCheck (SPEC-0005, #503)", () => {
  it("rejects a request without the secret header with 403", async () => {
    const secret = generateLaunchSecret();
    const app = buildApp(secret);
    const res = await request(app).get("/api/test");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/secret/);
  });

  it("accepts a request with the correct secret", async () => {
    const secret = generateLaunchSecret();
    const app = buildApp(secret);
    const res = await request(app)
      .get("/api/test")
      .set("X-Desktop-Secret", secret);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("rejects a request with a wrong secret with 403", async () => {
    const secret = generateLaunchSecret();
    const app = buildApp(secret);
    const res = await request(app)
      .get("/api/test")
      .set("X-Desktop-Secret", "wrong-secret");
    expect(res.status).toBe(403);
  });

  it("rejects a request with a stale secret from a prior launch", async () => {
    const oldSecret = generateLaunchSecret();
    const newSecret = generateLaunchSecret();
    const app = buildApp(newSecret);
    const res = await request(app)
      .get("/api/test")
      .set("X-Desktop-Secret", oldSecret);
    expect(res.status).toBe(403);
  });

  it("leaves /healthz unauthenticated", async () => {
    const secret = generateLaunchSecret();
    const app = buildApp(secret);
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("is a no-op when no secret is configured (self-hosted target)", async () => {
    const app = buildApp(null);
    const res = await request(app).get("/api/test");
    expect(res.status).toBe(200);
  });

  it("rejects an empty-string secret header with 403", async () => {
    const secret = generateLaunchSecret();
    const app = buildApp(secret);
    const res = await request(app)
      .get("/api/test")
      .set("X-Desktop-Secret", "");
    expect(res.status).toBe(403);
  });
});

describe("generateLaunchSecret (SPEC-0005, #503)", () => {
  it("produces a different secret on every call", () => {
    const a = generateLaunchSecret();
    const b = generateLaunchSecret();
    expect(a).not.toBe(b);
    expect(a).not.toBe("");
    expect(b).not.toBe("");
  });

  it("produces a 256-bit (64 hex char) secret", () => {
    const secret = generateLaunchSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });
});
