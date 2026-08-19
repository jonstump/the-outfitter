import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getLoadouts } from "./loadouts";

// Governing: SPEC-0005 REQ "Authenticated Loopback Boundary", issue #513.
//
// Regression test for the bug reported as "nothing saves" against the packaged
// desktop app: desktop/preload.js exposes the launch secret as
// window.__DESKTOP_SECRET__, but nothing in client/ ever read it, so every
// request from the real app was missing the X-Desktop-Secret header the
// desktop host's auth boundary (desktop/main.js) requires — a 403 on every
// call, including the initial load. This was never caught by testing the
// server-side half of the boundary in isolation (see
// server/src/app-export.test.js), because that half was never broken; only
// the client's failure to attach the header was.
describe("loadouts API attaches the desktop launch secret when present (regression, issue #513)", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    );
  });

  afterEach(() => {
    global.fetch = realFetch;
    delete window.__DESKTOP_SECRET__;
  });

  it("sends x-desktop-secret when window.__DESKTOP_SECRET__ is set (desktop target)", async () => {
    window.__DESKTOP_SECRET__ = "test-secret-value";

    await getLoadouts();

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers["x-desktop-secret"]).toBe("test-secret-value");
  });

  it("omits x-desktop-secret when window.__DESKTOP_SECRET__ is absent (browser-hosted target)", async () => {
    await getLoadouts();

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers["x-desktop-secret"]).toBeUndefined();
  });
});
