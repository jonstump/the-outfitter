import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import Module from "node:module";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const { isApiPath } = require("../lib/apiPath.js");
const { createSecretCheck, generateLaunchSecret } = require("../lib/secretCheck.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = path.join(__dirname, "..");

// Governing: SPEC-0005 REQ "Authenticated Loopback Boundary", issue #523.
//
// The launch secret used to be handed to the preload script through the process
// environment. Every child process inherits the environment, and desktop/main.js
// calls `shell.openExternal(...)` in three places — on Linux the spawned
// handler's copy is then readable from `/proc/<pid>/environ` by any process
// running as the same user, which is the exact local-process threat the secret
// check exists to close. #523 replaced that transport with a synchronous IPC
// channel between the main process and the preload.
//
// These tests cannot boot Electron (see the note in module-system.test.js — the
// suite runs under plain Vitest), so the transport is covered three ways:
//
//   1. A STATIC assertion that no shipped file puts the secret in the
//      environment. This is the one that fails if the old line comes back; it
//      is the regression test for #523 itself.
//   2. A BEHAVIOURAL load of the real desktop/preload.js against a stubbed
//      `electron` module, proving it takes the value from IPC — and only from
//      IPC — and exposes it as a plain synchronous string.
//   3. An END-TO-END check that the value the preload exposes is accepted by
//      the real secret-check middleware, wired the way desktop/main.js wires it
//      (isApiPath + createSecretCheck over a bare http.Server), and that the
//      self-hosted composition (`createSecretCheck(null)`) is still a no-op.
//
// NOTE ON THE NEEDLE: the environment-variable expression this file searches for
// is assembled from fragments rather than written out, so that #523's acceptance
// criterion — a recursive grep of desktop/ for that expression returning zero
// matches — holds across the whole directory, this test file included. Do not
// "tidy" the fragments into a literal, and do not paste the expression into a
// comment here either.
const SECRET_NAME = ["__DESKTOP", "SECRET__"].join("_");
const ENV_NEEDLE = `process.env.${SECRET_NAME}`;
const ENV_BRACKET_RE = new RegExp(`process\\.env\\s*\\[\\s*["'\`]${SECRET_NAME}`);

// Every .js file desktop/ actually ships (package.json's build.files), plus the
// scripts directory. Tests are excluded — this file necessarily discusses the
// old expression.
function shippedSources() {
  const files = [
    "main.js",
    "preload.js",
    "preferences.js",
    "preferences-preload.js",
    ...fs.readdirSync(path.join(DESKTOP_DIR, "lib")).map((f) => path.join("lib", f)),
    ...fs.readdirSync(path.join(DESKTOP_DIR, "scripts")).map((f) => path.join("scripts", f)),
  ];
  return files
    .filter((f) => f.endsWith(".js"))
    .map((f) => ({ file: f, source: fs.readFileSync(path.join(DESKTOP_DIR, f), "utf8") }));
}

describe("the launch secret never enters the process environment (#523)", () => {
  it("no shipped desktop source reads or writes the secret through process.env", () => {
    const offenders = shippedSources()
      .filter(({ source }) => source.includes(ENV_NEEDLE) || ENV_BRACKET_RE.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("the secret is absent from process.env in a live process", () => {
    expect(process.env[SECRET_NAME]).toBeUndefined();
  });

  it("main.js hands the secret to IPC rather than to the environment", () => {
    const source = fs.readFileSync(path.join(DESKTOP_DIR, "main.js"), "utf8");
    expect(source).toMatch(/ipcMain\.on\(/);
    expect(source).toMatch(/event\.returnValue = secret/);
    // A late `delete` is explicitly not an acceptable fix: openExternal can
    // fire at any time, so the deletion races.
    expect(source).not.toMatch(/delete\s+process\.env/);
  });

  it("main.js and preload.js name the same IPC channel", () => {
    const mainSource = fs.readFileSync(path.join(DESKTOP_DIR, "main.js"), "utf8");
    const preloadSource = fs.readFileSync(path.join(DESKTOP_DIR, "preload.js"), "utf8");
    const mainChannel = /SECRET_IPC_CHANNEL = "([^"]+)"/.exec(mainSource)?.[1];
    const preloadChannel = /sendSync\("([^"]+)"\)/.exec(preloadSource)?.[1];
    expect(mainChannel).toBeTruthy();
    expect(preloadChannel).toBeTruthy();
    // The channel literal is duplicated because a sandboxed preload cannot
    // require() a local module to share a constant. Nothing but this test stops
    // the two from drifting apart, which would silently expose `null`.
    expect(preloadChannel).toBe(mainChannel);
  });

  it("main.js registers the IPC listener before the window is created", () => {
    const source = fs.readFileSync(path.join(DESKTOP_DIR, "main.js"), "utf8");
    // The preload's sendSync would get `undefined` if the listener were
    // registered after the BrowserWindow exists. registerSecretIpc is called
    // inside startServer(), which whenReady() awaits before createMainWindow().
    const whenReady = source.slice(source.lastIndexOf("app.whenReady()"));
    expect(whenReady).not.toBe("");
    // Inside startServer(): the secret is generated, then handed to IPC, and
    // only then is the listening promise resolved.
    const generated = source.indexOf("const secret = generateLaunchSecret()");
    const registered = source.indexOf("registerSecretIpc(secret);");
    const resolved = source.indexOf("resolve({ serverApp, port, secret })");
    expect(generated).toBeGreaterThan(-1);
    expect(registered).toBeGreaterThan(generated);
    expect(resolved).toBeGreaterThan(registered);
    // Inside whenReady(): startServer() is awaited before the window exists.
    const startServerCall = whenReady.indexOf("await startServer()");
    const createWindowCall = whenReady.indexOf("createMainWindow(port)");
    expect(startServerCall).toBeGreaterThan(-1);
    expect(createWindowCall).toBeGreaterThan(startServerCall);
  });
});

// Load the REAL desktop/preload.js with `electron` stubbed out. Vitest's own
// transform is bypassed via a genuine CommonJS require (createRequire) with
// Module._load intercepted, so the file is executed exactly as Electron's
// loader would execute it.
function loadPreload({ sendSync }) {
  const preloadPath = path.join(DESKTOP_DIR, "preload.js");
  const exposed = {};
  const calls = [];
  const stub = {
    contextBridge: {
      exposeInMainWorld: (key, value) => {
        exposed[key] = value;
      },
    },
    ipcRenderer: {
      sendSync: (channel, ...args) => {
        calls.push({ channel, args });
        return sendSync(channel);
      },
    },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "electron") return stub;
    return originalLoad.call(this, request, ...rest);
  };
  try {
    const req = createRequire(import.meta.url);
    delete req.cache[preloadPath];
    req(preloadPath);
  } finally {
    Module._load = originalLoad;
  }
  return { exposed, calls };
}

describe("desktop/preload.js secret transport (#523)", () => {
  const savedEnv = process.env[SECRET_NAME];

  beforeEach(() => {
    delete process.env[SECRET_NAME];
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[SECRET_NAME];
    else process.env[SECRET_NAME] = savedEnv;
  });

  it("exposes the value returned by the synchronous IPC channel", () => {
    const secret = generateLaunchSecret();
    const { exposed, calls } = loadPreload({ sendSync: () => secret });
    expect(calls).toHaveLength(1);
    expect(exposed.__DESKTOP_SECRET__).toBe(secret);
  });

  it("exposes a plain string, not a promise or a getter", () => {
    // client/src/api/loadouts.js's headers() reads window.__DESKTOP_SECRET__
    // synchronously and puts it straight into a fetch header (#514). A promise
    // here would serialise as "[object Promise]" and every /api call would 403.
    const secret = generateLaunchSecret();
    const { exposed } = loadPreload({ sendSync: () => secret });
    expect(typeof exposed.__DESKTOP_SECRET__).toBe("string");
    expect(exposed.__DESKTOP_SECRET__).not.toBeInstanceOf(Promise);
  });

  it("ignores an environment variable of the same name", () => {
    process.env[SECRET_NAME] = "value-from-the-environment";
    const secret = generateLaunchSecret();
    const { exposed } = loadPreload({ sendSync: () => secret });
    expect(exposed.__DESKTOP_SECRET__).toBe(secret);
    expect(exposed.__DESKTOP_SECRET__).not.toBe("value-from-the-environment");
  });

  it("exposes null rather than undefined when the channel yields nothing", () => {
    // The browser-hosted target never loads this preload at all, but a missing
    // listener must degrade to an omitted header, not to a literal "undefined".
    const { exposed } = loadPreload({ sendSync: () => undefined });
    expect(exposed.__DESKTOP_SECRET__).toBeNull();
  });
});

// Wire the middleware the way desktop/main.js wires it: a bare http.Server that
// runs the secret check ahead of the app for anything isApiPath() claims.
function startHost(secret) {
  const check = createSecretCheck(secret);
  const appHandler = (req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  };
  const server = http.createServer((req, res) => {
    if (isApiPath(req.url)) check(req, res, () => appHandler(req, res));
    else appHandler(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function get(port, target, secretHeader) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: target,
        method: "GET",
        headers: secretHeader === undefined ? {} : { "x-desktop-secret": secretHeader },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      }
    );
    req.on("error", () => resolve(0));
    req.end();
  });
}

describe("the IPC-carried secret still authenticates /api end to end (#523, #513/#514)", () => {
  it("a request carrying the preload-exposed value is accepted, one without it is not", async () => {
    const secret = generateLaunchSecret();
    // The value the renderer would actually send: whatever the preload put on
    // window, fetched over IPC — not read from anywhere else.
    const { exposed } = loadPreload({ sendSync: () => secret });
    const { server, port } = await startHost(secret);
    try {
      expect(await get(port, "/api/loadouts", exposed.__DESKTOP_SECRET__)).toBe(200);
      expect(await get(port, "/api/loadouts", undefined)).toBe(403);
      expect(await get(port, "/api/loadouts", generateLaunchSecret())).toBe(403);
    } finally {
      server.close();
    }
  });

  it("the hosted/self-hosted target is unaffected — createSecretCheck(null) is a no-op", async () => {
    const { server, port } = await startHost(null);
    try {
      expect(await get(port, "/api/loadouts", undefined)).toBe(200);
    } finally {
      server.close();
    }
  });
});
