import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * One request, with the headers EXACTLY as given.
 *
 * node:http rather than fetch(), and that is load-bearing rather than a style choice.
 * `Host` is a forbidden header name under the fetch spec: undici derives it from the URL
 * and discards the one you pass. Since the whole same-origin check turns on Host, a fetch()
 * version of these tests silently asks a different question — it did, and reported the fix
 * broken while the server was answering correctly. This helper sends what it is told.
 */
function req(method, pathname, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: "127.0.0.1", port: PORT, method, path: pathname, headers, setHost: false },
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

beforeAll(async () => {
  child = spawn(process.execPath, [ENTRY], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // Deliberately NOT set: the deployment host must be accepted without configuration.
      // Setting it here would test the workaround instead of the fix.
      CORS_ORIGIN: "",
      OUTFITTER_DB_FILE: path.join(REPO_ROOT, "server", "data", "db.cors-test.json"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start in time")), 15000);
    child.stdout.on("data", (buf) => {
      if (buf.toString().includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => reject(new Error(`server exited early with code ${code}`)));
  });
}, 20000);

afterAll(() => {
  child?.kill();
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
});
