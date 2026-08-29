// Governing: SPEC-0005 REQ "Authenticated Loopback Boundary", issue #517.
//
// Decides whether a raw request URL addresses the API surface, and therefore
// whether the launch-secret check must run before the request reaches a router.
//
// This lives in its own module for one reason: it is the predicate that decides
// whether authentication happens at all, and until #517 it lived inline in
// `desktop/main.js` where nothing could unit-test it. `desktop/main.js` needs a
// running Electron app to exercise, so the predicate was effectively untested
// while `secretCheck.js` — the thing it guards — had nine tests of its own. The
// hole was in the caller, not the check.
//
// THE INVARIANT: this predicate MUST match a SUPERSET of what Express routes.
//
// `server/src/index.js` mounts `/api/loadouts`, `/api/loadout-lists` and
// `/api/hunter-favorites`, and never sets `case sensitive routing`. Express's
// default is case-INSENSITIVE, so it happily routes `/API/loadouts` — while the
// original hand-rolled `req.url.startsWith("/api/")` did not, because
// `String.prototype.startsWith` is case-sensitive. That gap was an
// unauthenticated read and write against the loopback API (#517): `GET
// /API/loadouts` returned 200, and `POST /API/loadouts` returned 201 and
// persisted to lowdb.
//
// Being more permissive than Express is safe here (a non-API path that gets
// needlessly secret-checked still reaches `serverApp` once the header is
// present, and the renderer sends it on every request). Being LESS permissive
// is the bug. When changing this, run the differential test in
// `desktop/tests/apiPath.test.js`, which asserts the superset property against
// a real Express app rather than against an assumption about Express.
//
// Why a string split rather than `new URL(...)`: `parseurl`, which Express uses
// internally, extracts the pathname without resolving `.`/`..` and without
// treating a leading `//` as a protocol-relative authority. `new URL("//api/x",
// base)` parses `api` as the HOST and yields pathname `/x` — which would make
// this predicate return false for a string Express sees as `//api/x`. Mirroring
// Express's own cheap extraction keeps the two in agreement.

/**
 * @param {unknown} rawUrl — `req.url` as Node provides it (an origin-form
 *   request target such as `/api/loadouts?x=1`).
 * @returns {boolean} true when the request must present the launch secret.
 */
function isApiPath(rawUrl) {
  if (typeof rawUrl !== "string") return false;
  const pathname = rawUrl.split("?")[0].split("#")[0].toLowerCase();
  return pathname === "/api" || pathname.startsWith("/api/");
}

module.exports = { isApiPath };
