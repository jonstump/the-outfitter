// Governing: SPEC-0005 REQ "Authenticated Loopback Boundary", issues #517, #526.
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
// ---------------------------------------------------------------------------
// TWO REQUEST-TARGET FORMS, AND WHY THE PARSING IS HAND-ROLLED
// ---------------------------------------------------------------------------
//
// ABSOLUTE-FORM (#526). RFC 9112 §3.2.2 allows a client to send the whole URI
// on the request line — `GET http://127.0.0.1:1234/api/loadouts HTTP/1.1` — and
// says servers MUST accept it. Node's parser does, and puts the entire absolute
// URI in `req.url`. Express's `parseurl` takes the pathname out of it and routes
// normally, so `/api/loadouts` is reached; but a predicate that only looks for a
// leading `/api` sees a string starting `http://` and says "not an API path".
// That was the review finding on the #517 fix: the case-variant vector closed
// while an equivalent one stayed open, again reaching lowdb unauthenticated
// (verified end-to-end against the real server app: GET 200, POST 201 and
// persisted). Hence the scheme/authority strip below. Browsers do not emit
// absolute-form, so this was never a drive-by web vector — but any other local
// process can, and local processes are precisely what the launch secret exists
// to keep out (see `secretCheck.js`: binding 127.0.0.1 is not sufficient).
//
// WHY NOT `new URL()` — the real reason, which is not the one #517 first gave.
// The original note here argued that `new URL("//api/x", base)` reads `api` as a
// HOST and yields `/x`. That is true, but it is not a gap: Express does not route
// `//api/x` to an `/api` mount either, so both answer false and they agree.
//
// The actual disqualifier is DOT-SEGMENT NORMALIZATION. Express matches a mount
// against the RAW pathname `parseurl` hands it and never resolves `..`, so
// `/api/loadouts/../..` still prefix-matches `/api/loadouts` and IS routed.
// `new URL()` is required by WHATWG to normalize, collapsing that same string to
// `/` — which returns false for a request Express routes. Measured against a real
// Express app, swapping this predicate for a `new URL()` one reopens the
// vulnerability on four probes, among them:
//
//     /api/loadouts/../..        Express: routed     new URL(): /      -> BYPASS
//     /api/loadout-lists/../..   Express: routed     new URL(): /      -> BYPASS
//     /api/loadouts/%2e%2e/..    Express: routed     new URL(): /      -> BYPASS
//
// So the parsing here is deliberately literal: strip an absolute-form prefix if
// one is present, cut the query and fragment, lowercase, and compare. No
// normalization, no percent-decoding, no host parsing — nothing that could move a
// path OUT of `/api` that Express would still route INTO it. `desktop/tests/
// apiPath.test.js` pins all of this against a live Express app, including the
// dot-segment cases above, so a future simplification to `new URL()` fails loudly
// instead of silently reopening #517.

/**
 * @param {unknown} rawUrl — `req.url` as Node provides it. Usually an origin-form
 *   request target (`/api/loadouts?x=1`), but may be absolute-form
 *   (`http://host/api/loadouts?x=1`) — RFC 9112 §3.2.2 permits it and Node passes
 *   it through unchanged.
 * @returns {boolean} true when the request must present the launch secret.
 */
function isApiPath(rawUrl) {
  if (typeof rawUrl !== "string") return false;

  let target = rawUrl;

  // Absolute-form: drop `scheme://authority`, keeping the path onward. The
  // authority runs to the first `/` after `://`; if there is none the target
  // addresses the origin root (`http://host`, `http://host?x=1`), which is not
  // an API path. Matching the scheme case-insensitively matters as much here as
  // the path case does — `HTTP://host/API/loadouts` is the same request.
  const scheme = /^[a-z][a-z0-9+\-.]*:\/\//i.exec(target);
  if (scheme) {
    const pathStart = target.indexOf("/", scheme[0].length);
    target = pathStart === -1 ? "/" : target.slice(pathStart);
  }

  const pathname = target.split("?")[0].split("#")[0].toLowerCase();
  return pathname === "/api" || pathname.startsWith("/api/");
}

module.exports = { isApiPath };
