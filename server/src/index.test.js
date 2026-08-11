import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WRITE_PER_IP } from "./lib/ownership.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..");
const ENTRY = path.join(__dirname, "index.js");
const CLIENT_DIST = path.join(REPO_ROOT, "client", "dist");

// Governing: issue #30 (restrict the API to known origins), SPEC-0003 Security Requirements
//
// WHY THIS FILE BOOTS A PROCESS INSTEAD OF CALLING A ROUTER.
//
// Every other server suite builds its own tiny express app and mounts one router into it.
// That is the right shape for testing a router — and it is also exactly why the outage this
// file exists to prevent went unnoticed by 63 passing tests: the thing that broke was not in
// any router. It was the CORS policy in index.js, and no suite had ever loaded index.js at
// all. A handwritten app in a test cannot fail the way the real wiring failed.
//
// So this boots the real entry point, on the real port, and speaks to it over HTTP.
//
// WHAT BROKE. The policy was mounted app-wide and treated "carries no Origin header" as the
// test for same-origin. Browsers send `Origin` on a great many same-origin requests: on every
// request whose method is not GET/HEAD, and on every request made in CORS mode regardless of
// method — which includes the entry bundle, because Vite stamps `crossorigin` on the <script>
// and <link> it writes into index.html. On any host not listed in CORS_ORIGIN (the default is
// localhost only) the server answered 403 to its own JavaScript, and the deployed site
// rendered as an empty <div id="root">.
//
// The requests below are written as the BROWSER sends them — Host and X-Forwarded-Proto as a
// reverse proxy forwards them, Origin alongside — because the bug lived precisely in the gap
// between what the code assumed a browser sends and what one actually sends.

const SITE = "the-outfitter.example.com";
const PORT = 4399;
// Governing: issue #199. A second instance, configured as the topologies that have NO proxy
// in front — docker-compose's published port, the Procfile VM. The distinction is the whole
// point of the fix, so it needs two servers to be observable at all.
const DIRECT_PORT = 4398;

/**
 * One request, with the headers EXACTLY as given.
 *
 * node:http rather than fetch(), and that is load-bearing rather than a style choice.
 * `Host` is a forbidden header name under the fetch spec: undici derives it from the URL
 * and discards the one you pass. Since the whole same-origin check turns on Host, a fetch()
 * version of these tests silently asks a different question — it did, and reported the fix
 * broken while the server was answering correctly. This helper sends what it is told.
 */
function req(method, pathname, headers = {}, body, port = PORT) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: "127.0.0.1", port, method, path: pathname, headers, setHost: false },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, text }));
      }
    );
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

/** Headers a reverse proxy (Render, nginx) puts on a same-origin browser request to SITE. */
const asBrowserOn = (site, extra = {}) => ({
  Host: site,
  "X-Forwarded-Proto": "https",
  Origin: `https://${site}`,
  ...extra,
});

let child;
let directChild;

/**
 * Boot the real entry point and wait until it is listening.
 *
 * `extraEnv` is what distinguishes the two instances: the proxied one declares the peer it
 * is behind (the test client IS on loopback, which is exactly what a proxy on the same host
 * looks like), and the direct one declares nothing, which is now the default.
 */
function startServer(port, dbFile, extraEnv = {}) {
  const proc = spawn(process.execPath, [ENTRY], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      // Deliberately NOT set: the deployment host must be accepted without configuration.
      // Setting it here would test the workaround instead of the fix.
      CORS_ORIGIN: "",
      OUTFITTER_DB_FILE: path.join(REPO_ROOT, "server", "data", dbFile),
      // Cleared before `extraEnv` reinstates it: `...process.env` above would otherwise let
      // a developer's shell configure the instance that is supposed to have no proxy, and
      // the direct-exposure suite would silently stop testing anything.
      TRUST_PROXY: "",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start in time")), 15000);
    proc.stdout.on("data", (buf) => {
      if (buf.toString().includes("listening")) {
        clearTimeout(timer);
        resolve(proc);
      }
    });
    proc.on("error", reject);
    proc.on("exit", (code) => reject(new Error(`server exited early with code ${code}`)));
  });
}

beforeAll(async () => {
  [child, directChild] = await Promise.all([
    // The CORS suite below speaks as a browser behind a reverse proxy — Host rewritten,
    // X-Forwarded-* set — so this instance has to be told a proxy is in front. Before
    // issue #199 that was the hardcoded default, which is precisely the bug.
    startServer(PORT, "db.cors-test.json", { TRUST_PROXY: "loopback" }),
    startServer(DIRECT_PORT, "db.direct-test.json"),
  ]);
}, 25000);

afterAll(() => {
  child?.kill();
  directChild?.kill();
});

describe("same-origin requests are never refused by the CORS policy", () => {
  // The regression, stated as the single request that took the site down: a browser fetching
  // the app's own bundle in CORS mode, on a host nobody configured into CORS_ORIGIN.
  const assets = existsSync(CLIENT_DIST)
    ? readdirSync(path.join(CLIENT_DIST, "assets")).filter((f) => /\.(js|css)$/.test(f))
    : [];

  it.skipIf(assets.length === 0)(
    "serves the client bundle to a same-origin request that carries an Origin header",
    async () => {
      expect(assets.length).toBeGreaterThan(0);
      for (const asset of assets) {
        const res = await req("GET", `/assets/${asset}`, asBrowserOn(SITE));
        // A 403 here is a blank page for every visitor.
        expect([asset, res.status]).toEqual([asset, 200]);
      }
    }
  );

  it("does not apply the API's origin policy to routes outside /api", async () => {
    // /healthz stands in for every non-API route (static assets, the SPA fallback). The
    // policy is scoped to /api now, so even a hostile Origin must not turn a page request
    // into a 403 — access control on the JSON API is not a reason to refuse a document.
    const res = await req("GET", "/healthz", {
      Host: SITE,
      "X-Forwarded-Proto": "https",
      Origin: "https://evil.example",
    });
    expect(res.status).toBe(200);
  });

  it("accepts a same-origin read that carries an Origin header", async () => {
    const res = await req("GET", "/api/hunter-favorites", asBrowserOn(SITE));
    expect(res.status).toBe(200);
  });

  // PR #189 review. A proxy hop that rewrites Host to the upstream address — nginx does
  // this by default, without an explicit `proxy_set_header Host $host;` — leaves the
  // client-facing authority in X-Forwarded-Host and nowhere else. Reading the raw Host
  // header would compare the browser's Origin against "127.0.0.1:4399" and refuse every
  // legitimate request, which is this file's original outage arriving by another route.
  it("honours X-Forwarded-Host when a proxy rewrote the Host header", async () => {
    const res = await req("GET", "/api/hunter-favorites", {
      Host: "127.0.0.1:4399",
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": SITE,
      Origin: `https://${SITE}`,
    });
    expect(res.status).toBe(200);
  });

  it("reads the client's own entry from a chain of forwarded hosts", async () => {
    const res = await req("GET", "/api/hunter-favorites", {
      Host: "10.0.0.7",
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": `${SITE}, inner-lb.internal`,
      Origin: `https://${SITE}`,
    });
    expect(res.status).toBe(200);
  });

  // The port is part of an origin, and `req.hostname` — the tempting one-liner for the
  // check above — drops it. This is the single-process run the README documents: no proxy,
  // a non-default port, and a browser that puts that port in the Origin header.
  it("keeps the port, so a deployment on a non-default port is still same-origin", async () => {
    const res = await req("GET", "/api/hunter-favorites", {
      Host: "localhost:4100",
      Origin: "http://localhost:4100",
    });
    expect(res.status).toBe(200);
  });

  it("accepts a same-origin POST without CORS_ORIGIN naming the deployment host", async () => {
    const body = JSON.stringify({ name: "__cors_test__", data: {} });
    const res = await req(
      "POST",
      "/api/loadouts",
      asBrowserOn(SITE, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "x-loadout-token": "11111111-2222-4333-8444-555555555555",
      }),
      body
    );
    // The payload is deliberately not a valid loadout: what matters is that the request
    // reached the validator at all. Asserting "not 403" rather than a success code keeps
    // this test about the origin policy instead of about the loadout schema.
    expect(res.status).not.toBe(403);
  });
});

describe("cross-origin requests are still refused", () => {
  // The point of issue #30 — and the reason the fix matches the request's own host rather
  // than simply allowing everything. In a real cross-site attack the victim's browser sets
  // Host to the site it is contacting and Origin to the attacker's page; those disagree,
  // which is the shape asserted here.
  const write = (origin) => {
    const body = JSON.stringify({ name: "__cors_test__", data: {} });
    return req(
      "POST",
      "/api/loadouts",
      {
        Host: SITE,
        "X-Forwarded-Proto": "https",
        Origin: origin,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "x-loadout-token": "11111111-2222-4333-8444-555555555555",
      },
      body
    );
  };

  it("refuses a write from a foreign origin", async () => {
    const res = await write("https://evil.example");
    expect(res.status).toBe(403);
    expect(JSON.parse(res.text)).toEqual({ error: "origin not allowed" });
  });

  it("treats a scheme mismatch as a different origin", async () => {
    // http://SITE is not https://SITE. Matching on host alone would let a downgraded or
    // plain-HTTP sibling origin through.
    const res = await write(`http://${SITE}`);
    expect(res.status).toBe(403);
  });

  it("treats a different port on the same host as a different origin", async () => {
    const res = await write(`https://${SITE}:8443`);
    expect(res.status).toBe(403);
  });

  // The forwarded-host lookup must not become a way to assert your own origin. A browser
  // cannot mount this attack — X-Forwarded-Host is not a CORS-safelisted header, so setting
  // it forces a preflight, and the preflight carries the header's NAME without its value,
  // leaving the check to fall back to the real Host and refuse. Asserted here so the
  // fallback stays deliberate rather than incidental.
  it("refuses a preflight that merely asks to send X-Forwarded-Host", async () => {
    const res = await req("OPTIONS", "/api/loadouts", {
      Host: SITE,
      "X-Forwarded-Proto": "https",
      Origin: "https://evil.example",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "x-forwarded-host, content-type",
    });
    expect(res.status).toBe(403);
  });
});

// Governing: issue #199 (`trust proxy 1` believes `X-Forwarded-*` from any peer)
//
// Everything above speaks to an instance that was TOLD a proxy is in front. This suite
// speaks to one that was not — the docker-compose and single-VM topologies, where the
// container port is published straight to the host and nothing rewrites headers.
//
// The setting used to be a hardcoded `1`. Express compiles a number to `(a, i) => i < val`,
// which never reads the peer address, so `trust(remoteAddress, 0)` was unconditionally true
// and every forwarded header was believed — from a proxy or from a client. The consequence
// that matters is `req.ip`: both limiters key on it (lib/ownership.js), so a client sending
// a different X-Forwarded-For per request got a fresh bucket per request and was not rate
// limited at all.
describe("a server with no proxy in front believes no forwarded header", () => {
  const direct = (method, pathname, headers = {}, body) =>
    req(method, pathname, headers, body, DIRECT_PORT);

  it("ignores X-Forwarded-Host from a direct peer", () => {
    // The proxied instance answers 200 to this exact request ("honours X-Forwarded-Host
    // when a proxy rewrote the Host header", above). Here nobody is in front, so the
    // header is just something the client said about itself, and the same-origin check
    // falls back to the real Host — which does not match the claimed origin.
    return direct("GET", "/api/hunter-favorites", {
      Host: `127.0.0.1:${DIRECT_PORT}`,
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": SITE,
      Origin: `https://${SITE}`,
    }).then((res) => expect(res.status).toBe(403));
  });

  it("still serves a genuinely same-origin request", () => {
    // The fix must not make a proxy-less deploy refuse its own traffic — that is the outage
    // this file was written for, and it is reachable from the other direction too.
    return direct("GET", "/api/hunter-favorites", {
      Host: `127.0.0.1:${DIRECT_PORT}`,
      Origin: `http://127.0.0.1:${DIRECT_PORT}`,
    }).then((res) => expect(res.status).toBe(200));
  });

  // The regression the ticket asks for, stated as behaviour rather than as configuration:
  // a client rotating X-Forwarded-For must not get a fresh rate-limit bucket per request.
  //
  // Writes carry a unique token each, so the per-token limiter (60/min) never fires and the
  // only budget under test is the per-IP floor. The payload is deliberately invalid: a
  // limiter runs before its handler, so the request is counted and nothing is written.
  it("keys the rate limiter on the socket address, not on a spoofed X-Forwarded-For", async () => {
    const spoofed = (n) => {
      const body = JSON.stringify({ name: "__trust_proxy_test__", data: {} });
      return direct(
        "POST",
        "/api/loadouts",
        {
          Host: `127.0.0.1:${DIRECT_PORT}`,
          Origin: `http://127.0.0.1:${DIRECT_PORT}`,
          "X-Forwarded-For": `203.0.113.${n % 254}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "x-loadout-token": `11111111-2222-4333-8444-${String(n).padStart(12, "0")}`,
        },
        body
      );
    };

    // Exhaust the per-IP budget exactly. Batched rather than fired all at once purely to
    // keep the socket count sane; every one of them counts against the same bucket.
    for (let start = 0; start < WRITE_PER_IP; start += 40) {
      const batch = [];
      for (let n = start; n < Math.min(start + 40, WRITE_PER_IP); n++) batch.push(spoofed(n));
      const statuses = await Promise.all(batch).then((rs) => rs.map((r) => r.status));
      expect(statuses).not.toContain(429);
    }

    // Header spoofing bought nothing: the next request is over the floor.
    const over = await spoofed(WRITE_PER_IP);
    expect(over.status).toBe(429);
  }, 30000);
});

describe("a server behind a declared proxy still distinguishes forwarded clients", () => {
  // The other half of the assertion above, and the reason the setting is configurable rather
  // than simply removed: where a proxy really is in front, X-Forwarded-For is the only thing
  // that tells two clients apart, and one busy client must not exhaust everybody's budget.
  // Well short of any limit, so this stays a statement about bucketing rather than a second
  // exhaustion test.
  it("gives each forwarded client its own bucket", async () => {
    const statuses = [];
    for (let n = 0; n < 20; n++) {
      const body = JSON.stringify({ name: "__trust_proxy_test__", data: {} });
      const res = await req(
        "POST",
        "/api/loadouts",
        {
          Host: SITE,
          "X-Forwarded-Proto": "https",
          "X-Forwarded-For": `198.51.100.${n}`,
          Origin: `https://${SITE}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "x-loadout-token": `22222222-3333-4444-8555-${String(n).padStart(12, "0")}`,
        },
        body
      );
      statuses.push(res.status);
    }
    expect(statuses).not.toContain(429);
    expect(statuses).not.toContain(403);
  }, 20000);
});
