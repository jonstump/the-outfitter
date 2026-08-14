# Round 2 — Cross-examination of Seat 3

**Challenger:** Round 2 reviewer for **Seat 3 — Rules, caps, and the generator**.
I did not file Seat 3's filing. Target: `docs/audits/adversarial-data-qa-2026-08-14-seat3.md`.

**Date:** 2026-08-14

---

## Method and its limits

### Wiki reachability — checked, not assumed

```
$ curl -sS -o /dev/null -w '%{http_code}\n' https://huntshowdown.wiki.gg/wiki/Nagant_M1895
curl: (56) CONNECT tunnel failed, response 403
```

**Unreachable.** Seat 3's statement of the same is correct. This matters for the strike calculus only
where a finding rests on a game number — and Seat 3 states none. Every numeric claim in that filing
traces to a file+line or to a measurement, which is why nothing below is struck under the
correlated-recall rule.

### Independence of my evidence

Every verdict below rests on a probe **I wrote**, in scratch space
(`/tmp/.../scratchpad/r2s3`), not on Seat 3's reported counts. Seat 3's findings lean on fuzzing and
random walks, so I re-ran all of it with my own harnesses and my own sample sizes. Where my numbers
differ from Seat 3's they differ only by RNG draw.

Nothing in the repository was modified. `git status --porcelain` is empty at the time of writing.
The one thing I changed outside the working tree: I recovered the full git history
(`git fetch --unshallow`; 55 → 281 commits, `is-shallow-repository` now `false`). Two of my verdicts
below — the F2 reachability argument and the F8 sub-strike — depend on commits the shallow clone
could not see, and neither could have been judged without it.

### Baseline

`npm test` does not run as written (Node v22.22.2 against `engines.node: ^20`, and `vitest` is not on
PATH from the workspace root). Run directly:

| Suite | Command | Result |
|---|---|---|
| client | `client$ ../node_modules/.bin/vitest run` | **759 passed / 759**, 33 files |
| server | (`node --test`, one shared `server/data/db.test.json` — run alone) | 161 + 1 skipped, per the chair |
| node/scrape | `node --test scripts/*.test.mjs` | 321 / 321, per the chair |

I did not run the server suite; I ran a **separate** server process on port 4199 against a scratch
db file (`OUTFITTER_DB_FILE=<scratch>/db.r2.json`) so nothing touched `db.test.json`. That process is
stopped and its file lives outside the repo.

### What I actually did

- **Reproduced the F1 reducer defect** against the real reducer (three dispatches, no mocks).
- **Built a component-level harness** — real store, real `EquipmentPanel`/`EquipmentSlot`, real
  `loadSavedThunk`/`randomizeThunk`, `@testing-library/react` in jsdom — and hunted for the
  click-path Seat 3 could not find. **I found two.**
- **Drove F2 end to end**: `encodeShareUrl` → `location.hash` → `readHashLoadout` → store → render →
  `toData` → `writeStoredLoadout`/`readStoredLoadout`, then **POSTed the same payload to a live
  server process** and read the record back.
- **Re-measured the generator myself**: 200,000 builds for reach, 300,000 single attempts for the
  cost profile, 3,000 builds × 11 option scenarios for the invariant fuzz, 500 runs at each of six
  fixed budgets.
- **Recovered git history** and read the pre-#288 and pre-#222 sources directly.
- Read in full: `loadoutSlice.js`, `calc.js`, `randomize.js`, `stacking.js`, `loadoutCodec.js`,
  `EquipmentPanel.jsx`, `EquipmentSlot.jsx`, `gridMove.js`, `thunks.js`, `selectors.js`,
  `server/src/routes/loadouts.js`, ADR-0015 in full, SPEC-0008 in full, and the other four filings.
- I did **not** run the scrapers.

### Limits on this challenge

1. **jsdom is not a browser.** My click-paths are exercised through React's synthetic event system
   in jsdom. Every step is a real handler invoked by a real event from a real element, and the two
   paths use only keyboard events and one button click — none of the pointer-capture or
   `touch-action` machinery jsdom cannot model. I did not open a browser, and I say so.
2. **No upstream oracle.** Same limit Seat 3 has. I can prove a rule is self-inconsistent; I cannot
   prove any `size`, `cost` or `up` matches the live game.
3. **I cannot observe production.** F2's "records like this exist in the wild" is provable only as
   far as "the shipped client produced this class of record until 2026-08-13", which git shows. How
   many such records the linked deployment holds is `[UNVERIFIED]` and I have marked it so.

---

## Verdicts

| # | Seat 3 severity | Verdict | Reproduced? | Citation load-bearing? | Player gets a wrong answer? |
|---|---|---|---|---|---|
| F1 | P2 | **UPHELD — PROMOTED to P1** | Yes | Yes | **Yes** (click-path found) |
| F2 | P1 | **UPHELD at P1** | Yes, end to end | Yes | Yes |
| F3 | P2 | **DOWNGRADED to P3** | Yes, exactly | Yes, but incomplete | No |
| F4 | P2 | **DOWNGRADED to P3** | Yes, exactly | **Selectively quoted** | No |
| F5 | P3 | **UPHELD at P3** | Yes | Yes | No (not reachable today) |
| F6 | P3 | **UPHELD at P3 — corroborated, promote within tier** | Yes | Yes | Marginally |
| F7 | P3 | **UPHELD at P3** | Yes | Yes | No |
| F8 | P3 | **UPHELD at P3 — one sub-claim STRUCK** | Yes | Two of three; **third struck** | No |
| F9 | P3 | **UPHELD at P3** | Yes | Yes | No |
| F10 | P3 | **UPHELD at P3** | Yes | Yes | No |

Nothing is struck in whole. One sub-claim inside F8 is struck; two severities come down; one goes up.

---

## F1 — `moveEquip` duplicates an item when the source cell is empty

### Verdict: **UPHELD, PROMOTED P2 → P1.** The click-path exists. Seat 3 invited exactly this.

### 1. Reproduce

The reducer defect reproduces on the first try, against the real reducer:

```
$ node scratch/f1-reducer.mjs
1 addEquip :  Knife | · | · | · | · | · | · | ·        cost 40
2 addEquip :  Knife | · | · | · | · | · | · | ·        cost 40   (correctly refused)
3 move 5->0:  Knife | · | · | · | · | Knife | · | ·    cost 80
4 six more :  Knife | Knife | Knife | Knife | Knife | Knife | Knife | Knife   cost 320
consumable:   8 × Dynamite Stick   cost 144   Throwables held 8
round-trip fromData(toData(...)): 8 cells, cost 144
wire e: [["C","dynamite-stick"], ×8]
```

Seat 3's reading of `loadoutSlice.js:135-139` is exact, including the dead guard: line 137's
`if (moving === null) return` cannot fire, because line 135 already returned on the only input that
makes `moving` null.

Seat 3's coverage claim also reproduces. `grep -rn '\bmoveEquip\b' client/src --include=*.test.js
--include=*.test.jsx` returns **0**, and the two files a naive grep appears to implicate
(`loadoutSlice.test.js`, `EquipmentPanel.test.jsx`) match only on `removeEquip` as a substring. Seat 3
warned about that trap and was right to.

### 2. Attack the evidence

The citation is load-bearing and I could not weaken it. The comment at `loadoutSlice.js:117-122`
does state all three clauses Seat 3 says it states, and all three are false for this input class.

### 3. Attack the consequence — this is where Seat 3's own verdict does not survive

Seat 3 filed P2 because it traced all three `moveEquip` dispatchers
(`EquipmentPanel.jsx:57`, `:61`, `:121`) and found `from` always occupied at grab time. **That
analysis is correct and I confirmed it.** All three dispatchers read from a grab, `startGrab`
(`EquipmentSlot.jsx:83-88`) refuses a grab on an empty cell, and the ✕ removal path really does kill
a live grab — I built the control:

```
CONTROL — Space-grab cell 0, ArrowRight, click "Remove Knife", press Enter
result: · | Dynamite Stick | · | · | · | · | · | ·      (no duplication — the defence works)
```

What Seat 3's method could not find is that **the defect is not in a dispatcher at all — it is in
the lifetime of the grab ref.** `grabRef` lives in `EquipmentPanel` (`EquipmentPanel.jsx:35`) and is
cleared by exactly four things: pointerup, pointercancel, lost pointer capture, and the ✕ removal
effect (`EquipmentSlot.jsx:121-132`). It is **not** cleared by anything that replaces the loadout.
So a keyboard grab taken before a `setLoadout` is still live after it, pointing at a cell index whose
occupancy has changed underneath it.

Two callers replace the loadout wholesale while the grid stays mounted: `randomizeThunk`
(`thunks.js:20`) and `loadSavedThunk` (`thunks.js:53`). Both are ordinary buttons.

Seat 3's own **handoff #2** is the accelerant, and Seat 3 did not connect it to F1: Escape cancels a
grab only while `ref.current.from === index` (`EquipmentSlot.jsx:50`), and the arrow keys move `from`
away from the origin (`EquipmentPanel.jsx:111`). So a user who grabs, arrows, then presses Escape on
the cell they grabbed is told nothing and **still holds the grab**. I verified this:

```
Space-grab cell 0 → ArrowRight → Escape on cell 0 → Enter
result: Dynamite Stick | Knife | ...   (the move fired; the user believed it was cancelled)
```

#### Click-path A — the Randomize button. Two buttons and four keys.

```
1. Player fills the grid the ordinary way (picker → addEquip). Eight cells occupied.
2. Focus the tile in cell 7, press Space.        → keyboard grab {origin:7, from:7}
3. Press ArrowUp.                                 → from = 6
4. Click "Randomize".                             → randomizeThunk → setLoadout
                                                     (the fill draws 5–8 cells; when it draws 7,
                                                      cell 7 is left empty and cell 6 is filled)
5. Return focus to the grid, press Enter.         → moveEquip({from: 7, to: 6})
```

Measured — my harness, real `randomizeThunk`, first sample in **3 attempts**:

```
before: First Aid Kit | Dynamite Bundle | Hellfire Bomb | Fire Beetle | Hive Bomb |
        Alert Trip Mines | Throwing Axes | ·                                   cost 483
after : First Aid Kit | Dynamite Bundle | Hellfire Bomb | Fire Beetle | Hive Bomb |
        Alert Trip Mines | Throwing Axes | Throwing Axes                       cost 533
```

Two Throwing Axes — a **tool**, and `addEquip`'s one-tool-per-loadout guard
(`loadoutSlice.js:104`) is a rule the reducer enforces two functions above the one that just broke
it. `$50` appears in the total for an item the player cannot carry twice. Randomize leaves cell 7
empty on roughly three presses in four (`n = min(5 + floor(rand×4), 8 - blocked)`), so step 4 is not
a rare roll.

#### Click-path B — loading a saved loadout. Puts the build over the consumable cap.

```
1. Player holds a Knife and a Dynamite Stick.  Space-grab cell 0, ArrowDown → from = 1.
2. Click "Load" on a saved record whose cell 0 is a HOLE and whose cells 1-4 are Dynamite Sticks.
   (Such a record is built by the ordinary path: add four, remove the first, save.)
3. Return focus to the grid, press Enter.
```

Measured, through the real `loadSavedThunk` and a real v2 wire record:

```
after Load : · | Dyn | Dyn | Dyn | Dyn | · | · | ·    cost 72   Throwables 4  (at the cap)
after Enter: Dyn | Dyn | Dyn | Dyn | Dyn | · | · | ·  cost 90   Throwables 5  (OVER the cap of 4)
```

and the tool variant of the same path:

```
TOOL DUP: Knife | Knife | · | · | · | · | · | ·   cost 80
```

Step 3 is a real focus return, not a synthetic dispatch: I focus a grid cell and fire `keydown`
on it, which bubbles to the grid root's handler. Pressing Enter on a grid cell without a live grab
does nothing, so nothing here fires accidentally — it fires because the grab outlived the build.

### 4. Correlated-recall / duplication

**No other seat filed `moveEquip`.** `grep -ln moveEquip` across seats 1, 2, 4 and 5 returns nothing.
Single-seat finding, no correlation risk, and no game number is involved.

### Severity, argued rather than asserted

P1 is "wrong answer, silently — the player builds something they cannot use." Both paths produce a
build the game refuses (two of a unique tool; five of a four-per-type category), price it
confidently, round-trip it through `toData`/`fromData` unchanged, persist it to localStorage, and —
per F2's server test below — save it to the server with a 201.

The one honest qualifier: the duplicate is *visible* as a second tile, so it is not invisible the way
F2's decoded record is. What is silent is that the app never says the state is illegal — the
equipment panel has no over-capacity surface at all (see F2). I promote to P1 on the unfieldable
build and the inflated total, and record the qualifier rather than hiding it.

**Fix direction.** Seat 3's is right and insufficient. Requiring an occupant at `from` closes the
reducer hole and should be done. But the grab ref outliving a `setLoadout` is the actual mechanism,
and it will produce other defects: clear `grabRef` whenever the loadout is replaced (a `useEffect` on
the equip identity), and fix the Escape guard to compare against `origin`, not `from`. Seat 3's
missing four-occupancy test suite for `moveEquip` is the right regression net.

---

## F2 — No decoder enforces any equipment rule; a saved over-cap build loads, prices, and re-saves silently

### Verdict: **UPHELD at P1.** It is not hand-crafted-only. A real share URL round-trips it, and the server takes it.

The chair asked me to push hardest here and to argue the severity **down** if it is reachable only by
a payload no client produces. It is not, on three independent counts.

### 1. Reproduce — end to end, through the real share URL

```
$ vitest run zz-r2-f2.test.jsx
share URL length 365   hash set? true
decoded held: 8 | Throwables: 8 (cap 4) | totalCost: 372
              | picker would allow a 9th Throwable? false      ← the cap IS live; it just was not applied
toData(decoded) === toData(original)                            ← byte-identical re-encode
localStorage round-trip held: 8   cost 372
v1 decode Throwables: 8   cost 372                              ← v1 admits it too
control — 25 trait ids decode to: 15                            ← boundedTraits DOES clamp
```

This is not a synthetic dispatch. `encodeShareUrl` writes `location.hash` itself; `readHashLoadout`
is exactly what `App.jsx:20` calls on boot; the decoded payload goes through the real `setLoadout`.
Seat 3's numbers ($372, 8 Throwables, the trait control) reproduce exactly.

Rendered, with `EquipmentPanel` and `WeaponsPanel` mounted side by side:

```
equipment panel meta: "8/8 SLOTS · MAX 4 PER CONSUMABLE TYPE"
any "Over capacity" string on screen? false
```

The caption is worse than Seat 3 says. It does not merely fail to check — it **states the rule the
grid in front of it is violating**, on the same line, in the same breath.

### 2. Does the server accept it?

Yes. I ran a real server process against a scratch db file and POSTed the wire payload:

```
POST /api/loadouts  {"e":[4× dynamite-stick, 4× dynamite-bundle], ...}   HTTP 201
POST /api/loadouts  {"e":[["T","knife"],["T","knife"], null×6], ...}     HTTP 201
GET  /api/loadouts  → both records returned verbatim
db file on disk     → e stored exactly as sent
```

`isValidData` (`server/src/routes/loadouts.js:88-125`) checks `data.e.length !== 8` and per-entry
shape (`:106-108`) and nothing else about equipment. It bounds `tr` to `MAX_TRAITS = 15` (`:78`,
enforced `:113`) and checks `b` for duplicates (`:122`) — so the validator does carry rules where it
was asked to. Equipment was never asked.

### 3. Attack the reachability — the hardest available attack, and it fails

Three routes, in descending order of how much I can prove:

**(a) The shipped client produced this class of record until yesterday. Proven from git.**
Seat 3 rests this on ADR-0015's §Context quote. The shallow clone hid the stronger evidence. With
full history:

```
$ git show f61fbe1^:client/src/store/loadoutSlice.js | grep 'consCount'
      if (t === "C" && consCount(state, i) >= 4) return;
$ git show f61fbe1^:client/src/utils/calc.js
export function consCount(loadout, consIndex) {
  return heldItems(loadout).filter((e) => e.t === "C" && e.i === consIndex).length;
}
$ git log -1 --format='%h %ad %s' --date=short f61fbe1
f61fbe1 2026-08-13 feat(client): capacity predicate, per-cell blocking, per-category cap (#288)
```

Until **2026-08-13**, `addEquip` counted per *specific item*. Four Dynamite Sticks plus four Dynamite
Bundles was a build the picker offered, the reducer accepted, and `toData` encoded. This is not
inference from an ADR's prose; it is the enforcing line.

**(b) A *current* client produces it too — via F1, which I have now shown is reachable.**
Click-path B above ends at five Throwables from a build that started legal. F1 and F2 compose: F1
manufactures the over-cap state, F2 is why nothing between there and the server notices.

**(c) Hand-crafted payloads.** The weakest route, and the only one Seat 3 would have needed if (a)
and (b) failed. They do not.

`[UNVERIFIED]`: how many such records the linked deployment actually holds. I cannot see production.
What is proven is that the app's own encoder produced the class, and that every reader between the
record and the screen accepts it.

### 4. Attack the evidence

I checked every citation. `fromV1` `:121-125`, `fromLegacy` `:353-358`, `fromV2` `:406-417` are the
equipment-resolution blocks and none of them consults a cap. `boundedAmmo` `:51-54` and
`boundedTraits` `:75-77` are the two bounds that do exist. `setLoadout` assigns `payload.equip`
verbatim at `:197`. `loadoutCodec.js:308-311`'s "`fromV1` has never enforced `capMax` on decode"
says what Seat 3 says it says, in the context Seat 3 gives it. The ADR-0015 quotes are verbatim — I
read the whole ADR. All load-bearing.

### 5. Correlated-recall / duplication

**Seat 1 noticed the same gap and correctly handed it off** (`seat1.md` handoff #3: *"the decoder
does not enforce the ADR-0015 four-per-type cap … Whether that is reachable … is Seat 3's
question"*). A handoff is not a parallel filing, so this is **not** a duplicate to merge — but it is
worth recording that the gap was visible from two charges.

**The structural conclusion is independently corroborated.** Seat 1's **F3** (*"Both decoders admit
duplicate trait ids, and upgrade points are charged per copy"*) reaches the same conclusion — the
decoders enforce shape, not rules — from **different evidence in a different code path**. I
reproduced Seat 1's result myself rather than taking it:

```
20 copies of one trait id decode to: 15   distinct: 1   upTotal: 120   (single-copy up = 8)
```

Different data (traits vs equipment), different mechanism (`boundedTraits` slices but does not
dedupe vs no equipment bound at all), same finding about the codec's contract. **Promote the class**
in the chair's report; keep the two findings separate, since the fixes differ.

No game number is asserted by either seat, so the correlated-recall trap does not apply.

### Severity

**P1 stands.** The player opens a saved build, sees $372 and no warning, and cannot field it. Seat
3's fix ordering argument (warn before clamping, because clamping silently discards four items the
user chose) is sound and I would not change it.

---

## F3 — The generator can never produce a size-5 weapon without Quartermaster

### Verdict: **DOWNGRADED P2 → P3.** The measurement is exactly right; the severity is not.

### 1. Reproduce — independently, 200,000 builds

```
QM rate 29.99%  | size-5 present 0.94%  | size-5 WITHOUT QM: 0  | size-5 as SOLO weapon: 0
weapons never drawn: 0        null secondary: 0
ten rarest: crown-king-auto-5=441(size 5)  mosin-nagant-avtomat=461(size 5)
            maynard-sniper-silencer=488(size 5)  nitro-express=498(size 5)
            mako-1895=1640(size 4)  …
ten commonest: bornheim-no-3=5367(size 1)  pax-trueshot=5405(size 1)  …
size histogram: {1:25, 2:35, 3:28, 4:55, 5:4}
```

Reproduces exactly, including the identity of the four affected rows and the ~11× frequency ratio.
Seat 3's counts (459/474/491/506) and mine (441/461/488/498) differ only by draw. **Zero size-5
weapons in ~140,000 non-QM builds is a structural claim and Seat 3 is right to call it one.**

The manual-path disagreement also holds: `capMax` is 5, `5 + 0 > 5` is false, so `loadoutSlice.js:75`
accepts a lone size-5 weapon the generator can never produce.

### 2. Attack the evidence

Seat 3 quotes SPEC-0008's implementation note honestly and flags the overlap itself. But the quote
is incomplete in a way that matters for severity. The full note reads:

> **"Weapon Size Caps Are Honored"** — **satisfied.** … One caveat for whoever implements the
> archetype draw: the primary filter reserves a point (`size <= cap - 1`) … and the `null`-secondary
> path the requirement describes is currently unreachable. The scenario is not falsifiable against
> today's generator.

The spec records this requirement as **satisfied**, with this exact mechanism named as a known
caveat addressed to whoever implements the archetype draw. So F3 is **not a spec violation**. Its
novel content is the *measured consequence* — four catalogued weapons unreachable in 70% of builds,
never solo — which is genuinely new and worth recording.

### 3. Attack the consequence

Granting everything: does a player get a wrong answer? **No.** Every build Randomize returns is
legal, correctly priced, and correctly sized. Nothing on screen is wrong. What is wrong is that a
novelty feature samples the catalog non-uniformly and does not claim otherwise anywhere in the UI.

The panel's ladder puts P2 at "right number, wrong label, unit, icon, or description" and P3 at
"not wrong today; wrong eventually, with nothing to catch it." F3 is neither a mislabel nor a wrong
number — it is a latent generator property that the spec already anticipates and that the archetype
work will rewrite. **P3.**

### 4. Duplication

None. No other seat touches `randomize.js`.

---

## F4 — The budget retry misses budgets that are demonstrably reachable

### Verdict: **DOWNGRADED P2 → P3.** The measurement is sound. The conformance argument is struck.

### 1. Reproduce — independently, 300,000 single attempts + 3,000 budgeted runs

```
min 129  p0.1% 209  p1% 272  p5% 340  median 594  max 2075
P(one attempt <= 200) = 0.069%  -> P(hit in 81) =  5.5%
P(one attempt <= 250) = 0.532%  -> P(hit in 81) = 35.1%
P(one attempt <= 300) = 2.177%  -> P(hit in 81) = 83.2%
P(one attempt <= 350) = 6.010%  -> P(hit in 81) = 99.3%

budget  100: over 500/500  cheapest seen 146      budget  250: over 329/500  cheapest 126
budget  150: over 498/500  cheapest 130           budget  300: over  90/500  cheapest 146
budget  200: over 468/500  cheapest 123           budget  400: over   0/500  cheapest 209
```

Every figure reproduces within noise — including Seat 3's observed **$123** floor, which my run hit
independently at budget 200. Seat 3's arithmetic is correct and its sample sizes are adequate.

### 2. Attack the evidence — this is where it comes apart

Seat 3's section is headed *"Why this is a conformance failure and not just tuning"* and quotes:

> **Scenario: A reachable budget is met** … **THEN** `totalCost` of the returned build is at or under
> `budget`

That scenario belongs to SPEC-0008's requirement **"The Dollar Budget Is Searched Within the Chosen
Archetype"**. The same spec, thirty lines above the quote, in its **Implementation status**:

> **Unbuilt:** "Every Build Originates From an Archetype", "Archetypes Are Authored as Catalog Ids",
> … **"The Dollar Budget Is Searched Within the Chosen Archetype"**, …

and, in the overview:

> the dollar budget is 80 blind re-rolls that keep the cheapest miss … **Two secondary gaps are in
> scope** [of the unbuilt capability]

The requirement F4 measures the generator against **describes the generator SPEC-0008 exists to
build**, and the spec says so in its own words. Quoting the scenario without the unbuilt note is
selective, and it converts a roadmap fact into a conformance failure. Seat 3 disclosed the
equivalent note for F3 and did not for F4; I take that as an oversight rather than anything worse,
but the argument does not survive it.

Part IV of the panel's brief is explicit: *"A missing feature. ADR-0014 and ADR-0017 being
accepted-but-unbuilt is a roadmap fact, not a data defect."* The dollar-budget search is in exactly
that category.

### 3. Attack the consequence

Seat 3 concedes the decisive point itself: *"the displayed cost is right and is marked"* —
`Header.jsx:17,33` and `ActionsPanel.jsx:26-28` recolour the total when it exceeds the budget. **No
number the player reads is wrong.** What survives is that `randomizeThunk` (`thunks.js:21`) clears
the status message on every press, so the app never distinguishes "nothing fits this budget" from "I
took 81 uniform draws and none happened to fit". That is a real honesty gap and worth recording —
as P3.

### 4. Duplication

None.

**What I would keep of F4:** the cost profile itself. It is the only quantitative characterisation of
the current sampler in the corpus, and whoever implements SPEC-0008's archetype search will want the
baseline. Recorded as a P3 with the measurement intact and the conformance framing removed.

---

## F5 — The loadout shape guard accepts an equipment array shorter than eight cells

### Verdict: **UPHELD at P3.** Reproduced exactly; Seat 3's own reachability caveat is correct.

```
setLoadout accepted equip.length=3?  true     resulting equip.length: 3
hasFreeCell: false   (five cells "should" be free)     slotMax: 8
addEquip after short array -> equip.length 3, held 3   (every add refused)
```

`isValidLoadoutShape` at `loadoutSlice.js:24` is an upper bound only. The consequence Seat 3
describes follows: `hasFreeCell` (`calc.js:42-45`) finds no `null`, so the picker
(`Picker.jsx:47`) and the reducer (`loadoutSlice.js:99`) refuse every add while
`EquipmentPanel.jsx:145` still renders eight cells, five of which look empty and would *block*
rather than fill on click.

I verified the unreachability claim rather than taking it: all three decoders pad to exactly eight
(`loadoutCodec.js:142`, `:379`, `:406-417`), `clearBuild` sets eight (`:182`), `randomize` returns
eight (`randomize.js:63`), and the three `setLoadout` callers (`App.jsx:21`, `thunks.js:20`,
`thunks.js:53`) all route through one of those. **Not reachable today.** P3 is the right tier, and
the server-is-stricter observation (`loadouts.js:106`, `data.e.length !== 8`) is accurate.

**Duplication.** None. Seat 1's F10 covers a different client/server divergence.

---

## F6 — Grid capacity is derived in three places, two of them dead, and a comment names a fourth that does not exist

### Verdict: **UPHELD at P3 — and independently corroborated. Promote above other P3s.**

### Reproduce

```
$ grep -rn "slotMax\|selectSlotMax" client/src server scripts
client/src/store/selectors.js:16     export const selectSlotMax = …8 - blocked.length
client/src/utils/calc.js:116         export function slotMax(loadout)  …8 - blocked.length
client/src/utils/loadoutCodec.js:329 // …pool (loadoutSlice's `slotMax`)…
client/src/utils/calc.test.js:3,111,121,122   ← the ONLY references to slotMax
```

Confirmed: **no production consumer of either**, and `loadoutSlice.js` contains no `slotMax`, so
`loadoutCodec.js:329` names a function that does not exist. `calc.js:29-41`'s claim that "Every
caller (reducer, picker, generator) consults this one predicate rather than re-deriving capacity"
holds for the live path — I checked all three — but two unconsulted re-derivations sit beside it.

The player-facing consequence Seat 3 gives is real: `selectEquipCount` (`selectors.js:29`) counts
filled cells, and `EquipmentPanel.jsx:132` renders `{equipCount}/8 SLOTS` regardless of blocking, so
a grid with three blocked cells reads `5/8` when it is as full as it can be.

### Corroboration — different evidence, same code, from a different charge

Seat 1's handoff #2 and their F10 reach these same two functions from the wire-format side and add
something Seat 3 does not have: the dead functions do not merely duplicate `hasFreeCell`, they
**disagree with it**. I verified this myself rather than citing Seat 1:

```
blocked [0,0]:  slotMax = 6   but truly-usable cells = 7   |  hasFreeCell = true
fromV2 dedupes b?  [0,0]      ← the client decoder does NOT dedupe; the server (loadouts.js:122) does
```

So a v2 record with a repeated blocked index — which the client codec admits and the server would
reject — makes `slotMax` off by one against the predicate that actually governs. That sharpens F6
from "dead code" to "dead code that is also wrong", and it is the strongest argument for deleting
rather than wiring up.

Two seats, two charges, different evidence, same conclusion. Seat 1 filed it as a handoff, so there
is no duplicate to merge — but the chair should record the agreement, and it earns F6 the top slot
among the P3s.

---

## F7 — Two comments state that the generator consults `hasFreeCell`; it does not import it

### Verdict: **UPHELD at P3.**

```
$ sed -n '2p' client/src/utils/randomize.js
import { TRAIT_MAX, consAllowed, totalCost } from "./calc.js";
```

No `hasFreeCell`, while `randomize.js:13-15` claims it and `calc.js:36-40` claims it from the other
side. The inline scan at `randomize.js:17` is
`equip.findIndex((e, k) => e === null && !blocked.has(k))`; `hasFreeCell`'s predicate at `calc.js:44`
is `(e, k) => e === null && !blocked.has(k)`. Seat 3 says "character-for-character the body of
`hasFreeCell`'s **predicate**" — precise, and correct as written.

The other half of the comment is genuinely true and Seat 3 says so: `consAllowed` **is** shared
(`randomize.js:79`), and my own 33,000-build fuzz confirms the sharing is real (below). No player-facing
consequence today; the exposure is drift. P3 is right.

---

## F8 — The preview's trait comment states three things that are all false

### Verdict: **UPHELD at P3 — but the diagnosis is STRUCK.** The comment is *stale*, not *confused*.

### 1. Reproduce — the three claims are false today

| Claim at `LoadoutListsPanel.jsx:105-110` | Actual, verified |
|---|---|
| "the catalog holds 32 traits" | `TRAITS.length === 58` |
| "the server accepts 40" | `MAX_TRAITS = 15` — `server/src/routes/loadouts.js:78`, enforced `:113` |
| "not an invariant this application enforces" | Enforced on `addTrait`, all three decoders, `randomize`, and the server |

```
TRAITS.length = 58   TRAIT_MAX = 15
25 distinct trait ids decode to: 15
```

The dead-code half also holds. `LoadoutCard` (`:1299`) builds its preview from `fromData(item.data)`,
which clamps to 15; `TRAIT_CELLS` is 15; so `traitOverflow = max(0, traitsHeld - 15)` is always 0 and
the `+N more` affordance at `:824-826` can never render. The only other `previewGroups` caller is its
own test.

### 2. Attack the evidence — the third sub-claim does not survive

Seat 3 writes:

> The "40" is `WIRE_CATEGORIES.tr` (`loadouts.js:33`), which bounds each trait *reference's numeric
> value*, not the count … **The client comment made the mistake the server comment was written to
> prevent.**

**Struck.** Three independent sources say the "40" was a true statement about the count when it was
written:

1. **The pre-#222 server source.** With full history recovered:
   ```
   $ git show bb99434^:server/src/routes/loadouts.js | grep 'data.tr'
     if (!Array.isArray(data.tr) || data.tr.length > 40) return false;
   ```
   A literal `40` on the **count**, not `WIRE_CATEGORIES.tr`.
2. **The server's own current comment** (`loadouts.js:66`): *"**Tightened from 40**, and exact rather
   than a floor."*
3. **SPEC-0003** (`hunter-loadout-lists/spec.md:603`) carries the *identical sentence*, struck
   through, with: *"**Amended 2026-08-11 (ADR-0012)** … The struck sentence **was true when written**
   and its premise no longer holds."*

The "32 traits" clause was likewise true when written — `catalog.js:604-606` records 32 as the
pre-#157 count, and the comment landed in `4dd12a0` (#175), before both changes.

So the comment is a **uniformly stale** paragraph that outlived two separate changes, and the repo
had *already corrected the same sentence in the spec* and left the code copy behind. That is a
different defect from an author confusing an index bound for a count bound, and it points at a
different fix: not "correct three figures", but "this sentence exists in two places and only one was
amended — find the other copies." Seat 3's fix direction happens to work; its reasoning does not.

### 3. Consequence

None to the player. Cost is to the next reader, as Seat 3 says. **P3 stands.**

### 4. Duplication — a genuine cross-seat class

- **Seat 5 F10** finds the same stale "32" in a *different* file (`itemStats.test.js:150-153`), with
  its own derivation of 58. Different evidence, same root cause. `grep` finds the stale 32 in **five**
  live locations: `LoadoutListsPanel.jsx:109`, `global.css:1096`, `itemStats.test.js:150`,
  `scrape-stats.mjs:975` and `:1372`, plus `scrape-stats.test.mjs:1410`.
- **Seat 5 F12** ("the Trait cap control does not cap traits") is a third artifact in the same class —
  the app's own descriptions of the fifteen-trait rule have drifted from the rule.

**Recommendation to the chair:** merge Seat 3 F8 and Seat 5 F10 into one class-level P3 —
*"the trait-count denominator is stale in five live locations; the fifteen-trait cap is described
as unenforced in one"* — keeping both citations. That is corroboration by different evidence, not a
duplicate.

---

## F9 — `mkAmmo` reads a pool unguarded where `totalCost` guards the same lookup

### Verdict: **UPHELD at P3.**

```
ammoClasses used by WEAPONS: compact,medium,hxbow,none,long,bow,special,shotgun,xbow,slong
AMMO keys:                   compact,medium,long,slong,shotgun,xbow,hxbow,bow,special,none
used-but-missing: []   declared-but-unused: []   empty pools: [special, none]
```

The asymmetry is real (`randomize.js:58` has no `|| []`; `calc.js:152` does) and it is not live.
The empty-pool half of the charge is answered correctly: the `.length` test short-circuits, and my
own 200,000-build run recorded **zero** out-of-range ammo indices and no `special`/`none` selection.
Seat 3's status line — "CONFIRMED (asymmetry) / not live" — is exactly the right calibration.

Note for the chair: Seat 1's **F9** and Seat 2's **F7** both report that `catalog.js:55`'s comment
names six `special`-pool weapons where nine exist. Seat 3's F9 is about a *different* thing (the
missing `|| []`), and its passing reference to "six weapons" is quoting the panel brief, not making a
claim. Do not merge them.

---

## F10 — `consCount` was retired by ADR-0015 and is still exported

### Verdict: **UPHELD at P3.**

`calc.js` exports `consCount` at `:133-135`; its only reference anywhere is `calc.test.js`
(lines 3, 79, 88, 89, 101, 106, 107). `calc.js:96-97` says "Per-item counting is RETIRED, not kept
alongside"; ADR-0015's Decision Outcome says the same. The ADR's rejected "enforce both caps" option
was rejected partly because *"a future reader cannot tell which is load-bearing"* — Seat 3's point
that the exported function reproduces that ambiguity in code is fair and the severity is right.

---

## Seat 3's negative results — independently re-run

The brief says a negative result is part of the filing. I re-ran the load-bearing ones with my own
harness rather than accepting the counts.

**Generator invariants — reproduced.** 11 option scenarios × 3,000 builds = 33,000, nine invariants
each (grid length, slot cap, trait cap, trait uniqueness, no item in a blocked cell, per-cap-category
≤ 4, no duplicate tool, ammo index in range, starter present):

```
plain {}   blocked[0] {}   blocked 0-6 {}   blocked all {}   budget100 {}   budget0 {}
budget-5 {}   up0 {}   up1 {}   mixed(blocked[3,4]+budget50+up2) {}   blocked dup {}
```

Zero violations everywhere, plus 200,000 more builds with zero over-slot-cap, over-trait-cap or
duplicate-trait results. **Seat 3's headline negative — "the randomizer cannot produce a loadout the
manual UI would refuse" — holds, and I add a twelfth scenario (duplicate blocked indices) it did not
try, which also comes back clean.**

**No consumable row's `type` is undeclared — reproduced.**

```
CONS types present: ["Shot","Throwable","Placeable"]
CONS_CAP_CATEGORIES: ["Shot","Throwable","Placeable","Tarot Cards"]
CONS_TYPES:          ["Shot","Throwable","Placeable"]
rows resolving to UNDECLARED: []
```

`capCategoryOf` never returns the sentinel for any catalogued row. Seat 3's answer to its own charge
bullet is correct. Note that **Seat 2's F3** questions whether `dark-dynamite-satchel` carries the
*right* type — a live question about the value, not about whether it is declared. The two do not
conflict, and Seat 3 correctly scoped it out ("I did not audit item identity").

**One scope boundary the chair should not read as coverage.** Seat 3's negative result on trait
`up = 0` ("the eight zeroes are structural … `[UNVERIFIED]` whether a Scarce trait costs upgrade
points in the live game") clears the *pinning* of those rows and nothing else. **Seat 5's F2** shows
the same eight ids rendered as "0 pts" on three surfaces, which ADR-0018 already calls *"the current
false claim"* and *"the only part of this that is unambiguously a bug"*. Seat 3's negative must not be
cited as clearing those rows; it clears a different question about them.

---

## Notes for the chair

**Where Seat 3's method failed, and it is instructive.** F1 was filed P2 because Seat 3 enumerated
the three `moveEquip` dispatchers and found each one's `from` occupied at grab time. That enumeration
is correct. It could not find the path because the defect is not in a dispatcher — it is that
`grabRef` (`EquipmentPanel.jsx:35`) survives a `setLoadout`. Tracing *call sites* cannot find a
*lifetime* bug. Worth recording alongside the promotion: Seat 3 named the right uncertainty
("UI reachability is argued from code reading, not from a browser") and invited the challenge, which
is what made it cheap to run.

**Where I could not break Seat 3.** Every pointer path I tried holds. `startGrab` refuses an empty
cell, the off-grid release guards `equip[from] === null`, and the ✕ removal effect
(`EquipmentSlot.jsx:121-132`) really does null a live grab — my control test confirms it. Seat 3's
pointer-side analysis is sound and should be recorded as verified, not merely unchallenged.

**One adjacent observation, flagged `[UNVERIFIED]`.** `onGridPointerUp` (`EquipmentPanel.jsx:42-62`)
does not compare `e.pointerId` against `grab.pointerId`, where `onGridPointerCancel` (`:70`) and
`onLostPointerCapture` (`:79`) both do. On the code, two concurrent grabs (touch on the grip, mouse
on a tile) would let the release of one pointer apply the other's grab. I could not verify it — jsdom
implements neither pointer capture nor `elementFromPoint`, and my attempt produced no state change,
which is a null result about the harness rather than about the browser. Not filed as a finding.
Recorded because it belongs with F1's fix: the grab ref needs an owner, a lifetime, and a
pointer-identity check.

**Blind spot, restated so silence does not imply coverage.** Items missing from the catalog entirely
are invisible from inside it; `scrape-stats.mjs --discover` is the instrument and no seat may run it.
Seat 3's handoff #6 says so and is right.

---

## Summary for the chair

| Finding | Seat 3 | Verdict | One-line reason |
|---|---|---|---|
| **F1** `moveEquip` duplicates on empty source | P2 | **P1 (promoted)** | Two click-paths found and measured — Randomize button and Load-saved; yields 2 Knives and 5 Throwables |
| **F2** decoders enforce no equipment rule | P1 | **P1 (upheld)** | Real share URL round-trips 8 Throwables at $372, no warning; server returns 201 and stores verbatim; git shows the shipped client produced this class until 2026-08-13 |
| **F3** generator excludes size-5 without QM | P2 | **P3 (downgraded)** | Measurement exact; no wrong number reaches the player, and SPEC-0008 records the requirement as *satisfied* with this caveat pre-recorded |
| **F4** budget retry misses reachable budgets | P2 | **P3 (downgraded)** | Measurement exact; the conformance argument quotes a requirement the same spec lists as **Unbuilt** — a roadmap fact under Part IV |
| **F5** shape guard accepts a short `equip` | P3 | **P3 (upheld)** | Reproduced; unreachable from all three callers, as filed |
| **F6** capacity derived three times, two dead | P3 | **P3 (upheld, corroborated)** | Reproduced; Seat 1 reaches the same code from the wire-format side and adds that `slotMax` *disagrees* with `hasFreeCell` on duplicate blocked indices — I verified it (6 vs 7) |
| **F7** comments claim the generator uses `hasFreeCell` | P3 | **P3 (upheld)** | Import list confirms it does not |
| **F8** preview trait comment states three false things | P3 | **P3 (upheld; sub-claim struck)** | All three clauses false today — but the "`WIRE_CATEGORIES.tr` confusion" diagnosis is struck: the pre-#222 server literally bounded `tr.length > 40`. Stale, not confused |
| **F9** `mkAmmo` unguarded where `totalCost` guards | P3 | **P3 (upheld)** | Asymmetry real, not live; calibration correct as filed |
| **F10** `consCount` retired but exported | P3 | **P3 (upheld)** | Only reference is its own test |

**Promotions:** F1 → P1. F6 → top of the P3 tier on independent corroboration.
**Demotions:** F3 → P3. F4 → P3.
**Struck:** F8's attribution of the "40" to `WIRE_CATEGORIES.tr`. No finding struck in whole.
**Merge:** Seat 3 F8 + Seat 5 F10 into one class-level P3 (stale trait denominator, five live sites).
**Corroborated, keep separate:** Seat 3 F2 + Seat 1 F3 — same conclusion about the codec's contract,
different code paths, different data.
