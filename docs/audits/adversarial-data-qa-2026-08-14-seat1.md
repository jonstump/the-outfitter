# Adversarial Data QA Panel — Seat 1 filing

**Charge:** Persistence and the wire format — the bare-index ammo encoding, `FORMAT_VERSION`, the
frozen `LEGACY_*_IDS` tables, id retirement, and codec round-trips.

**Date:** 2026-08-14 · **Round:** 1 (independent) · **Repo HEAD:** `7a7e772`

**Counts:** 1 × P0, 4 × P2, 5 × P3. Ten findings, all `CONFIRMED`. No `SUSPECTED` findings — every
claim below is backed by a file+line or a runnable command, per the honesty rule.

---

## Method and its limits

### Was huntshowdown.wiki.gg reachable? No.

```
$ curl -sS -o /dev/null -w '%{http_code}\n' https://huntshowdown.wiki.gg/wiki/Nagant_M1895
curl: (56) CONNECT tunnel failed, response 403
$ curl -sS -o /dev/null -w '%{http_code}\n' https://huntshowdown.wiki.gg/
curl: (56) CONNECT tunnel failed, response 403
```

I was in the blocked case. **Every game number in this filing is therefore read out of a committed
file in this repo or out of git history, never from the wiki and never from memory.** Where I quote
an ammo price I cite the `catalog.js` line or the historical blob it came from. I make no claim
anywhere that a price is right *in the game* — my charge does not need that claim, because a
wire-format defect is a disagreement between the app and its own past, which is fully decidable from
the artifacts.

This is the load-bearing limit on the filing: **I can prove that a saved loadout decodes to a
different round than it was saved as, and I cannot prove which of the two rounds the game actually
sells.** Findings F1 and F2 are stated in exactly those terms.

### The git history in the working tree is shallow — I had to recover the rest

The checkout at `/home/user/the-outfitter` is a **shallow clone grafted at `4e5d239` (2026-08-12)**:

```
$ cat .git/shallow
4e5d239e033813bbf3407995d3651782e42e463e
$ git log --oneline | wc -l
52
$ git cat-file -t 2a6bd05
fatal: Not a valid object name 2a6bd05
```

`git log -p -- client/src/data/catalog.js` — the first question my charge asks — returns 8 commits
in this checkout, and `2a6bd05` and `e0076d3`, the two commits the codec's own comments cite as the
provenance of the frozen tables, are **not present**. A seat that ran the charge's first bullet
against this checkout would have concluded "no historical AMMO edits" from a history that begins
after every one of them.

I recovered the full history into an **isolated bare mirror in scratch space**, leaving the panel's
shared working tree untouched:

```
git clone --bare https://github.com/jonstump/the-outfitter /tmp/.../scratchpad/fullhist.git
# 277 commits, vs 52 in the working tree; 26 of them touch catalog.js, vs 8
```

All history claims below are against that mirror. Any seat re-running my commands against the
working-tree `.git` will get different (truncated) answers — that is the clone, not a disagreement.

### Test baseline

Node in this environment is v22.22.2; the repo pins `^20` with `engine-strict=true` (`.npmrc`), so a
plain `npm install` fails `EBADENGINE` and `npm test` dies with `vitest: not found`. I installed with
`--engine-strict=false` (touches `node_modules` only, which is gitignored).

The real baseline is **green**:

| Suite | Result |
|---|---|
| client (`vitest run`) | 33 files, **759 passed** |
| server (`vitest run`) | 7 files, **161 passed, 1 skipped** |
| scrape (`node --test`) | 13 suites, **321 passed** |

**Caveat, and it matters for the other seats:** my first `npm test` showed **139 server failures**,
all `SyntaxError: Unexpected non-whitespace character after JSON at position 329`. That is not a repo
defect. `server/data/db.test.json` is gitignored scratch state that the server suite writes, and five
seats running `npm test` concurrently in one working tree corrupt it for each other. Re-running with
a private store made the suite green:

```
cd server && OUTFITTER_DB_FILE=/tmp/.../db.seat1.json npx vitest run   # 161 passed
```

If another seat files "the server suite is red," it is this. It is a panel artifact.

### What I did not do

- Did not run the scrapers, and did not modify `catalog.js`, `itemStats.json`, `data/hunters.json`,
  or any source or test file. My only writes are this file and scratch files outside the repo.
- Did not read any other seat's filing.
- Did not exercise the codec in a browser. Everything below runs the real modules under Node; the
  two places that depend on browser globals (`btoa`, `localStorage`) I tested against Node's own
  `btoa`, which implements the same Latin-1 restriction as the DOM one (F5).
- **I cannot see items missing from the catalog entirely.** Noted in the prompt as unassigned by
  design; it is a blind spot of this review, not a clean result.

### Confidence in the negative results

The negative results in this filing are unusually strong, because most of my charge is decidable by
exhaustion rather than by sampling. I reconstructed `catalog.js` at all 26 commits that touch it,
diffed each against its **true first parent** (an earlier date-ordered walk gave wrong answers
because `5230e57` is a merge and the branches interleave), and decoded every legacy array position
through the live decoder. Where I say "clean," I mean I enumerated the whole space, and the command
is included so a challenger can re-enumerate it.

---

## Findings

### F1 — P0 — A saved Frontier 73C ammo selection decodes to a different round than it was saved as

**Where:** `client/src/data/catalog.js:132` (`ammoClass` is now `compact`); the change landed in
`e9b2c1d` (2026-08-10). Decoders: `client/src/utils/loadoutCodec.js:51` (`boundedAmmo`), `:111`
(`fromV1`), `:342` (`fromLegacy`). Disclosure comment: `catalog.js:118–131`.

**Status:** `CONFIRMED`.

**Evidence.** `frontier-73c` is the only weapon in the repo's whole history whose `ammoClass` moved
between two *non-empty* pools:

```
$ git --git-dir=fullhist.git show e9b2c1d^:client/src/data/catalog.js | grep '"frontier-73c"'
  ["frontier-73c", "Frontier 73C", 3, 72, "medium", "Rifles"],
$ grep -n '"frontier-73c", "Frontier 73C"' client/src/data/catalog.js
132:  ["frontier-73c", "Frontier 73C", 3, 41, "compact", "Rifles"],
```

The two pools, read from `catalog.js:47–48`, differ at index 1 and only at index 1 by name:

```
medium : [FMJ 22] [Spitzer 60] [Dumdum 28] [Incendiary 24] [Poison 21]
compact: [FMJ 15] [High Velocity 13] [Dumdum 22] [Incendiary 18] [Poison 16]
```

Both are length 5, so `boundedAmmo` (`loadoutCodec.js:51`) — which bounds `a` against the pool the
weapon draws from *today* — accepts index 1 and cannot see that it now means something else.

I reconstructed the records the app would actually have written at each era and decoded them with
today's codec (`scratchpad/timemachine.mjs`; reproduced below in condensed form):

```
$ node --input-type=module -e '
import { fromData } from "./client/src/utils/loadoutCodec.js";
import { WEAPONS, AMMO } from "./client/src/data/catalog.js";
const show = d => { const w = d.weapons[0];
  return w ? WEAPONS[w.i][1] + " / " + JSON.stringify((AMMO[WEAPONS[w.i][4]]||[])[w.a] ?? "none") : "dropped"; };
// legacy record: weapon position 20 == Frontier 73C, ammo index 1 == Spitzer $60 at the time
console.log("legacy  :", show(fromData({ w: [[20, 1], null], e: [], tr: [], n: "", b: 0 })));
// v1 record: same weapon by id, same ammo index
console.log("v1      :", show(fromData({ v: 1, w: [["frontier-73c", 1], null], e: [], tr: [], n: "", b: 0 })));'

legacy  : Frontier 73C / ["High Velocity",13]
v1      : Frontier 73C / ["High Velocity",13]
```

That legacy position is not a guess. The pre-versioning catalog is recoverable, and position 20 is
Frontier 73C at `medium`:

```
$ git --git-dir=fullhist.git show 2a6bd05^:client/src/data/catalog.js | grep -n 'Frontier 73C'
  ["Frontier 73C", 3, 72, "medium", "Rifles"],     # 21st entry -> index 20
```

`FORMAT_VERSION` was **1 before and after** the change — the bump to 2 came a full three days later,
at `0f4f5b1`, for the equipment grid:

```
$ for c in e9b2c1d^ e9b2c1d 0f4f5b1; do git --git-dir=fullhist.git show $c:client/src/utils/loadoutCodec.js | grep -m1 FORMAT_VERSION; done
export const FORMAT_VERSION = 1;
export const FORMAT_VERSION = 1;
export const FORMAT_VERSION = 2;
```

**Player-facing consequence.** A player who saved a Frontier 73C build with the index-1 round before
2026-08-10 opens it today and the ammo line reads a different round at a different price. Nothing
errors; the cost total just changes. (Indices 0, 2, 3 and 4 keep the same round *name* across the two
pools but at the other pool's price — that half is arguably now correct rather than wrong, since the
weapon genuinely draws from `compact` today. Index 1 is the one where the round itself changes.)

**Why this is still a live finding despite being disclosed.** `catalog.js:123–131` documents the cost
and calls it accepted, so the *existence* of the hazard is not news. Two things about it are:

1. **The legacy half is deterministically fixable and was never fixed.** Every legacy (unversioned)
   record was written before `2a6bd05` (2026-08-09), which is strictly before the ammoClass change
   (`e9b2c1d`, 2026-08-10). So a legacy record at weapon position 20 with `a === 1` *unambiguously*
   meant Spitzer — there is no era ambiguity to resolve. `fromLegacy` could remap it and does not.
2. **The v1 half is now permanently unfixable, and the one chance to discharge it was spent.** The v1
   era (2026-08-09 → 2026-08-13) straddles the change, so a `v: 1` record carrying
   `["frontier-73c", 1]` is genuinely ambiguous — it may mean Spitzer or High Velocity and the record
   does not say which. The window in which a bump could have disambiguated closed at `e9b2c1d`
   itself. The v1→v2 lift at `0f4f5b1` was the last structural opportunity to at least *record* the
   ambiguity, and `fromV1` passes the index straight through `boundedAmmo` with no remap.

**Fix direction (not a patch).** Add an era-scoped ammo remap beside `RETIRED_WEAPON_ALIASES` —
declaring, per weapon id, the pool a *legacy* record's index was written against — and apply it in
`fromLegacy` only, mapping by round **name** into the current pool and falling to `-1` (no selection)
when the name has no counterpart, which is the case for Spitzer in `compact`. Deliberately dropping
the selection is better than silently selling the player a different round. Leave `fromV1` alone and
instead record the v1 ambiguity in the codec header as a known, closed-off defect, so the next
reviewer does not spend the effort I just spent rediscovering that it is unfixable.

---

### F2 — P2 — A saved Dolch 96 / Nitro Express ammo selection is silently discarded on load

**Where:** `client/src/data/catalog.js:64` (`special: []`), the `dolch-96` and `nitro-express` rows;
change landed in `077e747` (2026-08-09). `loadoutCodec.js:51` (`boundedAmmo`).

**Status:** `CONFIRMED`.

**Evidence.** Two weapons moved from a populated pool to the empty `special` pool in the same commit:

```
$ node scratchpad/pairdiff.mjs | sed -n '/077e747/,/^$/p'
### 077e747 (2026-08-09) Fix stale catalog data and complete missing rosters (Update 2.8 era)
  AMMO.special ADDED (0 entries) — new pool, safe
  *** ammoClass CHANGED: dolch-96: compact(len 5) -> special(len 0) ***
  *** ammoClass CHANGED: nitro-express: long(len 4) -> special(len 0) ***
```

`FORMAT_VERSION` was 1 at `077e747` and stayed 1 (same trace as F1). Decoding the records that era
would have written:

```
legacy [14] Dolch 96      a=0..4  ->  Dolch 96 / NO VARIANT (a=-1)     (was compact: FMJ..Poison)
legacy [36] Nitro Express a=0..3  ->  Nitro Express / NO VARIANT (a=-1) (was long: FMJ..Incendiary)
v1     dolch-96           a=0..4  ->  NO VARIANT
v1     nitro-express      a=0..3  ->  NO VARIANT
```

**Player-facing consequence.** The saved ammo choice vanishes and the loadout's total cost drops by
whatever that round cost. The player is not shown that anything was removed.

**Why P2 and not P0.** The selection is *dropped*, not re-pointed at a different round, and the pool
is empty because — per the comment at `catalog.js:55–63` — those rounds are not purchasable with Hunt
Dollars, so charging nothing is plausibly the correct answer now. I am explicitly **not** claiming
the game does or does not sell them; I cannot check that with the wiki blocked. Note also that this
was a genuine P0 (a hard crash, issue #201) until `90c0458` added `boundedAmmo`; what remains is the
residue that the mitigation converts it to.

**Fix direction.** Nothing to change in the codec — `boundedAmmo` is doing the right thing. The gap
is that the loss is silent: surface a one-time "this build's ammo selection is no longer available"
notice on decode when `a` was in range for the record and is out of range now, rather than letting
the cost line change with no explanation.

---

### F3 — P2 — Both decoders admit duplicate trait ids, and upgrade points are charged per copy

**Where:** `client/src/utils/loadoutCodec.js:75` (`boundedTraits`), applied at `:146` (`fromV1`),
`:383` (`fromLegacy`), `:431` (`fromV2`). Consequence at `client/src/utils/calc.js:138` (`upTotal`).
Server counterpart: `server/src/routes/loadouts.js:113`.

**Status:** `CONFIRMED`.

**Evidence.** `boundedTraits` slices to `TRAIT_MAX` but never dedupes:

```
$ node --input-type=module -e '
import { fromData } from "./client/src/utils/loadoutCodec.js";
import { upTotal, TRAIT_MAX } from "./client/src/utils/calc.js";
import { TRAITS } from "./client/src/data/catalog.js";
const d = fromData({ v:2, w:[null,null], e:Array(8).fill(null), tr:Array(40).fill("quartermaster"), n:"", b:[] });
console.log("length", d.traits.length, "distinct", new Set(d.traits).size,
            "| quartermaster up =", TRAITS.find(t=>t[0]==="quartermaster")[2], "| upTotal =", upTotal(d));'
length 15 distinct 1 | quartermaster up = 8 | upTotal = 120
```

The legacy decoder does the same (`tr: Array(40).fill(0)` → 15 copies, `upTotal` 120). The
interactive path does **not**: `loadoutSlice.js` `addTrait` guards with
`if (!state.traits.includes(action.payload))`. So the manual UI can neither create this state nor
repair it — a decoded duplicate list simply persists.

The server does not catch it either. `loadouts.js:113` checks `data.tr.length > MAX_TRAITS` but never
distinctness — note that four lines further down, at `:122`, it *does* check distinctness for `b`
(`new Set(data.b).size !== data.b.length`). The wire format's two validators disagree about whether
repetition is legal, and the one that permits it is the one guarding the number the player sees.

**Player-facing consequence.** A share URL or stored record carrying repeats shows an inflated
upgrade-point total (15 × Quartermaster reads as 120 UP), and burns trait slots on one trait. With
the UP budget toggle on, the app refuses additions the game would allow.

**Reachability, stated honestly.** I could not find an in-app writer that produces duplicates; the
reachable doors are a hand-edited `#L=` fragment, a hand-edited `localStorage` record, or a POST from
a non-browser client, all of which the server currently accepts and stores. That is why this is P2
and not P1 — but the asymmetry with the `b` check on the adjacent line is hard to read as deliberate.

**Fix direction.** Dedupe inside `boundedTraits` — before the slice, so the cap counts fifteen
*distinct* traits — and mirror the server's existing `b` distinctness check onto `tr`. Doing it in
`boundedTraits` gets all three decoders at once, which is the reason that function exists.

---

### F4 — P2 — An unrecognised `v` falls through to the legacy index-based decoder

**Where:** `client/src/utils/loadoutCodec.js:444–457` (`DECODERS`, `fromData`).

**Status:** `CONFIRMED`.

**Evidence.** `fromData` picks the decoder whose `v` matches, and otherwise takes the `v: null`
entry — which is `fromLegacy`, the one decoder that reads item references as **array positions into
the frozen 2026-08-09 tables**:

```js
const decoder = DECODERS.find((x) => x.v !== null && d.v === x.v) || DECODERS.find((x) => x.v === null);
```

So a version *newer* than this build knows about is decoded by the *oldest* format:

```
$ node --input-type=module -e '
import { fromData } from "./client/src/utils/loadoutCodec.js";
import { WEAPONS } from "./client/src/data/catalog.js";
const rec = { v:2, w:[["nagant-m1895",2],["romero-77",1]], e:Array(8).fill(null), tr:["quartermaster"], n:"My Build", b:[] };
for (const v of [2,3,99,"2"]) { const o = fromData({...rec, v});
  console.log(`v=${JSON.stringify(v)}`.padEnd(9), "->",
    JSON.stringify({ weapons:o.weapons.map(w=>w?WEAPONS[w.i][1]:null), traits:o.traits, name:o.name })); }'
v=2       -> {"weapons":["Nagant M1895","Romero 77"],"traits":["quartermaster"],"name":"My Build"}
v=3       -> {"weapons":[null,null],"traits":[],"name":"My Build"}
v=99      -> {"weapons":[null,null],"traits":[],"name":"My Build"}
v="2"     -> {"weapons":[null,null],"traits":[],"name":"My Build"}
```

Everything is silently discarded **except the name**, so the result looks like a successfully loaded,
deliberately-empty build rather than a failure. And the fallback does not merely drop — it will
*fabricate* a loadout from any numeric reference a future format happens to carry, which is precisely
the class of bug issue #26 created the version envelope to eliminate:

```
$ node --input-type=module -e '
import { fromData } from "./client/src/utils/loadoutCodec.js";
import { WEAPONS, AMMO } from "./client/src/data/catalog.js";
const o = fromData({ v:3, w:[[20,1],null], e:[["T",1]], tr:[0], n:"x", b:0 });
const w = o.weapons[0];
console.log(WEAPONS[w.i][1], JSON.stringify(AMMO[WEAPONS[w.i][4]][w.a]), o.traits);'
Frontier 73C ["High Velocity",13] [ 'quartermaster' ]
```

**Player-facing consequence.** Share URLs are permanent and this is a cached SPA. The moment
`FORMAT_VERSION` becomes 3, every client that has not picked up the new bundle will decode a v3 share
link into an empty loadout carrying the right *name* — and because the store subscriber persists a
decoded loadout (`store/index.js:26` → `writeStoredLoadout`), opening one such link overwrites the
reader's stored build with the empty result. The codec's own header comment at `:441–443` reasons
carefully about *older* records reaching a newer client and is silent on the reverse.

**Fix direction.** Make the fallback explicit rather than positional: route `v` values that are
absent-or-legacy to `fromLegacy`, and route a recognised-but-unknown *higher* `v` somewhere else —
either the newest known decoder (best-effort, since a bump is likely additive) or a distinguishable
"cannot decode" result that `readHashLoadout`/`readStoredLoadout` can turn into a message instead of
an empty grid. The current ordering makes "unknown" and "ancient" the same case, and they are not.

---

### F5 — P2 — Sharing a loadout whose name contains a non-Latin-1 character throws

**Where:** `client/src/utils/loadoutCodec.js:518–526` (`encodeShareUrl`), called from
`client/src/store/thunks.js:61` (`shareThunk`). Name input: `client/src/components/ActionsPanel/ActionsPanel.jsx:115`.

**Status:** `CONFIRMED`.

**Evidence.** `encodeShareUrl` does `btoa(JSON.stringify(toData(loadout)))` on line 519. `btoa` only
accepts Latin-1. The `try` block in that function wraps `history.replaceState` — **not** the `btoa`
call — so the exception escapes:

```
$ node --input-type=module -e '
import { toData, emptyLoadout } from "./client/src/utils/loadoutCodec.js";
for (const n of ["Plain ASCII","Café","Loadout \u{1F525}","日本"]) {
  try { btoa(JSON.stringify(toData({...emptyLoadout(), name:n}))); console.log(JSON.stringify(n).padEnd(20), "ok"); }
  catch (e) { console.log(JSON.stringify(n).padEnd(20), "THROWS", e.name + ": " + e.message); } }'
"Plain ASCII"        ok
"Café"               ok
"Loadout 🔥"         THROWS InvalidCharacterError: Invalid character
"日本"                THROWS InvalidCharacterError: Invalid character
```

The name is free text — `onChange={(e) => dispatch(loadoutActions.setName(e.target.value))}` with no
charset restriction — and `shareThunk` has no `try`/`catch` around `encodeShareUrl(loadout)`, so the
throw propagates out of the click handler. The server accepts such a name too
(`loadouts.js:115` allows any string ≤ 200 chars), so a build saved with an emoji name is stored
successfully and is then permanently unshareable.

I verified this is not a catalog problem: **no catalog display name contains a character above U+00FF**,
so a *derived* name is always safe. The failure needs the user to type one.

**Player-facing consequence.** "Share link" does nothing. No toast, no error, no URL — the two
`setMessage` dispatches in `shareThunk` are both downstream of the throw. Users who name builds with
emoji (common) or in a non-Latin script (CJK, Cyrillic, Greek) lose the share feature with no
indication why.

**Fix direction.** Encode the JSON as UTF-8 before base64 — `btoa(String.fromCharCode(...new TextEncoder().encode(json)))`
or equivalent — and decode symmetrically in `readHashLoadout`. This is a wire-format change in the
strict sense (old codes must still decode), so it wants the version-envelope discipline: keep reading
raw-Latin-1 codes, write the UTF-8-safe form. Independently, wrap the encode in `shareThunk` so a
future encode failure surfaces as a message rather than a dead button.

---

### F6 — P3 — Nothing pins the `AMMO` pools or any weapon's `ammoClass`; the wire-format gate is a comment

**Where:** `client/src/data/catalog.js:32–45` (the WIRE-FORMAT GATE) and `:46–66` (`AMMO`).

**Status:** `CONFIRMED`. **This is the highest-leverage finding in my filing** — it is the missing
control that let F1 and F2 happen, and it is the one that will let the next one happen.

**Evidence.** The gate states the repo's most severe invariant:

> inserting, removing, or reordering a variant inside a pool silently re-points every saved selection
> in that class … Any such edit therefore needs a `FORMAT_VERSION` bump and a saved-selection
> migration, on the same terms already required for changing a weapon's `ammoClass`.

No test enforces any part of it:

```
$ grep -rni "ammo" --include=*.test.js --include=*.test.jsx client/src | grep -c "AMMO\["
1                       # controlScale.test.jsx:534, an incidental "find a weapon that has ammo" helper
$ grep -rn "ammoClass" --include=*.test.js --include=*.test.jsx client/src
client/src/utils/calc.test.js:8:   # a comment describing the tuple shape
```

There is no assertion anywhere that `AMMO.compact[1]` is High Velocity, that `AMMO.medium` has five
entries, or that `frontier-73c` draws from `compact`. A pull request reordering a pool, deleting a
round from the middle of one, or flipping any weapon's `ammoClass` passes all 759 client tests, all
161 server tests and all 321 scrape tests. **All three historical violations (F1, F2) landed green.**

The one adjacent control that *does* exist is the scraper's, and it is genuinely sound — see the
negative results below. The gap is entirely on the hand-edit path, which is the path all three
historical changes took.

**Player-facing consequence.** None today; the pools are currently correct and unchanged since
`1572027` (see negative result N1). This is the P3 definition exactly: not wrong today, wrong
eventually, with nothing to catch it.

**Fix direction.** Two cheap pins in `catalog.test.js`. First, a golden snapshot of `AMMO` — the
literal array of `[name, price]` per pool — so that any edit inside a pool has to be accompanied by a
deliberate snapshot update, which is the review moment the gate is asking for. Second, a snapshot of
`id -> ammoClass` for every weapon. Neither pins the values against the *wiki* (nothing here can),
but both convert a silent edit into a failing test whose diff names the hazard. Word the failure
message to point at the gate comment and at `FORMAT_VERSION`.

---

### F7 — P3 — The legacy-table test proves the tables *resolve*, not that they are *faithful*

**Where:** `client/src/utils/loadoutCodec.test.js:336–357`; tables at
`client/src/utils/loadoutCodec.js:194–243`.

**Status:** `CONFIRMED`.

**Evidence.** The codec comment at `:190–193` claims the test is the enforcement the old comment
lacked. What it actually asserts is that every non-null entry names an id the live catalog still
carries, plus a length:

```js
const unresolved = table.filter((id) => id !== null && !known.has(id) && !resolvesElsewhere(id));
expect(unresolved).toEqual([]);
```

That is a weaker property than the one the tables exist to guarantee. `LEGACY_WEAPON_IDS` re-sorted
alphabetically, or with two entries transposed, or with position 20 changed from `frontier-73c` to
`winfield-m1873`, passes this test unchanged — every id still resolves. The failure mode the tables
were frozen to prevent (issue #68: a table drifting to track the live array) is exactly the failure
mode this assertion cannot see.

**I verified the tables are correct today**, and doing so required the external history the working
tree does not contain — see negative result N2. That is the point: the property is currently true and
is checked by nothing inside the repo.

**Player-facing consequence.** None today. A future drift would decode old share URLs and old stored
builds to the wrong items, silently, which is the P0 class.

**Fix direction.** Pin the tables themselves — a snapshot, or a checksum of each array, with a
comment saying that changing it means changing history and requires the git provenance in the commit
message. Keep the existing resolvability test; it catches a different thing (a retired row with no
declared replacement) and catches it well.

---

### F8 — P3 — `catalog.js:131` states the opposite of the invariant, in the wire-format documentation

**Where:** `client/src/data/catalog.js:131`.

**Status:** `CONFIRMED`.

**Evidence.** The line reads:

> `// shape — see ADR-0005's amendment, since the scraper is allowed to write ammoClass through.`

That is false, and it contradicts three other places, one of which is 39 lines above it in the same
file:

- `catalog.js:91–94`: "Everything else in these tuples **IS** hand-authored and is **never written by
  a scrape**: `id`, the display `name` …, `ammoClass` …"
- `scripts/scrape-stats.mjs:56–59`: "Some fields the wiki describes are still never written … :
  `ammoClass` … See `GATED_CATALOG_FIELDS`."
- `scripts/scrape-stats.mjs:1391–1396`: `GATED_CATALOG_FIELDS.ammoClass`, whose stated reason is the
  bare-index hazard and which says it "Needs a FORMAT_VERSION bump and a saved-selection migration
  first."

And it is false in behaviour, not merely in intent — verified in negative result N4.

**Player-facing consequence.** None directly. The harm is to the next maintainer: line 131 sits
inside the very comment that explains the ammo-index hazard, so a reader reaches it already primed to
believe it. Someone who trusts it concludes that `ammoClass` drift is machine-driven and expected,
and will look for the cause of a future F1 in the scraper — which cannot produce it — rather than in
the hand-edit path, which can and did.

**Fix direction.** Correct the clause to say the scraper is *forbidden* to write `ammoClass` and cite
`GATED_CATALOG_FIELDS`, so the sentence reinforces rather than inverts the gate it appears inside.

---

### F9 — P3 — `catalog.js:55` says six weapons draw from `special`; nine do

**Where:** `client/src/data/catalog.js:55–57`.

**Status:** `CONFIRMED`.

**Evidence.**

```
$ node --input-type=module -e '
import { WEAPONS } from "./client/src/data/catalog.js";
const s = WEAPONS.filter(w => w[4] === "special");
console.log(s.length); s.forEach(w => console.log(" ", w[0], "| cost", w[3]));'
9
  dolch-96 | cost 690
  nitro-express | cost 1015
  bomb-launcher | cost 110
  chu-ko-nu | cost 75
  flame-rifle | cost 0
  shredder | cost 0
  dolch-96-bullseye | cost 725
  dolch-96-claw | cost 700
  dolch-96-precision | cost 730
```

The comment names exactly the first six and says "as of #233". The three Dolch variants arrived later,
in `192aac5` (#254), which imported 89 variant rows and inherited each one's `ammoClass` from its
parent. The count was correct when written and was not revisited.

**Player-facing consequence.** None. Filed because the prompt asks explicitly for comments that have
gone false, and because this one is load-bearing for a reader auditing which weapons have no
purchasable ammo — it under-reports that set by a third.

**Fix direction.** Either restate the count as a derived fact ("every weapon whose `ammoClass` is
`special`, currently nine — the six from #233 plus the three Dolch variants from #254") or drop the
number and keep the reason. A number in a comment beside a list that a later commit appends to is a
comment that will go false again.

---

### F10 — P3 — The client decoder and the server validator disagree about what the wire format permits

**Where:** `client/src/utils/loadoutCodec.js:437` (`fromV2` blocked filter), `:397` (`fromV2`) vs
`server/src/routes/loadouts.js:88–125` (`isValidData`).

**Status:** `CONFIRMED` as an inconsistency; **no reachable player-facing effect today** — stated up
front so this is not read as more than it is.

**Evidence.** Three places where the two ends of one format differ:

1. **Duplicate blocked cells.** Server rejects (`:122`, `new Set(data.b).size !== data.b.length`);
   `fromV2` accepts — its filter checks range only. `fromData({v:2,…,b:[3,3,3,3,3]}).blocked` is
   `[3,3,3,3,3]`. Both capacity readers that would divide on this — `calc.js:116` `slotMax` and
   `selectors.js:16` `selectSlotMax`, each computing `8 - blocked.length` — would report 3 free slots
   where `hasFreeCell` (`calc.js:43`, which builds a `Set`) correctly sees 7. **Neither is called
   anywhere in the app**; `grep -rn slotMax client/src` finds only the two definitions and
   `calc.test.js`. So the disagreement is currently unreachable, and would become reachable the
   moment someone wires either one to the UI.
2. **A cell can be both occupied and blocked.** `fromV2` resolves `e` and `b` independently:
   `fromData({v:2, e:[["T","knife"],…], b:[0,1,2]})` yields an item in cell 0 and cell 0 blocked. The
   server permits this too. The reducer cannot produce it (`loadoutSlice.js:134` refuses moves onto
   blocked cells), so again: crafted records only.
3. **Asymmetric clamping.** The decoders clamp traits to `TRAIT_MAX` (`boundedTraits`) but do not
   clamp equipment to ADR-0015's four-per-type. `fromData({v:2, e:Array(8).fill(["C","dynamite-stick"])})`
   decodes eight identical consumables — twice the cap the interactive path enforces.

**Fix direction.** Decide, once and in writing, whether the decoder's contract is "produce a
*loadable* loadout" or "produce a *legal* loadout" — the codec currently does the first for equipment
and the second for traits, and the comment at `:56–74` justifies clamping in terms that apply equally
to both. Then make the server's `isValidData` and the client's decoders enumerate the same list of
rejections, ideally from a shared statement of the format rather than two hand-written copies that
already differ on `b` versus `tr`.

---

## Negative result

What I checked and found clean. These are exhaustive enumerations, not samples, and each carries the
command that re-runs it.

### N1 — No `AMMO` pool has ever been non-append edited. (Charge bullet 1 — the headline question.)

I reconstructed `catalog.js` at all 26 commits that touch it and diffed each `AMMO` block against its
true first parent's:

```
$ node scratchpad/pairdiff.mjs | grep -i "AMMO\."
  AMMO.special ADDED (0 entries) — new pool, safe          # 077e747
  AMMO.special ADDED (0 entries) — new pool, safe          # 5230e57 (the merge that carried it)
```

Across the entire history, the eight populated pools (`compact`, `medium`, `long`, `slong`,
`shotgun`, `xbow`, `hxbow`, `bow`) are **byte-identical in content, order and price** to their form in
the initial commit `1572027` (2026-08-07). The only structural change ever made was adding the empty
`special` key, which cannot move an existing index. There is **no** historical insert, delete or
reorder inside a pool, with or without a `FORMAT_VERSION` bump.

The hazard the charge was pointed at is therefore real but has never fired *through the pools*. It
fired three times through the adjacent door — `ammoClass` — which F1 and F2 cover, and which
`pairdiff.mjs` enumerates exhaustively: exactly three changes in 277 commits, no others.

### N2 — All four frozen `LEGACY_*_IDS` tables are faithful to the pre-versioning catalog.

The direct comparison against `2a6bd05`, the commit that introduced ids in the pre-existing array
order:

```
$ node scratchpad/legacy-check.mjs
=== LEGACY_WEAPON_IDS (len 37) vs WEAPONS@2a6bd05 (len 37) ===  IDENTICAL — faithful
=== LEGACY_TOOL_IDS  (len 20) vs TOOLS@2a6bd05  (len 20) ===  [9] frozen=null  historical="electric-lamp"
=== LEGACY_CONS_IDS  (len 16) vs CONS@2a6bd05   (len 16) ===  [13] frozen="choke-bombs" historical="choke-bomb"
=== LEGACY_TRAIT_IDS (len 32) vs TRAITS@2a6bd05 (len 32) ===  [12] frozen="iron-eye"  historical="iron-repeater"
                                                              [26] frozen="pain-sense" historical="poison-sense"
```

Every table matches in **length and order**. The four deviations are precisely the four documented
substitutions (`loadoutCodec.js:209–211`, `:224–227`, `:233–236`, `:240–241`), each of which I
confirmed is the intended semantic and not drift:

- `[9] null` — Electric Lamp, deleted in `e0076d3`; holding the slot is what keeps positions 10–19
  honest, which is issue #68's whole point. Verified present at position 9 historically.
- `[13] choke-bombs` — the Consumables duplicate `choke-bomb` was deleted (`4b1ab50`); the surviving
  **tool** id carries the item. Confirmed `choke-bombs` did **not** exist in either category at
  `2a6bd05`, so this cannot be a collision.
- `[12] iron-eye`, `[26] pain-sense` — in-place renames. Confirmed `iron-eye` and `pain-sense` were
  both **absent** from `TRAITS@2a6bd05`, so neither substitution can alias two legacy positions onto
  one trait.

And no table maps two positions to the same id:

```
$ node scratchpad/collide.mjs
LEGACY_WEAPON_IDS (len 37): no two positions resolve to the same id
LEGACY_TOOL_IDS   (len 20): no two positions resolve to the same id
LEGACY_CONS_IDS   (len 16): no two positions resolve to the same id
LEGACY_TRAIT_IDS  (len 32): no two positions resolve to the same id
```

**No table has drifted to track the current array.** (F7 records that nothing in the repo would
notice if one did.)

### N3 — Every legacy array position decodes to the right item.

Not a spot-check — all 105 positions, through the live decoder:

```
$ node scratchpad/legacy-sweep.mjs
=== every legacy TOOL position (20) ===   all correct; [6] katana -> WEAPON Katana (promotion);
                                          [9] -> DROPPED (Electric Lamp); [18][19] beetles -> C (category crossing)
=== every legacy CONS position (16) ===   all correct; [13] choke-bombs -> T Choke Bombs (category crossing)
=== every legacy TRAIT position (32) ===  dropped: none; no unintended substitutions
=== every legacy WEAPON position (37) === only deviation: [16] winfield-m1873c -> frontier-73c (ALIASED)
```

The Katana promotion (#156), the beetle and Choke Bomb category crossings (#38, #67) and the
`winfield-m1873c` alias (#243) all behave as their comments claim. I also confirmed the alias-safety
claim at `loadoutCodec.js:286–290` — "both are size 3, both draw from `compact`, so a stored ammo
index stays in range and keeps meaning the same round" — is **true**, by reading both rows as they
stood at the commit that removed one:

```
$ git --git-dir=fullhist.git show c3b6bba^:client/src/data/catalog.js | grep -E '"(winfield-m1873c|frontier-73c)"'
  ["winfield-m1873c", "Winfield M1873C", 3, 44, "compact", "Rifles"],
  ["frontier-73c",    "Frontier 73C",    3, 41, "compact", "Rifles"],
```

Same size, same pool. The alias is sound. (Legacy position **20**, the other Frontier 73C slot, is
the one that is not — that is F1, and it reaches this through `ammoClass`, not through the alias.)

### N4 — The scraper cannot write `ammoClass`. (Charge bullet 4.)

Three independent barriers, all verified:

1. **Positive allow-list.** `planCatalogWrites` (`scrape-stats.mjs:1463–1493`) iterates only
   `CATALOG_FIELD_MAP[category]`. For weapons that is `{Price → index 3}` and `{Size → index 2}`.
   Index 4 (`ammoClass`) is not reachable; `replaceTupleField` is only ever called with an index the
   map supplied.
2. **Type barrier.** Even a hypothetical map entry for index 4 would go through `parseNumeric`, which
   returns `null` for a non-numeric, and then `rangeViolation`, which requires a named rule. A string
   ammo class cannot survive either.
3. **A test.** `scrape-stats.test.mjs:1017` feeds a record carrying `AmmoType: "medium"` and asserts
   the planned label set is exactly `["cost"]`, then explicitly asserts `ammoClass` is absent.

This is genuinely well-defended — the only defect here is the comment that says otherwise (F8).

### N5 — Id retirement is clean. (Charge bullet 3.)

```
$ node --input-type=module -e '…'   # full script in the Findings section of my scratch notes
duplicate ids within a category : none
ids in two or more categories   : none
duplicate display names         : none
choke-bomb     : absent (correctly retired)
electric-lamp  : absent (correctly retired)
iron-repeater  : absent (correctly retired)
poison-sense   : absent (correctly retired)
winfield-m1873c: absent (correctly retired)
```

Across 147 weapons, 21 tools, 30 consumables and 58 traits: **no duplicate id within a category, no
id shared between two categories, no retired id back under a new meaning, no duplicate display
name.** Every weapon's `ammoClass` names a pool that exists in `AMMO`. `choke-bomb` in particular is
retired and stays retired — `LEGACY_CONS_IDS[13]` resolves to the distinct id `choke-bombs`, which is
a different string, exactly as `loadoutCodec.js:224–227` claims.

### N6 — v2 round-trips are lossless, exhaustively.

```
$ node scratchpad/rt.mjs
1. every weapon × every valid ammo index (147 weapons, all indices incl. -1)  clean
2. every tool and consumable in every one of the 8 cells (408 placements)     clean
3. stale v2 record carrying ["T","katana"] -> promoted to a weapon slot, cell cleared
4. full loadout (2 weapons + ammo, 3 equipment, 2 traits, blocked [3,5], name) clean
```

Weapons, ammo indices, equipment identity **and cell position**, traits, blocked cells and the name
all survive `toData` → `fromData` unchanged. Holes stay holes; a `null` cell round-trips as a `null`
cell; blocked cells travel as their own array and come back identical.

### N7 — The v1 → v2 migration is sound for every v1 record the v1 app could produce.

SPEC-0006's "Version 1 Records Migrate Losslessly" survives the obvious attack. The worry is the
blocked-count lift: `v1BlockedCells(N)` maps a count to the *last* N cells (`loadoutCodec.js:162–167`)
while `fromV1` packs surviving items to the *front*, so an overlap would put an item in a blocked
cell. It cannot happen, because the v1 reducer capped the two against each other:

```
$ git --git-dir=fullhist.git show c3b6bba:client/src/store/loadoutSlice.js | grep -n "slotMax(state)\|8 - state.equip.length"
39:      if (state.equip.length >= slotMax(state)) return;                              # addEquip
57:      state.blocked = isBlocked ? … : Math.min(state.blocked + 1, 8 - state.equip.length);
```

`slotMax` was `8 - blocked`, so `equip.length + blocked ≤ 8` held on both writers. I also confirmed
the v1-era `toData` wrote `b` as a **number** (`git show c3b6bba:…/loadoutCodec.js` line 88, with
`emptyLoadout()` line 74 giving `blocked: 0`), which is exactly the shape `v1BlockedCells` expects —
so there is no count/array shape confusion on any real v1 record. The lift is correct.

### N8 — Share codes do not use the URL-fragile base64 characters in practice.

`readHashLoadout`'s regex is `/#L=([A-Za-z0-9+/=]+)/`, and `+` is the classic base64-in-URL hazard
(rewritten to a space by some transports). I checked whether it actually occurs:

```
$ node scratchpad/probe3.mjs
=== share-code alphabet over 2000 randomised loadouts ===
  contain '+' : 0/2000 (0.0%)
  contain '/' : 0/2000 (0.0%)
```

Zero occurrences over 2000 randomised loadouts, because the payload is ASCII JSON. Not a finding —
recording it so no one spends the effort again. (F5 is a different problem with the same call.)

### N9 — Also checked, also clean

- **`toData` never throws on a well-formed store state.** Every `WEAPONS[w.i]` / `TOOLS[e.i]` /
  `CONS[e.i]` read is reached only after an id-existence guard in the decoder that produced the index.
- **Malformed input decays to the empty grid rather than throwing**, as `emptyLoadout`'s comment
  claims: non-object, non-array `e`, non-array `tr`, non-array `b`, out-of-range blocked indices, and
  sparse `e` holes all produce a well-formed loadout. Verified in `scratchpad/probe2.mjs`.
- **`FORMAT_VERSION` history**: 1 introduced at `2a6bd05`, 2 at `0f4f5b1`, no other values, no
  regressions. Traced across every commit touching `loadoutCodec.js`.
- **`boundedAmmo` is correct for all 147 weapons**, including the 9 drawing from the empty `special`
  pool and the 7 melee weapons on `none` — both return `-1` for every input rather than admitting a
  crashing index. This is the #201 fix and it holds.
- **`b` shape mismatches lose blocking but do not throw** (v2 record with numeric `b`, v1 record with
  array `b` → `blocked: []`). Neither is reachable: the server rejects both shapes for the wrong
  version, and the store's `blocked` representation changed in the same commit as the version bump,
  so there is no straddling window.

---

## Handoffs

Noticed outside my charge. **Not investigated** — flagging only, for the chair.

1. **Seat 2 / Seat 3 — `special` pool membership grew silently.** The 89 variant rows imported in
   `192aac5` inherit `ammoClass` from their parent (`catalog.js:236` states this is evidenced, not
   assumed). Three Dolch variants therefore landed on the empty `special` pool. Whether inheritance
   is right for *every* one of the 89 is a catalog-provenance question, not a wire-format one.
2. **Seat 3 — `slotMax` and `selectSlotMax` are dead.** `calc.js:116` and `selectors.js:16` both
   compute `8 - blocked.length` and neither has a caller outside `calc.test.js`. If capacity is meant
   to be read through `hasFreeCell` alone, these are two live re-derivations of capacity waiting to be
   wired up — and they disagree with `hasFreeCell` on duplicate blocked entries (my F10).
3. **Seat 3 — the decoder does not enforce the ADR-0015 four-per-type cap.** A decoded loadout can
   hold eight identical consumables. Whether that is reachable from `randomize.js` or only from a
   crafted record is Seat 3's question; the decoder half is my F10.
4. **Seat 5 — `savedId` is deliberately not persisted** (`loadoutSlice.js:59–63`, SPEC-0003). The
   consequence is that reloading the page after loading a saved record loses the association, so the
   next save matches on the name triple instead of the id. That looks intended, and `80806d3` scoped
   the upsert key to the list, so it probably degrades cleanly — but it is an identity question under
   ADR-0022 and someone should confirm two builds cannot collide on it.
5. **Everyone — the working tree is a shallow clone.** Any seat whose charge involves `git log` is
   seeing history that begins 2026-08-12 and will silently under-report. See Method above.
6. **Blind spot the whole panel shares:** items missing from the catalog entirely. No seat can run
   `scrape-stats.mjs --discover`, and the wiki is unreachable. Silence about it is not coverage.
