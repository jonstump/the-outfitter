import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import { app } from "./index.js";
import { createSecretCheck, generateLaunchSecret } from "../../desktop/lib/secretCheck.js";

// Governing: SPEC-0005 REQ "One Server Implementation, Shared by Both Targets";
// design.md decision "index.js exports the app; the listen call is guarded."
//
// The desktop host (desktop/main.js) imports `{ app }` from this module to run
// the server on a loopback port inside Electron's main process. Importing this
// module MUST NOT bind a port as a side effect — the guard in index.js checks
// whether this file is the process entry point and only calls `app.listen` when
// it is. This test imports the module the way the desktop host does and asserts
// the app is available and responsive WITHOUT a pre-bound listener: supertest
// creates its own ephemeral listener per request, so a 200 here proves the app
// is configured correctly without relying on a module-scope `app.listen` call.
//
// The existing index.test.js boots the real entry point as a child process and
// speaks to it over HTTP — it tests the listen path. This file tests the import
// path: the two are complementary, and both must pass.

describe("server app export — import does not bind a port (SPEC-0005, #502)", () => {
  it("exports the configured Express app", () => {
    expect(app).toBeDefined();
    expect(typeof app).toBe("function");
    // Express apps carry a `.handle` method (the request handler itself).
    expect(typeof app.handle).toBe("function");
  });

  it("responds to /healthz through the exported app without a pre-bound listener", () => {
    return request(app)
      .get("/healthz")
      .expect("Content-Type", /json/)
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual({ ok: true });
      });
  });
});

// Governing: SPEC-0005 REQ "Authenticated Loopback Boundary", issue #503.
//
// The desktop host mounts the secret-check middleware onto the imported `app`
// before calling `app.listen`. This test mounts the same middleware against
// a fresh express app (so the test is isolated from the module-scope app) and
// asserts the 403/pass-through behavior verifiable without booting Electron.
describe("secret-check middleware against the server app (SPEC-0005, #503)", () => {
  function buildTestApp(secret) {
    const testApp = express();
    testApp.use("/api", createSecretCheck(secret));
    testApp.get("/api/test", (_req, res) => res.json({ ok: true }));
    return testApp;
  }

  it("rejects a request without the secret header with 403", async () => {
    const secret = generateLaunchSecret();
    const testApp = buildTestApp(secret);
    const res = await request(testApp).get("/api/test");
    expect(res.status).toBe(403);
  });

  it("accepts a request with the correct secret", async () => {
    const secret = generateLaunchSecret();
    const testApp = buildTestApp(secret);
    const res = await request(testApp)
      .get("/api/test")
      .set("X-Desktop-Secret", secret);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("rejects a wrong secret with 403", async () => {
    const secret = generateLaunchSecret();
    const testApp = buildTestApp(secret);
    const res = await request(testApp)
      .get("/api/test")
      .set("X-Desktop-Secret", "wrong");
    expect(res.status).toBe(403);
  });
});

// Governing: SPEC-0005 REQ "Authenticated Loopback Boundary", issue #503.
// Regression test for the bug found in /sdd:review of PR #508.
//
// The two describe blocks above both prove `createSecretCheck` is CORRECT in
// isolation — but the real bug was never in the middleware itself, it was in
// *how desktop/main.js composed it with the real server app*. `app` (imported
// above) already has its `/api/*` routers registered as a side effect of the
// import — `server/src/index.js`'s `app.use("/api/loadouts", ...)` etc. run
// at module-evaluation time, before any of this test file's code runs. The
// original desktop/main.js called `serverApp.use("/api", secretCheck)`
// directly on that already-populated app, which appends the check BEHIND the
// existing routers — Express dispatches in registration order, so every real
// `/api` request was fully handled by its router before ever reaching the
// check. `GET /api/loadouts` with no secret returned 200, not 403.
//
// This test exercises the fix: wrap the real imported `app` (not a synthetic
// one) as a sub-app of a fresh express() instance whose own middleware runs
// first — the exact pattern desktop/main.js now uses. It hits a REAL router
// path (`/api/loadouts`, not a test-only route), so a regression back to the
// mount-after-import pattern would fail this test.
describe("secret-check middleware wraps the REAL imported app (regression, PR #508)", () => {
  function buildWrappedRealApp(secret) {
    const wrapper = express();
    wrapper.use("/api", createSecretCheck(secret));
    wrapper.use(app);
    return wrapper;
  }

  it("rejects a real /api route without the secret header", async () => {
    const secret = generateLaunchSecret();
    const wrapped = buildWrappedRealApp(secret);
    const res = await request(wrapped)
      .get("/api/loadouts")
      .set("x-loadout-token", "11111111-1111-4111-8111-111111111111");
    expect(res.status).toBe(403);
  });

  it("rejects a real /api route with a wrong secret", async () => {
    const secret = generateLaunchSecret();
    const wrapped = buildWrappedRealApp(secret);
    const res = await request(wrapped)
      .get("/api/loadouts")
      .set("x-loadout-token", "11111111-1111-4111-8111-111111111111")
      .set("X-Desktop-Secret", "wrong");
    expect(res.status).toBe(403);
  });

  it("serves a real /api route once the correct secret is presented", async () => {
    const secret = generateLaunchSecret();
    const wrapped = buildWrappedRealApp(secret);
    const res = await request(wrapped)
      .get("/api/loadouts")
      .set("x-loadout-token", "11111111-1111-4111-8111-111111111111")
      .set("X-Desktop-Secret", secret);
    expect(res.status).toBe(200);
  });

  it("leaves /healthz reachable without the secret", async () => {
    const secret = generateLaunchSecret();
    const wrapped = buildWrappedRealApp(secret);
    const res = await request(wrapped).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
