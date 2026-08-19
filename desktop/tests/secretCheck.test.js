import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
const { createSecretCheck, generateLaunchSecret } = require("../lib/secretCheck.js");

// Governing: SPEC-0005 REQ "Authenticated Loopback Boundary", issue #503.
//
// The secret-check middleware is the real boundary — binding to 127.0.0.1
// alone is not enough, since any local process can reach a loopback port.
// Every `/api` request must carry the current launch's secret in the
// `X-Desktop-Secret` header, or it is rejected with 403 before any router
// runs. The check uses `crypto.timingSafeEqual`, not `===`, to avoid a
// timing side-channel.

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
