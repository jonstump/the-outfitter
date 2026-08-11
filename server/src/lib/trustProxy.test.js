import { describe, expect, it } from "vitest";
import express from "express";
import { trustProxySetting } from "./trustProxy.js";

// Governing: issue #199 (`trust proxy 1` believes `X-Forwarded-*` from any peer)
//
// Two things are being pinned here, and only the second is really about parsing.
//
// The first is the DEFAULT: with nothing configured, the server must not believe a
// forwarded header from whoever happened to connect. That is the whole bug — a hop count
// compiles to a predicate that never reads the peer address, so on a deploy with no proxy
// it trusts a header the client wrote.
//
// The second is that the values an operator will actually type reach express as the TYPE
// express needs. It does not parse the setting, it switches on the type: `"1"` is not `1`
// (proxy-addr tries to compile it as an IP address and throws), and `"false"` is a
// non-empty string, which is truthy. Both are checked against express's real compiled
// predicate rather than against the return value alone, because the return value is only
// interesting insofar as express agrees with it.

/** The predicate express itself compiles for a setting — `trust(peerAddress, hopIndex)`. */
function compiled(setting) {
  const app = express();
  app.set("trust proxy", setting);
  return app.get("trust proxy fn");
}

describe("trustProxySetting", () => {
  it("defaults to trusting no peer when TRUST_PROXY is unset", () => {
    expect(trustProxySetting({})).toBe(false);

    // The assertion that matters: a direct client is NOT a trusted proxy. `clientFacingHost`
    // in index.js calls the predicate exactly this way, and the limiters' `req.ip` resolves
    // through the same gate.
    const trust = compiled(trustProxySetting({}));
    expect(trust("203.0.113.9", 0)).toBe(false);
    expect(trust("127.0.0.1", 0)).toBe(false);
  });

  it("treats an empty or whitespace-only value as unset", () => {
    expect(trustProxySetting({ TRUST_PROXY: "" })).toBe(false);
    expect(trustProxySetting({ TRUST_PROXY: "   " })).toBe(false);
  });

  it("reads a disabling boolean as a boolean, not as a truthy string", () => {
    expect(trustProxySetting({ TRUST_PROXY: "false" })).toBe(false);
    expect(trustProxySetting({ TRUST_PROXY: "FALSE" })).toBe(false);
  });

  // The asymmetry with "false" above is the point, so it is pinned rather than left to the
  // docblock. Boolean `true` is express's most permissive setting — it trusts every peer at
  // every hop, which is strictly worse than the hardcoded `1` this module replaced — and for
  // a variable named TRUST_PROXY it is the most guessable thing an operator could type. It
  // must fail loudly instead of silently disarming the limiters.
  it("refuses to turn the most guessable input into the most permissive setting", () => {
    expect(() => compiled(trustProxySetting({ TRUST_PROXY: "true" }))).toThrow(
      /invalid IP address: true/i
    );

    // What that would have meant, had it been accepted: a direct client believed at hop 0.
    expect(compiled(true)("203.0.113.9", 0)).toBe(true);

    // Saying yes is done by naming the proxy, which is checked against the peer.
    const trust = compiled(trustProxySetting({ TRUST_PROXY: "loopback" }));
    expect(trust("127.0.0.1", 0)).toBe(true);
    expect(trust("203.0.113.9", 0)).toBe(false);
  });

  it("reads a hop count as a number, which express compiles rather than rejecting", () => {
    expect(trustProxySetting({ TRUST_PROXY: "1" })).toBe(1);
    expect(trustProxySetting({ TRUST_PROXY: " 2 " })).toBe(2);
    // As a string this throws "invalid IP address: 1" at boot, which is the shape of
    // misconfiguration this conversion exists to prevent.
    expect(() => compiled(trustProxySetting({ TRUST_PROXY: "1" }))).not.toThrow();
  });

  it("passes an address, a CIDR or a named range through to proxy-addr", () => {
    expect(trustProxySetting({ TRUST_PROXY: "loopback" })).toBe("loopback");
    expect(trustProxySetting({ TRUST_PROXY: "10.0.0.0/8, loopback" })).toBe("10.0.0.0/8, loopback");

    // This is the form the docs recommend, and the reason it is recommended: the compiled
    // predicate inspects the PEER, so a direct client is refused while the named proxy is not.
    const trust = compiled(trustProxySetting({ TRUST_PROXY: "10.0.0.0/8" }));
    expect(trust("10.1.2.3", 0)).toBe(true);
    expect(trust("203.0.113.9", 0)).toBe(false);
  });

  it("leaves an unparseable value to fail loudly at boot rather than guessing", () => {
    // Fail-fast beats a silent downgrade in either direction: trusting nothing would break
    // a real proxy deploy invisibly, and trusting everything is the bug being fixed.
    expect(() => compiled(trustProxySetting({ TRUST_PROXY: "not-an-address" }))).toThrow();
  });

  it("reads process.env when no environment is passed", () => {
    const original = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = "loopback";
    try {
      expect(trustProxySetting()).toBe("loopback");
    } finally {
      if (original === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = original;
    }
  });
});
