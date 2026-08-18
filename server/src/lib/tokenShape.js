// Governing: SPEC-0003 § "Authentication and Authorization" — "The system SHALL
// generate tokens with sufficient entropy that they are not guessable, and SHALL
// NOT accept tokens that are not token-shaped, per the existing normalization
// rules." Found by `/sdd:audit` 2026-08-17: the boot-time quarantine (db.js) and
// the request-time acceptance gate (lib/ownership.js's `callerToken`) each had
// their own copy of this rule, and only the quarantine actually enforced it — a
// caller sending a non-token-shaped value got real 201s and reads for the life of
// the process, and only lost the records to the legacy quarantine on the next
// restart. One definition, imported by both, closes that gap the same way
// lib/ownership.js's own header comment already argues for the ownership
// primitives: "a divergence here is a cross-user data leak."
//
// Client tokens are either a UUID (crypto.randomUUID) or "t-" + rng (the client
// fallback); per-request anonymous identities are "request-scoped:<uuid>".
//
// The whole pattern is wrapped in `^(?:...)$` rather than three separately-anchored
// alternatives — the previous form anchored only at the start (`^(?=...)`, a
// zero-width lookahead) and left the `[tT]-[A-Za-z0-9]{10,}` branch with no `$`,
// so anything with a token-shaped PREFIX passed regardless of what followed:
// `t-aaaaaaaaaaEVIL/../` satisfied `{10,}` on its first ten characters and was
// never required to match to the end of the string. Anchoring the whole
// alternation requires an exact match, top to bottom.
export const TOKEN_SHAPED_OWNER = /^(?:[a-f0-9-]{36}|[tT]-[A-Za-z0-9]{10,}|request-scoped:[a-f0-9-]{36})$/;
