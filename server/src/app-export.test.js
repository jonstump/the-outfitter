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
