import { describe, it, expect } from "vitest";
import express from "express";
import http from "node:http";
const { isApiPath } = require("../lib/apiPath.js");
const { createSecretCheck, generateLaunchSecret } = require("../lib/secretCheck.js");

// Governing: SPEC-0005 REQ "Authenticated Loopback Boundary", issue #517.
//
// Two kinds of test live here, and the second is the one that matters.
//
// 1. Unit tests pin `isApiPath`'s contract directly.
// 2. A DIFFERENTIAL test asserts the property the predicate actually has to
//    hold: for any request target, if Express would route it to an `/api`
//    router, `isApiPath` MUST return true. Guarding more than Express routes is
//    safe; guarding less is the #517 vulnerability. Asserting this against a
//    real Express app — rather than against a hand-written list of what we
//    believe Express does — is deliberate: #517 existed precisely because the
//    old test suite encoded an assumption about Express's matching (by mounting
//    the check with `app.use("/api", ...)`, which Express itself resolved
//    correctly) while production hand-rolled that matching and got it wrong.
//    A test that asks Express cannot drift from Express.

// Request targets to probe. Includes the #517 case variants plus separator,
// query, encoding and traversal shapes that could plausibly diverge.
const PROBE_PATHS = [
  "/api/loadouts",
  "/API/loadouts",
  "/Api/Loadouts",
  "/aPi/LoAdOuTs",
  "/API/loadout-lists",
  "/API/hunter-favorites",
  "/api/loadouts/",
  "/API/loadouts/",
  "/api/loadouts?x=1",
  "/API/loadouts?x=1",
  "/api",
  "/API",
  "/api?x=1",
  "//api/loadouts",
  "/api/../loadouts",
  "/api/./loadouts",
  "/%41PI/loadouts",
  "/api%2Floadouts",
  "/apifoo",
  "/healthz",
  "/",
  "/index.html",
];

function rawGet(port, target) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: target, method: "GET" }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.end();
  });
}

describe("isApiPath (SPEC-0005, #517)", () => {
  it("matches the canonical /api paths", () => {
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/api/loadouts")).toBe(true);
    expect(isApiPath("/api?x=1")).toBe(true);
  });

  // The regression itself. Reverting apiPath.js to a case-sensitive
  // `startsWith` turns every assertion in this test red.
  it("matches /api paths regardless of case (the #517 bypass)", () => {
    expect(isApiPath("/API/loadouts")).toBe(true);
    expect(isApiPath("/Api/Loadouts")).toBe(true);
    expect(isApiPath("/aPi/LoAdOuTs")).toBe(true);
    expect(isApiPath("/API/hunter-favorites")).toBe(true);
    expect(isApiPath("/API/loadout-lists")).toBe(true);
    expect(isApiPath("/API")).toBe(true);
  });

  it("does not match non-API paths", () => {
    expect(isApiPath("/healthz")).toBe(false);
    expect(isApiPath("/")).toBe(false);
    expect(isApiPath("/index.html")).toBe(false);
    expect(isApiPath("/apifoo")).toBe(false); // no segment boundary
  });

  it("is total over junk input rather than throwing", () => {
    expect(isApiPath(undefined)).toBe(false);
    expect(isApiPath(null)).toBe(false);
    expect(isApiPath(42)).toBe(false);
  });
});

describe("isApiPath vs Express routing — superset invariant (SPEC-0005, #517)", () => {
  it("guards every path Express would route to an /api router", async () => {
    // Mount the same way server/src/index.js does, with the same (default)
    // case sensitivity — no `app.set("case sensitive routing", ...)`.
    const app = express();
    const routed = [];
    const mark = (name) => (req, res) => {
      routed.push(req.url);
      res.json({ router: name });
    };
    app.use("/api/loadouts", mark("loadouts"));
    app.use("/api/loadout-lists", mark("loadout-lists"));
    app.use("/api/hunter-favorites", mark("hunter-favorites"));
    app.get("/healthz", (_q, r) => r.json({ ok: true }));
    app.use((_q, r) => r.status(404).json({ error: "not found" }));

    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    const violations = [];
    for (const target of PROBE_PATHS) {
      routed.length = 0;
      await rawGet(port, target);
      const expressRouted = routed.length > 0;
      const guarded = isApiPath(target);
      // The invariant: routed => guarded. Guarded-but-not-routed is fine.
      if (expressRouted && !guarded) {
        violations.push({ target, expressRouted, guarded });
      }
    }
    server.close();

    expect(violations).toEqual([]);
  });
});

describe("production request handler (SPEC-0005, #517)", () => {
  // Mirrors desktop/main.js's http.createServer handler exactly. The old suite
  // mounted the check with `app.use("/api", check)` — the pre-#510 wiring,
  // which production no longer uses — so it proved nothing about the code that
  // actually runs. This builds the real shape.
  function buildDesktopServer(secret) {
    const serverApp = express();
    serverApp.use("/api/loadouts", (_q, r) => r.json({ data: "SENSITIVE" }));
    serverApp.get("/healthz", (_q, r) => r.json({ ok: true }));
    serverApp.use((_q, r) => r.status(404).json({ error: "not found" }));

    const secretCheck = createSecretCheck(secret);
    return http.createServer((req, res) => {
      if (isApiPath(req.url)) {
        secretCheck(req, res, () => serverApp(req, res));
      } else {
        serverApp(req, res);
      }
    });
  }

  async function withServer(fn) {
    const secret = generateLaunchSecret();
    const server = buildDesktopServer(secret);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      await fn(server.address().port, secret);
    } finally {
      server.close();
    }
  }

  it("refuses every case variant of /api without the secret", async () => {
    await withServer(async (port) => {
      for (const target of ["/api/loadouts", "/API/loadouts", "/Api/Loadouts", "/aPi/LoAdOuTs"]) {
        const res = await rawGet(port, target);
        expect(res.status, `${target} must be refused`).toBe(403);
        expect(res.body).not.toContain("SENSITIVE");
      }
    });
  });

  it("serves /api when the correct secret is presented", async () => {
    await withServer(async (port, secret) => {
      const res = await new Promise((resolve) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port,
            path: "/api/loadouts",
            method: "GET",
            headers: { "X-Desktop-Secret": secret },
          },
          (r) => {
            let b = "";
            r.on("data", (c) => (b += c));
            r.on("end", () => resolve({ status: r.statusCode, body: b }));
          }
        );
        req.end();
      });
      expect(res.status).toBe(200);
      expect(res.body).toContain("SENSITIVE");
    });
  });

  it("leaves /healthz reachable without the secret", async () => {
    await withServer(async (port) => {
      const res = await rawGet(port, "/healthz");
      expect(res.status).toBe(200);
    });
  });
});
