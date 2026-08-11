// Governing: issue #199 (`trust proxy 1` believes `X-Forwarded-*` from any peer),
// SPEC-0003 REQ "Rate Limiting" (the budgets this setting decides the key for)
//
// What the server is willing to believe about who a request came from, as a deployment
// decision rather than a constant in the source.
//
// The setting used to be a hardcoded `app.set("trust proxy", 1)`. Express compiles a
// NUMBER to a hop-count predicate that never looks at the peer at all
// (express@4.21.2, lib/utils.js:223-226):
//
//     if (typeof val === 'number') {
//       return function(a, i){ return i < val };   // `a` — the address — is never read
//     }
//
// That is correct when a proxy is genuinely in front: express counts from the right of
// `X-Forwarded-For` and lands on the address the proxy appended. It is meaningless when
// nothing is in front, because then the header is written by the client and believed
// anyway. Two of the three topologies this repo documents have no proxy —
// `docker-compose.yml` publishes the container port straight to the host, and the
// `Procfile` single-VM run has nothing between the process and the internet — and in
// those, a client rotating `X-Forwarded-For` per request lands in a fresh rate-limit
// bucket every time, which defeats both limiters entirely (see lib/ownership.js, and
// issue #198 for what an unbounded write budget then costs).
//
// So the default is `false`: a direct-exposure deploy believes nothing it is told about
// forwarding. An operator who has a proxy in front says so with TRUST_PROXY, and is
// encouraged by .env.example to name the proxy's address rather than a hop count —
// express compiles a string to a predicate that genuinely inspects the peer, which is
// what makes clientFacingHost()'s existing trust gate in index.js correct as written.

/**
 * Resolve TRUST_PROXY into a value `app.set("trust proxy", ...)` understands.
 *
 * The variable arrives as a string, and express distinguishes types rather than parsing:
 * `"1"` is not the number 1 (it is compiled as an IP list, and `proxy-addr` throws on it),
 * and `"false"` is a non-empty string, which would be truthy. Both are values an operator
 * will reasonably write, so both are converted here rather than at the call site.
 *
 * `"true"` is deliberately NOT converted, and it is the one asymmetry here worth stating.
 * Boolean `true` is express's most permissive setting: it compiles to a predicate that
 * returns true for every peer at every hop, so it would trust `X-Forwarded-*` from a direct
 * client — strictly worse than the hardcoded `1` this module replaced, and the exact
 * property issue #199 is about. `express-rate-limit` classifies it as
 * ERR_ERL_PERMISSIVE_TRUST_PROXY ("allows anyone to trivially bypass IP-based rate
 * limiting") but only logs, so nothing downstream would stop it. Left unconverted it falls
 * through to `proxy-addr` and throws `invalid IP address: true` at boot, which is the
 * outcome an operator who typed it deserves: for a variable named TRUST_PROXY, `true` is
 * the most guessable input there is, and guessing it should not silently disarm the
 * limiters. Naming the proxy is how you say yes.
 *
 * Anything else is passed through verbatim: `"loopback"`, `"uniquelocal"`, an address, a
 * CIDR, or a comma-separated list of those. Express hands them to `proxy-addr`, which
 * THROWS at boot on something it cannot parse. That is deliberate and left alone — a
 * typo'd proxy address should stop the process with a named error, not quietly downgrade
 * to trusting everything or nothing.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {boolean | number | string}
 */
export function trustProxySetting(env = process.env) {
  const raw = (env.TRUST_PROXY ?? "").trim();
  if (raw === "") return false;
  if (raw.toLowerCase() === "false") return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}
