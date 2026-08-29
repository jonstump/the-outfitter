import { describe, it, expect } from "vitest";
import express from "express";
import http from "node:http";
import net from "node:net";
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
//
// #526 widened this file after review found the first #517 fix still had a
// bypass. Two shapes are probed that the original list could not express:
//   - ABSOLUTE-FORM targets (`GET http://host/api/loadouts HTTP/1.1`), which
//     RFC 9112 §3.2.2 permits and Node hands to `req.url` whole. These cannot
//     be sent through `http.request({ path })`, so a raw-socket helper writes
//     the request line verbatim.
//   - DOT-SEGMENT targets (`/api/loadouts/../..`), which Express routes because
//     it prefix-matches the RAW pathname, and which any normalizing parser
//     (`new URL()`) would answer false for. These pin the predicate against a
//     future "simplification" that would silently reopen #517.

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
  // Dot segments. Express never resolves `..` — it prefix-matches the raw
  // pathname from `parseurl` — so these ARE routed to the loadouts mount, and a
  // normalizing parser that collapses them to `/` would under-guard a live
  // route. Verified against real Express, not assumed. (#526)
  "/api/loadouts/../..",
  "/api/loadout-lists/../..",
  "/api/loadouts/%2e%2e/..",
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

// `http.request({ path })` cannot express an absolute-form request target, so
// the request line is written straight onto a socket. That is the only way to
// probe the #526 vector at all — which is precisely why the original suite,
// built entirely on `rawGet`, could not see it.
function rawRequestLine(port, requestTarget, { method = "GET", headers = "" } = {}) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1", () => {
      sock.write(
        `${method} ${requestTarget} HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${port}\r\n` +
          headers +
          "Connection: close\r\n\r\n"
      );
    });
    let raw = "";
    sock.on("data", (c) => (raw += c));
    sock.on("end", () => {
      const status = parseInt((raw.split("\r\n")[0] || "").split(" ")[1], 10) || 0;
      resolve({ status, body: raw.split("\r\n\r\n")[1] || "" });
    });
    sock.on("error", () => resolve({ status: 0, body: "" }));
  });
}

// Absolute-form probe suffixes, turned into full URIs once a port is known.
const ABSOLUTE_FORM_SUFFIXES = [
  "/api/loadouts",
  "/API/loadouts",
  "/aPi/LoAdOuTs",
  "/API/loadout-lists",
  "/api/hunter-favorites",
  "/api/loadouts?x=1",
  "/api",
  "/healthz",
  "/",
];

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

  // The #526 regression. Reverting apiPath.js to the split-only predicate (no
  // scheme/authority strip) turns every assertion here red.
  it("matches /api paths sent in absolute-form (the #526 bypass)", () => {
    expect(isApiPath("http://127.0.0.1:1234/api/loadouts")).toBe(true);
    expect(isApiPath("http://127.0.0.1:1234/API/loadouts")).toBe(true);
    expect(isApiPath("http://127.0.0.1:1234/api/hunter-favorites")).toBe(true);
    expect(isApiPath("http://127.0.0.1:1234/api/loadouts?x=1")).toBe(true);
    expect(isApiPath("http://127.0.0.1:1234/api")).toBe(true);
    // The scheme is case-insensitive too (RFC 3986 §3.1), and so is the
    // authority — neither may be the thing that decides authentication.
    expect(isApiPath("HTTP://127.0.0.1:1234/API/loadouts")).toBe(true);
    expect(isApiPath("HtTp://127.0.0.1:1234/aPi/LoAdOuTs")).toBe(true);
    expect(isApiPath("https://127.0.0.1:1234/api/loadouts")).toBe(true);
    // Userinfo is part of the authority; the path still starts after it.
    expect(isApiPath("http://user:pw@127.0.0.1:1234/api/loadouts")).toBe(true);
  });

  it("does not match non-API absolute-form targets", () => {
    expect(isApiPath("http://127.0.0.1:1234/healthz")).toBe(false);
    expect(isApiPath("http://127.0.0.1:1234/")).toBe(false);
    // No path at all: addresses the origin root, not the API.
    expect(isApiPath("http://127.0.0.1:1234")).toBe(false);
    expect(isApiPath("http://127.0.0.1:1234?x=1")).toBe(false);
    // A host that merely looks like the mount is still not a path under /api.
    expect(isApiPath("http://api/healthz")).toBe(false);
  });

  // Guards the parsing strategy itself, not just its current output. Express
  // prefix-matches the RAW pathname and never resolves `..`, so it routes these;
  // a normalizing parser collapses them to `/` and would under-guard a live
  // route. This is why apiPath.js does not use `new URL()`. (#526)
  it("still matches when dot segments follow the mount, as Express does", () => {
    expect(isApiPath("/api/loadouts/../..")).toBe(true);
    expect(isApiPath("/api/loadout-lists/../..")).toBe(true);
    expect(isApiPath("/api/loadouts/%2e%2e/..")).toBe(true);
    expect(isApiPath("http://127.0.0.1:1234/api/loadouts/../..")).toBe(true);
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

    // Absolute-form targets can only be built once the port is known, and can
    // only be SENT down a raw socket — `http.request({ path })` will not carry
    // them. Folding them into the same invariant check is the whole point of
    // #526: the property is about request targets, not about one spelling of
    // them.
    const absoluteForm = ABSOLUTE_FORM_SUFFIXES.flatMap((suffix) => [
      `http://127.0.0.1:${port}${suffix}`,
      `HTTP://127.0.0.1:${port}${suffix}`,
    ]);
    const targets = [...PROBE_PATHS, ...absoluteForm];

    const violations = [];
    for (const target of targets) {
      routed.length = 0;
      await rawRequestLine(port, target);
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

  // The #526 finding, at the layer that actually matters: not "does the
  // predicate return true" but "does the real handler shape refuse the request".
  it("refuses absolute-form /api targets without the secret", async () => {
    await withServer(async (port) => {
      for (const suffix of ["/api/loadouts", "/API/loadouts", "/aPi/LoAdOuTs"]) {
        for (const scheme of ["http", "HTTP"]) {
          const target = `${scheme}://127.0.0.1:${port}${suffix}`;
          const res = await rawRequestLine(port, target);
          expect(res.status, `${target} must be refused`).toBe(403);
          expect(res.body, `${target} must not leak`).not.toContain("SENSITIVE");
        }
      }
    });
  });

  // Reads were the visible half of #526; the write was the damaging half. The
  // original #517 report held itself to proving persistence, so this does too.
  it("refuses an absolute-form write without the secret", async () => {
    await withServer(async (port) => {
      const target = `http://127.0.0.1:${port}/api/loadouts`;
      const res = await rawRequestLine(port, target, { method: "POST" });
      expect(res.status).toBe(403);
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
