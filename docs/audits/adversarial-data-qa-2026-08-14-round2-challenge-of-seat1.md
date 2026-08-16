# Adversarial Data QA Panel — Round 2 cross-examination of Seat 1

**Target:** `docs/audits/adversarial-data-qa-2026-08-14-seat1.md` (Persistence and the wire format).
**Challenger:** did not file Seat 1. **Date:** 2026-08-14. **Round:** 2.

**Headline: the P0 survives at P0** — every mechanical link in F1 reproduces, in my own history mirror,
with my own parser and my own decode. But two of Seat 1's supporting claims are wrong, and one of them
is the half Seat 1 presents as its original contribution.

**Verdict counts:** 9 UPHELD (2 with corrected evidence, 2 merged into another seat's filing),
1 UPHELD-with-a-struck-sub-claim, 0 struck outright. 4 of 9 negative results independently re-derived,
all 4 hold.

---

## Method and its limits

### Independence

I did **not** reuse Seat 1's mirror or any file in Seat 1's scratch space. I cloned
`https://github.com/jonstump/the-outfitter --bare` into a private directory
(`scratchpad/r2s1/r2hist.git`), and every history claim below is against that clone. It carries **277
commits on `HEAD`** (285 across all refs) versus **55** in the panel's shallow working tree, which is
grafted at `4e5d239`. Seat 1's count of 277 is correct.

`e9b2c1d`, `2a6bd05`, `0f4f5b1` and `077e747` — the four commits Seat 1's history claims rest on — all
exist in my mirror. **None of Seat 1's history claims is struck for being invisible in the shallow log.**

### Wiki

Unreachable, same as every seat:

```
$ curl -sS -o /dev/null -w '%{http_code}\n' https://huntshowdown.wiki.gg/wiki/Nagant_M1895
curl: (56) CONNECT tunnel failed, response 403
```

So I can adjudicate whether the app disagrees with **its own past** — which is all Seat 1's charge
needs — and I cannot adjudicate any claim about what the game sells. Seat 1 states this limit
correctly and stays inside it.

### Baselines, re-run by me

Run separately; the server suite run alone against a private `OUTFITTER_DB_FILE`.

| Suite | Result | Matches chair's baseline |
|---|---|---|
| client `npx vitest run` | 33 files, **759 passed** | yes |
| server `npx vitest run` | 7 files, **161 passed, 1 skipped** | yes |
| scrape `node --test scripts/*.test.mjs` | 13 suites, **321 passed** | yes |

### The mutation probe, and why it is not a violation of read-only

Several of Seat 1's claims are *bare negatives* ("no test would catch X"). A bare negative cannot be
settled by grep, and Seat 1's was not. I copied `client/` and `data/` into scratch space, symlinked
the repo's `node_modules`, and confirmed the copy is green at 759/759 before mutating anything. **The
panel's working tree was never modified**; every mutation happened in `scratchpad/r2s1/probe/` and was
reverted between runs. This is what turned F6 from an assertion into a measurement — and it is what
falsified part of it.

### What I did not do

Did not run the scrapers; did not modify any file in the repo except by creating this report; did not
edit Seat 1's filing; did not touch the shared `.git`.

---

## Findings

### F1 — P0 — Frontier 73C ammo remap → **UPHELD at P0**, with one sub-claim **STRUCK**

**Reproduced: yes, completely.** Every link verified independently.

| Link Seat 1 asserts | My check | Result |
|---|---|---|
| `e9b2c1d` exists and moved `frontier-73c` `medium`→`compact` | `git show e9b2c1d^:…` vs `e9b2c1d:…` in my mirror | **holds** — and the commit message states the intent verbatim |
| Both pools were and are length 5 | parsed `AMMO` at `e9b2c1d^` and at HEAD | **holds** — the eight populated pools are byte-identical then and now |
| `medium[1]` = Spitzer $60, `compact[1]` = High Velocity $13 | same parse | **holds** |
| `FORMAT_VERSION` was 1 before and after; 2 arrived at `0f4f5b1` | traced the constant across all four commits | **holds** |
| Legacy position 20 is Frontier 73C at `medium` | parsed `WEAPONS` at `2a6bd05^`: index 20 = `["Frontier 73C",3,72,"medium","Rifles"]` | **holds** |
| The decode reaches the wrong entry | ran the live decoder | **holds via legacy, v1 *and v2*** |

```
legacy [20,1]: Frontier 73C / a=1 -> ["High Velocity",13]
v1 fr73c,1   : Frontier 73C / a=1 -> ["High Velocity",13]
v2 fr73c,1   : Frontier 73C / a=1 -> ["High Velocity",13]
```

Index 1 is the only index whose **round** changes; 0, 2, 3, 4 keep the name and take the other pool's
price, exactly as Seat 1 states.

**Citation load-bearing: yes.** Every citation says what the finding says it says.

**Does a player get a wrong answer? Yes — conditional on a record existing, and a record can exist.**
This is the question the chair singled out, so I worked it rather than assuming it:

- localStorage persistence (`LS_CUR`) **and** server-side saved loadouts are both present in the
  initial commit `1572027` (2026-08-07). Persistence predates the defect by three days.
- `frontier-73c` carried `ammoClass: "medium"` against a 5-entry pool continuously from `1572027`
  until `e9b2c1d` (2026-08-10 07:08 UTC), so index 1 was selectable and meant Spitzer throughout.
- A deployable path landed at `e66b47b` (2026-08-09 19:28 UTC), and issue #189 (created
  2026-08-11 04:17 UTC) documents a **real deployed site being used, including on a phone**.

So user data *can* be in this state, which is the test the chair set — this is not a defect no record
can hold, and it is therefore not P3.

**But the at-risk population is bounded, and Seat 1 never bounds it.** A wrong record must have been
written with Frontier 73C *and* ammo index exactly 1, before 2026-08-10 07:08 UTC — a ~3-day window on
a repo whose public deployment link only landed 2026-08-13 (`3575641`). The true count is plausibly
zero and is **unknowable from the repository**. Seat 1's filing does not say this, and the omission
makes the finding read larger than the evidence supports. **The chair should carry the bound with the
finding.**

**Novelty is near zero, and Seat 1 under-discloses it.** Seat 1 does disclose `catalog.js:118-131`.
That comment does not merely note the hazard — it names this exact defect, this exact index, and this
exact price pair:

> *"AMMO.medium and AMMO.compact are both length 5, so no bounds check trips … Index 1 is the worst
> case: Spitzer ($60) becomes High Velocity ($13). Accepted rather than migrated…"*

What Seat 1 does **not** cite is that `docs/audits/weapon-catalog-wiki-audit.md` §3.3 recorded the same
correction at **Confidence: HIGH** before that comment was written (Seat 2 found this and cites it).
So the defect is documented twice in-repo and was consciously accepted. Seat 1's genuinely new content
is the legacy-vs-v1 fixability analysis — which is where it goes wrong.

#### STRUCK sub-claim: "the legacy half is deterministically fixable and was never fixed"

Seat 1 splits the defect into a fixable legacy half and an unfixable v1 half, and proposes a remap
"applied in `fromLegacy` only". **There is a third bucket that dissolves the split.** `toData` always
stamps `v: FORMAT_VERSION`, and the store subscriber persists every decoded loadout
(`store/index.js:22-28`, reached from `App.jsx:20-21`). So decoding a legacy record *upgrades it*:

```
  legacy record in : {"w":[[20,1],null],"e":[],"tr":[],"n":"Old Build","b":0}
  decodes to       : Frontier 73C a=1 -> ["High Velocity",13]
  re-persisted as  : {"v":2,"w":[["frontier-73c",1],null],…}
  -> still recognisable as legacy? NO — now v2, indistinguishable from a native v2 record
```

Any legacy record opened even once since `0f4f5b1` (2026-08-13) is now an unmarked v2 record carrying
`["frontier-73c", 1]` — identical in every observable way to a genuine v2 record where index 1
correctly means High Velocity. Seat 1's `fromLegacy`-only remap **cannot reach those**, and the
"deterministically fixable" set shrinks toward zero with every open. Since opening the build is the
only way a user would notice the problem, the set most likely to be affected is precisely the set the
proposed fix cannot address.

Separately, Seat 1's *reason* for legacy determinism is unsound as written. It argues from dates
("every legacy record was written before `2a6bd05` … strictly before the ammoClass change"), which
fails under the cached-stale-bundle scenario **Seat 1 itself relies on in F4**. The conclusion
nonetheless survives on an argument Seat 1 does not make: a bundle old enough to *write* an unversioned
record necessarily carries the pre-change catalog, so its index 1 meant Spitzer whenever it was
written. Right answer, wrong derivation — worth correcting so the next reader does not inherit the
date argument.

The "v1 is permanently ambiguous" half **stands**: the v1 era (`2a6bd05` → `0f4f5b1`) straddles
`e9b2c1d`, a v1 record carries no era marker, and nothing can recover which catalog it was written
against. Minor overstatement only: Seat 1 says the last chance to *record* the ambiguity closed at
`0f4f5b1`, then in its own fix direction proposes recording it now — the two sentences disagree, and
the fix direction is the correct one.

**Net:** mechanism UPHELD at P0; severity qualified by an unmeasured population; fixability analysis
downgraded from "half deterministically repairable" to "repairable only for records never opened
since 2026-08-13".

---

### F2 — P2 — Dolch 96 / Nitro Express selection silently discarded → **UPHELD at P2**

Reproduced exactly. My independent name-keyed sweep over every commit touching `catalog.js` confirms
`077e747` (2026-08-09) moved **both** rows into the newly created, zero-length `special` pool:

```
AMMOCLASS 077e747 2026-08-09  Dolch 96: compact(len 5) -> special(len 0)
AMMOCLASS 077e747 2026-08-09  Nitro Express: long(len 4) -> special(len 0)
POOL-ADDED 077e747 2026-08-09 AMMO.special (0 entries)
```

Decode confirms the drop through both paths (`a` → `-1` for every input). Citation load-bearing; the
consequence (silent loss, cost line changes with no explanation) is real. Seat 1's own argument for
P2-not-P0 — dropped rather than re-pointed, and the pool is empty for a documented reason — is the
right call, and it declines to claim what the game sells. Same population bound as F1 applies.

---

### F3 — P2 — Both decoders admit duplicate trait ids → **UPHELD at P2**

Reproduced exactly: `upTotal` = 120 for fifteen copies of Quartermaster (8 UP each), via v2 **and**
legacy. The server asymmetry is real and I read both lines: `server/src/routes/loadouts.js` checks
`data.tr.length > MAX_TRAITS` with no distinctness test, while the adjacent `b` branch rejects
`new Set(data.b).size !== data.b.length`. The interactive path is genuinely safe — `addTrait` carries
*both* a `TRAIT_MAX` guard and `if (!state.traits.includes(action.payload))`. Seat 1's reachability
statement ("crafted records only, which is why this is P2") is honest and correct.

---

### F4 — P2 — Unrecognised `v` falls through to the legacy decoder → **UPHELD at P2**

Reproduced exactly, including the fabrication case: `{v:3, w:[[20,1],…]}` decodes to
`Frontier 73C ["High Velocity",13]` with a trait and an equipment item conjured from bare integers.
The persistence consequence is verified at source — `App.jsx:20-21` dispatches `setLoadout` from
`readHashLoadout()`, and `store/index.js:22-28` writes to localStorage on every loadout change — so
opening one such link really does overwrite the reader's stored build.

**One qualification for the chair:** the principal cost is *latent*. It lands when `FORMAT_VERSION`
becomes 3, which has not happened. Today the only reachable door is a hand-crafted record (the server
rejects a non-numeric `v`). That is the same door F3 sits behind, so P2 is consistent with Seat 1's own
scale rather than inflated — but it is a scheduled failure, not a live one, and the report should say
so.

---

### F5 — P2 — Non-Latin-1 loadout name breaks sharing → **UPHELD at P2**

Reproduced exactly (`Café` ok; `Loadout 🔥` and `日本` throw `InvalidCharacterError`). Verified the two
supporting facts myself: `shareThunk` (`client/src/store/thunks.js:57-68`) has no `try`/`catch` around
`encodeShareUrl`, and `encodeShareUrl`'s own `try` wraps only `history.replaceState`, so the throw
escapes the click handler before either `setMessage` runs.

**Worth promoting within the filing.** F3, F4 and F5 all sit at P2, but F3 and F4 need a crafted
record and F5 needs only a user typing an emoji into a free-text field. It is the most *reachable*
defect Seat 1 filed and is ranked as though it were the least.

---

### F6 — P3 — Nothing pins `AMMO` or `ammoClass` → **UPHELD at P3, evidence CORRECTED**

**The conclusion survives. Three of its supporting statements are false, and I falsified them by
mutation rather than by argument.** Seat 1 established this bare negative with two greps (`AMMO\[` and
`ammoClass`), which cannot see an assertion written as `WEAPONS[FRONTIER][4]`.

| Seat 1 states | Actually |
|---|---|
| "There is no assertion anywhere that … `frontier-73c` draws from `compact`" | **False.** `client/src/utils/loadoutCodec.test.js:587` asserts exactly `expect(WEAPONS[FRONTIER][4]).toBe("compact")` |
| "flipping **any** weapon's `ammoClass` passes all 759 client tests" | **False.** Two weapons are pinned |
| "**No test enforces any part of it**" | **Overstated.** `scripts/scrape-stats.test.mjs:1171` asserts the gate text is present (matches `FORMAT_VERSION`, `bare index`, `migration`); `:1242` asserts a `--write-catalog` run leaves the `AMMO` table byte-identical |

Probe matrix (isolated copy, control 759/759 green, reverted between runs):

| Edit the gate forbids | Caught? | By |
|---|---|---|
| `frontier-73c` `compact`→`medium` | **yes**, 1 test | `loadoutCodec.test.js:587` |
| `nagant-m1895` `compact`→`medium` | **yes**, 1 test | `calc.test.js` — hard-coded `24 + 15 = 39` |
| `AMMO.compact` idx 0↔1 transposed | **yes**, 1 test | same hard-coded literal |
| `AMMO.compact` FMJ price 15→99 | **yes**, 1 test | same |
| `AMMO.compact` idx 1 deleted (5→4) | **yes**, 1 test | incidental range test |
| `romero-77` `shotgun`(5)→`xbow`(3) | **no — 759 pass** | — |
| `AMMO.medium` idx 1↔2 transposed | **no — 759 pass** | — |
| `AMMO.medium` Spitzer 60→999 | **no — 759 pass** | — |
| `AMMO.shotgun` idx 0↔1 transposed | **no — 759 pass** | — |

So coverage exists, but it is **incidental and confined to `AMMO.compact[0]` and two of 147 weapons**.
The single most dangerous edit the gate names — reordering inside a populated pool — still goes green
for seven of the eight populated pools. The finding stands; the sentence "no test enforces any part of
it" must not.

**Seat 1's historical claim is correct.** Neither incidental pin existed when the violations landed:
`loadoutCodec.test.js:587` arrived at `c3b6bba` (2026-08-12) and the `calc.test.js` literal at
`f438857` (2026-08-11), both after `077e747` and `e9b2c1d`. "All three historical violations landed
green" **holds**.

**PROMOTE — independently corroborated, different evidence.** Seat 2's F4 reaches the same conclusion
from provenance (31 `[round, price]` pairs across 8 pools, zero `itemStats.json` coverage, and the
scraper structurally barred from writing them) where Seat 1 reaches it from test enforcement. Two
seats, genuinely different evidence, same conclusion. This is the real thing, not correlated recall.

---

### F7 — P3 — The legacy-table test proves resolution, not fidelity → **UPHELD at P3, strengthened**

Seat 1's reading of the test is accurate, including its acknowledgement that a length is asserted
(`loadoutCodec.test.js:382-386`). I converted the argument into a measurement: transposing
`LEGACY_WEAPON_IDS[20]` and `[21]` — the precise drift the frozen tables exist to prevent —
**passes all 759 client tests**. Length unchanged, every id still resolves, assertion silent.

---

### F8 — P3 — `catalog.js:131` inverts the invariant → **UPHELD, but MERGED with Seat 5 F5, and CORRECTED**

Reproduced verbatim at line 131, contradicting line 91 thirty-nine lines above it.

**Merge:** Seat 5's F5 is the same finding from the same citations. **One finding, not two** — no
corroboration value, and the chair should not count it twice.

**Correction, and Seat 5 is the one to follow.** Seat 1's fix direction says to state that the scraper
is "*forbidden*" to write `ammoClass`, citing `GATED_CATALOG_FIELDS`. Seat 5 shows that
`GATED_CATALOG_FIELDS` is a **third tier** — gated pending a `FORMAT_VERSION` bump — distinct from
`NEVER_DERIVED` (`group`, `type`, `AMMO`). Adopting Seat 1's wording would replace one inaccuracy with
another. Seat 5's three-tier framing is the correct repair.

---

### F9 — P3 — `catalog.js:55` says six `special` weapons; nine → **UPHELD, MERGED with Seat 2 F7**

Reproduced exactly: line 55, count 9 (the six named plus `dolch-96-bullseye`, `dolch-96-claw`,
`dolch-96-precision`). Seat 2's F7 is the same finding from the same comment and the same
`WEAPONS.filter(w => w[4] === "special")`. **Same source — one finding.**

---

### F10 — P3 — Client decoder and server validator disagree → **UPHELD at P3**

All three items reproduced:

1. `fromData({v:2,…,b:[3,3,3,3,3]})` yields `blocked: [3,3,3,3,3]`; `slotMax` reports **3** while
   `hasFreeCell` correctly reports **true**. Server rejects the same payload.
2. A cell can be both occupied and blocked; both ends permit it.
3. `e: Array(8).fill(["C","dynamite-stick"])` decodes to eight identical consumables — twice ADR-0015's
   cap.

`slotMax` and `selectSlotMax` confirmed to have **no callers** outside `calc.test.js`. Seat 1 states up
front that this has no reachable effect today; that framing is correct and the P3 is right.

---

## Negative results — independently re-derived

The chair asked for at least two spot-checks. I did four. **All four hold**, and one is stronger than
Seat 1 claimed.

**N1 — no `AMMO` pool was ever non-append edited. UPHELD, exhaustively.** My own parser, my own clone:
every commit touching `catalog.js` (26), diffed against **every** parent edge, all 26 parsed with zero
failures.

```
distinct ammoClass transitions: 3
distinct non-append pool edits: 0
```

The three transitions are exactly F1's and F2's. This is the panel's most load-bearing negative and it
is now established by two independent implementations.

**N2 — all four `LEGACY_*_IDS` tables are faithful. UPHELD, and I verified a premise Seat 1 left
unstated.** Seat 1 compares the frozen tables against ids at `2a6bd05`. That comparison is only valid
if `2a6bd05` introduced ids *without reordering* — which Seat 1 asserts but does not check. I checked:
name order at `2a6bd05` is identical to `2a6bd05^` in all four categories (37 / 20 / 16 / 32). With
that established, the frozen tables match position-for-position with exactly the four documented
substitutions (`[9] null`, `[13] choke-bombs`, `[12] iron-eye`, `[26] pain-sense`) and no duplicate ids
in any table.

**N3 — every legacy position decodes correctly. UPHELD.** All 105 positions through the live decoder:
1 drop (`T[9]` Electric Lamp, documented), and every other deviation is a documented rename, alias,
promotion or category crossing — including `W[16] Winfield M1873C → Frontier 73C` and
`T[6] Katana → WEAPON:Katana`.

**N6 — v2 round-trips are lossless. UPHELD.** 734 weapon × ammo-index round trips and 408 equipment
placements across all eight cells, **0 mismatches**; full loadout with blocked cells, traits and name
survives identically.

---

## Correlated-recall check

**Clean.** I traced every numeric claim in F1, F2 and F9 to a file+line or a git blob and found no
value stated from recall. Seat 1's compliance with the honesty rule is genuine, not decorative: it
repeatedly declines to say what the game sells (F2 especially) where doing so would have made the
finding sound stronger. **No finding downgraded to `SUSPECTED` on recall grounds.**

---

## Duplication, merges and promotions

| Relationship | Disposition |
|---|---|
| Seat 1 F8 ≡ Seat 5 F5 (`catalog.js:131`) | **MERGE** — same citations, same conclusion. Count once. Follow Seat 5's three-tier framing; Seat 1's "forbidden" wording is itself inaccurate |
| Seat 1 F9 ≡ Seat 2 F7 (`special` count) | **MERGE** — same comment, same filter. Count once |
| Seat 1 F6 + Seat 2 F4 (`AMMO` unguarded) | **PROMOTE** — different evidence (test enforcement vs. scrape provenance), same conclusion. Genuine independent corroboration |
| Seat 1 F1 + Seat 2 F2 (Conversion `ammoClass`) | **COUPLE, do not merge** — different rows, different evidence. Seat 2's proposed fix to `caldwell-conversion-pistol` would manufacture a *second* F1 unless it lands with a `FORMAT_VERSION` bump and a migration. Both seats say so; the chair should keep them adjacent |
| Seat 1 F1 + Seat 5's verification of the `:128` comment | **SAME SOURCE** for the price pair (both read `catalog.js`). Seat 1's decode evidence is additional and is its own |
| `catalog.js:118-119` "Winfield M1873C **above**" names a deleted row | Already Seat 5 F6. I re-derived it independently (no such row exists) — **corroboration for Seat 5**, not a new finding, and a gap in Seat 1's F8/F9 comment sweep of the same block |

---

## Summary for the chair

| # | Sev | Verdict | Reproduced | Citation load-bearing | Player wrong answer |
|---|---|---|---|---|---|
| F1 | **P0** | **UPHELD** (one sub-claim struck) | yes, via legacy/v1/v2 | yes | yes, if a record exists — bound unmeasured |
| F2 | P2 | UPHELD | yes | yes | yes (silent loss) |
| F3 | P2 | UPHELD | yes | yes | crafted records only |
| F4 | P2 | UPHELD (latent until the next bump) | yes | yes | crafted records only, today |
| F5 | P2 | UPHELD (most reachable in the filing) | yes | yes | yes, ordinary users |
| F6 | P3 | UPHELD, **evidence corrected** | partially — 3 claims false | no, grep too narrow | none today |
| F7 | P3 | UPHELD, strengthened by mutation | yes | yes | none today |
| F8 | P3 | UPHELD, **merged** into Seat 5 F5, fix corrected | yes | yes | none |
| F9 | P3 | UPHELD, **merged** into Seat 2 F7 | yes | yes | none |
| F10 | P3 | UPHELD | yes (all 3 items) | yes | none, correctly stated |
| N1 | — | UPHELD, re-derived exhaustively | — | — | — |
| N2 | — | UPHELD, plus its unstated premise | — | — | — |
| N3 | — | UPHELD (105/105) | — | — | — |
| N6 | — | UPHELD (1142 round trips) | — | — | — |

**Nothing struck outright.** The two substantive corrections are: F1's legacy/v1 fixability split (a v2
laundering path Seat 1 did not consider dissolves it), and F6's bare negative (falsified in three
places by mutation testing, though its conclusion holds).

**On the P0: it survives at P0.** The mechanism is fully confirmed and user data can hold the defective
state, which is the test that separates P0 from P3 here. Two things must travel with it: the at-risk
population is bounded by a ~3-day window and is unmeasurable from the repo, and the defect was already
disclosed twice in-repo and consciously accepted — so the actionable residue is the *fix analysis*,
which is the part that needed the most correction.
