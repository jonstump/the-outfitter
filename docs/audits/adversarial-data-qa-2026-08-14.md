# Adversarial QA Panel Review — Data Correctness

**Date:** 2026-08-14
**Scope:** the game dataset and the rules that consume it — `client/src/data/`, `data/hunters.json`,
`client/src/utils/`, and the 22 ADRs and 8 specs governing them
**Process:** [`docs/prompts/adversarial-data-qa-review.md`](../prompts/adversarial-data-qa-review.md)
— five independent seats (Round 1), five cross-examinations by non-authors (Round 2), chair
consolidation (Round 3)
**Status:** Complete. 51 findings filed in Round 1; 43 survive Round 2 at the severities below.
**Result:** 1 P0 · 2 P1 · 9 P2 · 31 P3

---

## Method and its limits — read this first

This section is the report's credibility. Four constraints bounded what this panel could see, and
one of them was caused by the panel itself.

### 1. The wiki was unreachable, for every seat

`huntshowdown.wiki.gg` — the source of truth under ADR-0002 and ADR-0005 — answers `403` at
`CONNECT` from this environment. All five seats verified this independently; one confirmed the
block is not host-specific (`example.com` fails identically).

**What this means for every finding below.** The panel's oracle was the committed scrape
(`itemStats.json`, carrying `wikiUrl` and `sourceRevision` per record) plus internal consistency.
That is enough to find disagreements *between* the app's own artifacts, and every confirmed finding
here is of that kind. It is **not** enough to find a value where the catalog and the scrape agree
and both are stale. **No finding in this report asserts what the game actually charges.** Where a
magnitude figure originates from a document written when the wiki was still reachable, it is marked
`[UNVERIFIED]` and attributed rather than adopted.

The honesty rule held. Across 51 Round 1 findings, no seat asserted a game number from recall, and
Round 2 confirmed this explicitly for the filings where it was most tempting.

### 2. The working tree is a shallow clone — and it cost the panel a finding

`git rev-parse --is-shallow-repository` returns `true`. Only ~52 commits are visible, grafted at
`4e5d239` (2026-08-12); the true history is 277 commits. `git log -p -- catalog.js` returns 8
commits here against 26 in reality.

**Any seat whose charge touched history under-reported unless it recovered full history first.**
Seat 1 did, into an isolated bare mirror in scratch space. Seat 5 did not, and that is the direct
cause of its F6 — a finding whose proposed fix would have deleted the only in-file justification for
a live alias in `loadoutCodec.js`. Round 2 struck it. Seat 5's conclusion was not merely wrong; it
was confidently wrong in a way that reads as a cleanup.

This is the single most important lesson for the next panel: **verify clone depth before assigning a
history-dependent charge.**

### 3. `npm test` does not run in this environment

Node here is v22 against a pinned `engines.node: ^20` with `engine-strict=true`, and `vitest` is not
on the workspace script's PATH. `npm test` exits 127 without running anything.

Run directly, the baseline is green, and every finding in this report is filed against that green
baseline:

| Suite | Result |
|---|---|
| Client | 759 passed |
| Server | 161 passed, 1 skipped |
| Scrape scripts | 321 passed |

### 4. The panel corrupted its own test baseline — an orchestration defect, not an app defect

Several seats observed large server-suite failures (43, 94, and 139 in different filings). These are
**an artifact of running five seats concurrently**: every run of the server suite uses one
hardcoded, gitignored `server/data/db.test.json`, so concurrent seats clobbered each other's
fixture.

The diagnosis was itself contested, and Round 2 resolved it. Seat 4 attributed the failures to
vitest parallelising seven test files over one db; the challenger struck that — `server/vitest.config.js:17`
already sets `fileParallelism: false`, and the suite run alone under default settings passes 161/1-skipped.
Seats 1 and 5 correctly identified the shared hardcoded path. **Round 2 challengers were told the
verified baseline and instructed not to run that suite concurrently**, so the artifact was not
reproduced during cross-examination.

Next panel: give each seat a private db path, or forbid the server suite outside a designated seat.

### 5. Two errors in the panel's own brief, caught by the panel

Both were mine, and both are recorded here rather than quietly corrected, because a brief that
misstates the data is a source of exactly the anchoring this process exists to resist.

- **`obtainable`.** The brief stated that 2 hunters are `obtainable: false`. They are
  `obtainable: null` — 240 `true`, 2 `null`, **zero `false`**. Seat 4 caught it and its challenger
  confirmed the values independently. The consequence is a real finding: the picker's "Not
  obtainable" filter cannot match any hunter, and both tests covering it invent `obtainable: false`
  fixtures rather than using shipped data.
- **Two predicted headline artifacts did not exist.** The brief told Seat 2 that enumerating catalog
  rows unpinned by `itemStats` would be "probably the single most valuable artifact the panel
  produces," and told Seat 4 to expect a long list of items silently running on the SVG image
  fallback. Both came back empty: **256 of 256 catalog rows are covered**, zero orphans in either
  direction, and **0 missing images, 0 orphans, 0 slug collisions across 498 files** in five trees.
  Both seats substituted better artifacts of their own — a per-*column* provenance table, and a
  re-derivation that first verified which tuple field each `ItemThumb` call site passes as `name`,
  since a method reading the wrong field would produce clean zeros for the wrong reason.

### 6. The filer-response step was never run, and two disagreements are unresolved because of it

The process allows the filer of a challenged finding to respond once, with new evidence or a
concession, before the chair records the dispute. **That step was not run.** The chair moved from
Round 2 straight to consolidation, so two challenges that explicitly invited a response
(S4-F1's severity, S4-F7's scope) went unanswered, and both are recorded in Unresolved
disagreements with the challenger's severity carried into the table and the filer's position
stated verbatim beside it.

This is a chair error, not a seat error. The affected findings are P3-tier and the outcome is
unlikely to change, but the asymmetry is real: a challenger's verdict was adopted where the
process entitles the filer to reply first.

A second, subtler artifact of the same round: because each filing was challenged in isolation,
**two challengers each deferred the ammo P1 to the other's finding**, and neither survives at P1
as a result. Neither challenger saw the other's verdict. See Unresolved disagreement #1 — the
chair did not invent a P1 to fill the gap, and the underlying defect is recorded at P2 in two
places rather than P1 in one.

### 7. What no seat could check

**Items missing from the catalog entirely.** Detecting them requires `scrape-stats.mjs --discover`,
which crawls the wiki's category indexes — unavailable (network) and forbidden by the brief (it
would rewrite committed data). No seat covered this and none claims to. It is stated here so that
silence is not read as coverage.

Also uncovered, as a consequence of limit 1: any value where `catalog.js` and `itemStats.json` agree
with each other and both are stale relative to the live game.

---

## Findings

**43 findings survive Round 2**, at the severities Round 2 assigned — not the severities Round 1
filed. Ordering is most-severe first; **at equal severity, findings with independent corroboration
(two seats, *different* evidence) rank above single-seat findings** and are marked `⊕`.

| Severity | Count | Ids |
|---|---|---|
| **P0** — corrupts saved data | **1** | S1-F1 |
| **P1** — wrong answer, silently | **2** | S3-F1 (promoted from P2), S3-F2 |
| **P2** — wrong presentation | **9** | S4-F3 ⊕, S2-F1 ⊕, S5-F1 ⊕, S1-F3 ⊕, S1-F5, S1-F2, S1-F4, S2-F2, S5-F2 |
| **P3** — unverifiable / rot risk | **31** | see the P3 table |

Ids are `S<seat>-F<n>`, traceable to the Round 1 filing that raised them. Seat 4 numbered its own
findings `F4-1…F4-7`; they appear here as `S4-F1…S4-F7`, same findings.

**The honesty limit binds every row below.** The wiki was unreachable for all ten filings, so **no
finding in this report asserts what the live game charges, sells, or permits.** Every "wrong"
below means *the app disagrees with its own past, its own artifacts, or a rule this repo wrote about
itself*. Figures a filing marked `[UNVERIFIED]` stay marked. Where a filing's wording drifted toward
a claim about the live game, the evidence is kept and the limit is restated in the row.

Six fix directions were shown in Round 2 to be wrong or actively harmful. Those rows say
**FIX CORRECTED** and the originals are recorded in [Struck findings](#struck-findings).

---

### P0 — corrupts saved data

#### S1-F1 — A saved Frontier 73C ammo selection decodes to a different round than it was saved as

| | |
|---|---|
| **Severity** | **P0** (filed P0, upheld at P0) |
| **Status** | **CONFIRMED**. Single-seat, but every mechanical link independently re-derived in Round 2 |
| **Where** | `client/src/data/catalog.js:132` (`ammoClass` now `compact`); decoders `client/src/utils/loadoutCodec.js:51` (`boundedAmmo`), `:111` (`fromV1`), `:342` (`fromLegacy`); disclosure comment `catalog.js:118–131`. Change landed in `e9b2c1d` (2026-08-10) |
| **Defect** | `frontier-73c` moved between two *non-empty*, equal-length ammo pools with no `FORMAT_VERSION` bump and no saved-selection migration, so a stored index-1 selection silently re-points to a different round |
| **Evidence** | Both pools length 5 (`catalog.js:47–48`): `medium[1]` = Spitzer $60, `compact[1]` = High Velocity $13, so `boundedAmmo` cannot see the change. Legacy position 20 is Frontier 73C at `medium` (`2a6bd05^`). `FORMAT_VERSION` was 1 before and after; 2 arrived three days later at `0f4f5b1`. Round 2 re-derived all of it in an independent 277-commit bare mirror and reproduced the wrong decode via **legacy, v1 *and* v2**: `Frontier 73C / a=1 -> ["High Velocity",13]` |
| **Consequence** | A pre-2026-08-10 Frontier 73C build opens today showing a different round at a different price. Nothing errors; the cost total just changes. Indices 0, 2, 3, 4 keep the round *name* at the other pool's price; index 1 is the one where the round itself changes |
| **Population bound (Round 2, carry it with the finding)** | A wrong record needs Frontier 73C *and* ammo index exactly 1, written before `e9b2c1d` (2026-08-10 07:08 UTC). Persistence predates the defect (localStorage and server saves both present in `1572027`, 2026-08-07); a deployable path landed at `e66b47b` (2026-08-09 19:28 UTC) and issue #189 (2026-08-11 04:17 UTC) documents real deployed use — **so user data can be in this state**, which is the test that keeps this P0 rather than P3. The true count is plausibly zero and is **unknowable from the repository**. The public deployment link landed only 2026-08-13 (`3575641`) |
| **Novelty** | Low, and Round 2 says so: `catalog.js:118–131` names this exact defect, index and price pair and records it as *accepted rather than migrated*, and `docs/audits/weapon-catalog-wiki-audit.md` §3.3 recorded the correction at **Confidence: HIGH** beforehand. The actionable residue is the fix analysis |
| **Fix direction** | **FIX CORRECTED.** Seat 1 proposed an era-scoped ammo remap applied in `fromLegacy` **only**, on the ground that the legacy half is deterministically fixable. Round 2 struck that split: `toData` always stamps `v: FORMAT_VERSION` and the store subscriber persists every decoded loadout (`store/index.js:22-28`, reached from `App.jsx:20-21`), so **any legacy record opened even once since `0f4f5b1` (2026-08-13) is now an unmarked v2 record** carrying `["frontier-73c", 1]`, indistinguishable from a native v2 record — and opening the build is the only way a user would notice. A `fromLegacy`-only remap is therefore **repairable only for records never opened since 2026-08-13**. Seat 1's *reason* for legacy determinism (a date argument) is also unsound as written; the surviving argument is that a bundle old enough to write an unversioned record necessarily carries the pre-change catalog. The v1 half stands as permanently ambiguous — record it in the codec header as a known, closed-off defect |
| **Limit** | Seat 1 and its challenger both decline to say which of the two rounds the game sells. Neither can. |

---

### P1 — wrong answer, silently

#### S3-F1 — `moveEquip` duplicates an item when the source cell is empty

| | |
|---|---|
| **Severity** | **P1** — **promoted from P2 in Round 2**, on exactly the ground Seat 3 invited ("a challenger who finds a path should promote this to P1") |
| **Status** | **CONFIRMED** (reducer defect and reachability) |
| **Where** | `client/src/store/loadoutSlice.js:123-140` |
| **Defect** | When `from` is empty and `to` is filled, `moving` binds to `equip[to]` and **both** cells are assigned it; the `moving === null` guard at `:137` is dead |
| **Evidence** | Seat 3 reproduced the reducer defect in three dispatches (Knife → 8 × Knife, cost 40 → 320; 8 × Dynamite Stick, cost 144, Throwables 8 against a cap of 4; survives `fromData(toData(...))`). `moveEquip` has **zero tests** — `grep -rn '\bmoveEquip\b' client/src --include=*.test.js --include=*.test.jsx` returns 0 (a naive grep matches `removeEquip` as a substring). Round 2 built a component-level harness (real store, real `EquipmentPanel`/`EquipmentSlot`, real `randomizeThunk`/`loadSavedThunk`, `@testing-library/react` in jsdom) and **found two click-paths**: **(A)** grab a tile, arrow, click **Randomize**, press Enter — measured, two Throwing Axes, cost 483 → 533, a *tool*, which `addEquip`'s one-per-loadout guard (`loadoutSlice.js:104`) forbids; **(B)** grab, arrow, click **Load** on a saved record with a hole, press Enter — measured, 4 Throwables at the cap → 5 over it, and a two-Knife variant at cost 80. The mechanism is a **lifetime bug, not a dispatcher bug**: `grabRef` (`EquipmentPanel.jsx:35`) is cleared by pointerup, pointercancel, lost capture and the ✕ removal effect, but by **nothing that replaces the loadout**. Seat 3's own handoff #2 is the accelerant — Escape cancels only while `ref.current.from === index` (`EquipmentSlot.jsx:50`) while the arrows move `from` away (`EquipmentPanel.jsx:111`), so a user who grabs, arrows and presses Escape still holds the grab |
| **Consequence** | A build the game refuses (two of a unique tool; five of a four-per-type category), priced confidently, round-tripped unchanged, persisted to localStorage and savable to the server. The comment at `loadoutSlice.js:117-122` asserts the violated invariant as fact — *"a move is a PERMUTATION of cells … the total cost, and every capacity total are untouched"* — and all three clauses are false for this input class |
| **Honest qualifier (Round 2)** | The duplicate is *visible* as a second tile, so it is not invisible the way S3-F2's decoded record is. What is silent is that the app never says the state is illegal — the equipment panel has no over-capacity surface at all |
| **Fix direction** | **FIX EXTENDED.** Seat 3's "the reducer must require an occupant at `from`" is right and **insufficient**: clear `grabRef` whenever the loadout is replaced (a `useEffect` on the equip identity), and fix the Escape guard to compare against `origin`, not `from`. Add Seat 3's four-occupancy reducer test suite (empty→empty, empty→filled, filled→empty, filled→filled) and correct the comment in the same change |
| **Round 2 note, `[UNVERIFIED]`, filed by nobody** | `onGridPointerUp` (`EquipmentPanel.jsx:42-62`) does not compare `e.pointerId` against `grab.pointerId` where `onGridPointerCancel` (`:70`) and `onLostPointerCapture` (`:79`) both do. jsdom models neither pointer capture nor `elementFromPoint`, so the challenger's null result is about the harness. Not a finding; it belongs with this fix — the grab ref needs an owner, a lifetime and a pointer-identity check |
| **Limit** | Both click-paths were exercised through React's synthetic events in jsdom, not in a browser. Both use only keyboard events and one button click |

#### S3-F2 — No decoder enforces any equipment rule; a saved over-cap build loads, prices, and re-saves silently ⊕

| | |
|---|---|
| **Severity** | **P1** (filed P1, upheld at P1 after the challenger was asked to argue it down) |
| **Status** | **CONFIRMED**. ⊕ Corroborated **in class** by S1-F3 — same conclusion about the codec's contract, different code path and different data. Round 2 says keep the two findings separate because the fixes differ |
| **Where** | `client/src/utils/loadoutCodec.js:121-125` (`fromV1`), `:406-417` (`fromV2`), `:354-358` (`fromLegacy`); `client/src/store/loadoutSlice.js:191-234` (`setLoadout`) |
| **Defect** | All three decoders resolve equipment by catalog id and stop; nothing applies ADR-0015's four-per-type cap or tool uniqueness, while `boundedTraits` clamps the one cap it was asked to |
| **Evidence** | v2 decode of 4 × Dynamite Stick + 4 × Dynamite Bundle → held 8, `{"Throwable":8}`, `totalCost` 372, round-trips through `toData` unchanged; control: 25 trait ids decode to 15. Round 2 drove it **end to end through a real share URL** — `encodeShareUrl` → `location.hash` → `readHashLoadout` (what `App.jsx:20` calls on boot) → store → render → `toData` → `writeStoredLoadout` — and rendered the panel: `"8/8 SLOTS · MAX 4 PER CONSUMABLE TYPE"`, and no `"Over capacity"` string anywhere on screen. It then **POSTed the same payload to a live server process**: `HTTP 201`, both the 8-Throwable and the 2-Knife records stored verbatim (`isValidData`, `server/src/routes/loadouts.js:88-125`, checks `e.length !== 8` and per-entry shape and nothing else). Reachability is proven from git, not inferred from an ADR: until `f61fbe1` (2026-08-13) `addEquip` counted per *specific item* (`consCount(state, i) >= 4`), so four Sticks plus four Bundles was a build the shipped client offered, accepted and encoded |
| **Consequence** | A saved loadout opens with eight Throwables, `$372`, no warning anywhere, and cannot be fielded. Editing anything and re-saving writes it straight back. The only hint is `Picker.jsx:108`'s `8/4 of type`, visible only inside the Consumables tab |
| **Fix direction** | Two moves, **and the ordering is load-bearing**: (1) give the equipment panel the over-cap surface `WeaponsPanel.jsx:8,33-35` already has, driven by `consAllowed`/`capCategoryOf` rather than a re-derivation; (2) then clamp on decode — a `boundedEquip` beside `boundedTraits`, applied by all three decoders. Clamping **first** silently discards four items the user chose; ADR-0015's own consequence list argues the tightening should be visible. Round 2 endorses Seat 3's ordering unchanged |
| **Limit** | `[UNVERIFIED]`: how many such records the linked deployment holds. What is proven is that the app's own encoder produced the class and that every reader between the record and the screen accepts it |

---

### P2 — wrong presentation

Corroborated findings first (`⊕`), then single-seat.

#### S4-F3 — 26 hunter descriptions carry stray whitespace before punctuation ⊕

| | |
|---|---|
| **Severity** | **P2** (filed P2, upheld; **promoted** within the tier) |
| **Status** | **CONFIRMED**. ⊕ Corroborated by **S5-F9** — different file, different scraper, different consumer, neither resting on recall. Round 2 calls this "the panel's one genuine corroboration" and asks that the pair be kept as **two findings with a shared root and a shared fix**, because merging would lose the fact that two independent surfaces are affected |
| **Where** | `scripts/scrape-hunters.mjs:220-231` (`stripTags`) versus `scripts/scrape-stats.mjs:1011-1021` (`tidyProse`) and `client/src/data/itemStats.test.js:161` |
| **Defect** | Both scrapers replace every tag with a space; the item scraper noticed and fixed it and pinned the fix across the item dataset, and the hunter scraper has no equivalent and no test applies the predicate to `hunters.json` |
| **Evidence** | The item suite's own regex over the roster: `/\s+[,.;:!?](\s\|$)/` → **21**, `/\s['’]s\b/` → **5**, union **26 of 242**. Round 2 re-derived both counts with its own predicates and named all 26 ids. Samples verbatim: `the-reverend` *"…tear each other apart in Stillwater Bayou . Barely escaping…"*, `the-scarecrow` *"Caught stealing from Golden Acres , Jeremy Albano was beaten…"*, `monroe` *"…at Huff 's hands."*. Folded in, same root: three `U+00B4 ACUTE ACCENT` instances standing in for apostrophes in `luna-wolf` and `mama-maye` |
| **Consequence** | These strings render. `descriptionOf` (`LoadoutListsPanel.jsx:885-888`) returns the hunter's description, `:907-913` resolves it as inherited text, and `DescriptionBlock` (`:1143-1171`) renders it in `<p className="ll-desc">`. Round 2 traced it to the pixel: a list illustrated with The Reverend and carrying no stored description of its own displays the mangled sentence on the card. **This is the strongest live player-facing consequence in the P2 tier** |
| **Fix direction** | Scraper fix plus re-scrape — never a hand-edit of the generated file. Move `tidyProse` into `scripts/lib/wiki.mjs` (both scrapers already share it) and apply it on the hunter **description** path — **not** to `stripTags` wholesale, for the reason `scrape-stats.mjs:1016-1018` gives: `stripTags` is shared with the infobox `Source` parse, and loosening it there would rewrite the verbatim classification strings this dataset deliberately preserves. Then port `itemStats.test.js:161` to run against `HUNTERS`. Shared with S5-F9 — see [coupled findings](#merged-and-coupled-findings) |
| **Struck sub-claim** | *"`marian-lee` also ends with a trailing space that survived `.trim()`"* — **struck**; zero of the 242 descriptions have leading or trailing whitespace. `marian-lee` still belongs in the 21 |

#### S2-F1 — `Conversion` and `Conversion Chain Pistol` are typed out of the pool the scrape reports ⊕

| | |
|---|---|
| **Severity** | **P2** — **downgraded from P1**. The disagreement is upheld without qualification; the P1 *consequence* does not survive |
| **Status** | **CONFIRMED** as a disagreement between the app's own artifacts. ⊕ Corroboration is **disputed** — see [Unresolved disagreements](#unresolved-disagreements) #1 and #2 |
| **Where** | `client/src/data/catalog.js:100`, `client/src/data/catalog.js:285`; items `caldwell-conversion-pistol`, `conversion-chain-pistol` |
| **Defect** | Both rows are hand-authored `ammoClass: "medium"` while the committed scrape records their infobox `AmmoType` as `"Compact"` |
| **Evidence** | `caldwell-conversion-pistol` rev **16153**, `https://huntshowdown.wiki.gg/wiki/Weapons/Conversion`; `conversion-chain-pistol` rev **16154**, `https://huntshowdown.wiki.gg/wiki/Weapons/Conversion/Chain_Pistol`. These are **the only two of 147 rows** that break the mapping; Round 2 re-derived the whole cross-tabulation independently and got the same two. Round 2 then attacked the evidence three ways and could not break it: both pages are `selectedBy: canonical-title`, and the *same infobox* supplied the `Price`/`Size` the repo already treats as authoritative and that `itemStats.test.js` pins; no comment anywhere in the repo covers the Conversion (`catalog.js:236-242` documents only the `"Special"` fan-out and `"Medium"`-covers-`shotgun`, *"(the Drilling)"*); and it is not the dual-family case — the Conversion's `Loaded` is `"6"` and `Extra` is `"18"`, no slash, so it is single-family. Recovered history shows the value is original hand-authored data from `1572027` (2026-08-07), never reconciled; `weapon-catalog-wiki-audit.md:218-222` independently lists Conversion among families left `[VERIFY AGAINST LIVE WIKI]` |
| **Consequence (what survives)** | `ammoClass` drives two live display consumers besides price: `Picker.jsx:41`'s filter (`aOK`) — selecting the **Compact** chip hides both rows; and `Picker.jsx:60`/`AMMO_LABEL` — the picker's meta line reads **"Medium ammo"** on both. That is a wrong label and a wrong filter bucket, reachable today, on the field ADR-0014 says survives *"as a display grouping"* → P2 |
| **Consequence (struck as P1)** | Seat 2's per-index delta table (FMJ +$7, Spitzer +$47, Dumdum +$6, Incendiary +$6, Poison +$5) and its conclusion that *"the cost line is overstated"* were attacked in Round 2 from `docs/reports/suggested-adrs.md` §A2, written when the wiki was reachable, which quotes the Conversion's own ammo section and gives the app charging **22 against a stated 50** — *understated*, not overstated, and the directed fix moves it to `AMMO.compact`'s **15**, further from that source. **This is disputed and unresolved** (see #2); no reading of it may be stated as what the live game charges |
| **Fix direction** | **DO NOT hand-edit this row to `compact` in isolation.** `AMMO.medium` and `AMMO.compact` are both length 5, so a bare re-class re-points every already-saved Conversion selection with no bounds check tripping — index 1 flips Spitzer ($60) → High Velocity ($13) — which is S1-F1 manufactured a second time. `catalog.js:122-131` records that this cost was *accepted rather than migrated* for `frontier-73c`; doing it twice compounds it. Round 2 calls the coupling "the most valuable part of the finding". The right shape is: confirm `AmmoType` against a live fetch, then land the class change **with** a `FORMAT_VERSION` bump and a saved-selection migration, per the gate at `catalog.js:39-41` |

#### S5-F1 — The ammo select asserts a per-weapon compatibility, and a price, that the app does not model ⊕

| | |
|---|---|
| **Severity** | **P2** — **downgraded from P1** |
| **Status** | **CONFIRMED** (mechanism) / magnitude **`[UNVERIFIED]`**. ⊕ Corroboration relationship to S2-F1 is disputed — see #1 |
| **Where** | `client/src/components/WeaponsPanel/WeaponSlot.jsx:30,37-38,57,78-81` |
| **Defect** | `WeaponSlot` builds its round list as `AMMO[def[4]]` — the whole class pool — renders each as `<option>{v[0]} (+${v[1]})</option>` and adds the selection to *this weapon's* price line, so the UI makes two affirmative per-weapon claims the app does not model |
| **Evidence** | Round 2 rendered the component rather than reading the path. For `caldwell-conversion-pistol` at index 1: `<div class="weapon-meta">Size 1 · Medium ammo · Spitzer</div>`, `<div class="weapon-cost">$115</div>`, and a select offering `FMJ (+$22) / Spitzer (+$60) / Dumdum (+$28) / Incendiary (+$24) / Poison (+$21)`. **`587` is promoted from cited to CONFIRMED** — Round 2 derived it from `catalog.js` alone (`sum over WEAPONS of AMMO[w[4]].length` = 587). Also derived from committed data: 147 weapons, 140 non-melee, 31 `AMMO` rows across 8 non-empty pools |
| **`[UNVERIFIED]` magnitudes** | ADR-0014's `491`, `243`, `147`, `137 of 140` and `13 of 46` all come from **one** live pass on 2026-08-12 recorded at `docs/reports/suggested-adrs.md:400-411`. Seat 5 marked them cited-not-verified and refused to assert them; Round 2 confirms they are unreplicable by anyone on this panel. **They stay `[UNVERIFIED]` in this report** and are not restated as facts about the game |
| **Consequence** | The app renders a class-derived price list inside a per-weapon control with no disclosure anywhere that compatibility is unmodelled. Right number for the model the repo documents at `catalog.js:43-45`; wrong label → P2. Round 2's mitigation, which Seat 5 did not engage: the meta line already renders the class by name (`Size 1 · Medium ammo`) directly above the control, so the UI is not wholly silent — a hint, not a disclosure |
| **Fix direction** | Until ADR-0014 lands, stop implying per-weapon compatibility: label the control as a class-wide price list, or disclose beside it that compatibility is not modelled. **Do not add a hand-authored compatibility table** — that is ADR-0014's job and SPEC-0007 forbids inferring it. Round 2 notes the fix is half-implemented already via the meta line |
| **Not a missing-feature restatement** | ADR-0014 being unbuilt is a roadmap fact and is not filed. What is filed is that the UI does not stay silent about the rule it cannot enforce |

#### S1-F3 — Both decoders admit duplicate trait ids, and upgrade points are charged per copy ⊕

| | |
|---|---|
| **Severity** | **P2** (filed P2, upheld) |
| **Status** | **CONFIRMED**. ⊕ Corroborated in class by **S3-F2** (decoders enforce shape, not rules) from a different code path and different data; Round 2 reproduced Seat 1's result itself rather than taking it. Keep separate — the fixes differ |
| **Where** | `client/src/utils/loadoutCodec.js:75` (`boundedTraits`), applied at `:146` (`fromV1`), `:383` (`fromLegacy`), `:431` (`fromV2`); consequence at `client/src/utils/calc.js:138` (`upTotal`); server counterpart `server/src/routes/loadouts.js:113` |
| **Defect** | `boundedTraits` slices to `TRAIT_MAX` but never dedupes |
| **Evidence** | Fifteen copies of `quartermaster` (8 UP each) decode to `length 15, distinct 1, upTotal = 120`, via v2 **and** legacy — reproduced independently in Round 2. The interactive path is safe (`addTrait` carries both a `TRAIT_MAX` guard and `if (!state.traits.includes(...))`), so the manual UI can neither create nor repair the state. The server does not catch it either: `loadouts.js:113` checks `data.tr.length > MAX_TRAITS` with no distinctness test, while the adjacent `b` branch at `:122` rejects `new Set(data.b).size !== data.b.length` |
| **Consequence** | A share URL or stored record carrying repeats shows an inflated upgrade-point total (15 × Quartermaster reads as 120 UP) and burns trait slots on one trait; with the UP budget on, the app refuses additions. **Crafted records only** — Seat 1 states this and Round 2 calls the statement honest and correct |
| **Fix direction** | Dedupe inside `boundedTraits`, before the slice, so the cap counts fifteen *distinct* traits — that reaches all three decoders at once, which is why the function exists — and mirror the server's existing `b` distinctness check onto `tr` |

#### S1-F5 — Sharing a loadout whose name contains a non-Latin-1 character throws

| | |
|---|---|
| **Severity** | **P2** (filed P2, upheld). Round 2: *"the most reachable defect Seat 1 filed and it is ranked as though it were the least"* — it needs only a user typing an emoji, where S1-F3 and S1-F4 need a crafted record |
| **Status** | **CONFIRMED** |
| **Where** | `client/src/utils/loadoutCodec.js:518–526` (`encodeShareUrl`), called from `client/src/store/thunks.js:61` (challenger cites the enclosing `thunks.js:57-68`); name input `client/src/components/ActionsPanel/ActionsPanel.jsx:115` |
| **Defect** | `encodeShareUrl` calls `btoa(JSON.stringify(toData(loadout)))`, and its own `try` wraps `history.replaceState` — not the `btoa` — so the exception escapes the click handler |
| **Evidence** | `"Plain ASCII"` ok, `"Café"` ok, `"Loadout 🔥"` and `"日本"` throw `InvalidCharacterError`. Round 2 reproduced it and verified both supporting facts at source: `shareThunk` has no `try`/`catch` around `encodeShareUrl`, and the two `setMessage` dispatches are both downstream of the throw. No catalog display name contains a character above U+00FF, so a *derived* name is always safe — the failure needs the user to type one. The server accepts such a name (`loadouts.js:115`, any string ≤ 200 chars), so the build is stored and then permanently unshareable |
| **Consequence** | "Share link" does nothing — no toast, no error, no URL. Users who name builds with emoji or in CJK/Cyrillic/Greek lose the share feature with no indication why |
| **Fix direction** | Encode the JSON as UTF-8 before base64 and decode symmetrically in `readHashLoadout`. This is a wire-format change in the strict sense (old codes must still decode), so it wants the version-envelope discipline: keep reading raw-Latin-1 codes, write the UTF-8-safe form. Independently, wrap the encode in `shareThunk` so a future encode failure surfaces as a message rather than a dead button |

#### S1-F2 — A saved Dolch 96 / Nitro Express ammo selection is silently discarded on load

| | |
|---|---|
| **Severity** | **P2** (filed P2, upheld; Round 2 endorses the P2-not-P0 reasoning) |
| **Status** | **CONFIRMED** |
| **Where** | `client/src/data/catalog.js:64` (`special: []`), the `dolch-96` and `nitro-express` rows; change landed in `077e747` (2026-08-09). `loadoutCodec.js:51` (`boundedAmmo`) |
| **Defect** | Two weapons moved from populated pools to the empty `special` pool in one commit with `FORMAT_VERSION` unchanged, so `boundedAmmo` returns `-1` for every previously-saved index |
| **Evidence** | Round 2's own name-keyed sweep over every commit touching `catalog.js`: `AMMOCLASS 077e747 2026-08-09 Dolch 96: compact(len 5) -> special(len 0)` and `Nitro Express: long(len 4) -> special(len 0)`, plus `POOL-ADDED … AMMO.special (0 entries)`. Decode confirms the drop through both paths |
| **Consequence** | The saved ammo choice vanishes and the loadout's total cost drops by whatever that round cost, with nothing shown to the player. Same population bound as S1-F1 |
| **Why P2, not P0** | The selection is *dropped*, not re-pointed, and the pool is empty for a documented reason (`catalog.js:55–63`). This was a genuine P0 — a hard crash, issue #201 — until `90c0458` added `boundedAmmo`; what remains is the mitigation's residue |
| **Fix direction** | Nothing to change in the codec; `boundedAmmo` is doing the right thing. Surface a one-time "this build's ammo selection is no longer available" notice on decode when `a` was in range for the record and is out of range now |
| **Limit** | Seat 1 explicitly declines to claim the game does or does not sell those rounds |

#### S1-F4 — An unrecognised `v` falls through to the legacy index-based decoder

| | |
|---|---|
| **Severity** | **P2** (filed P2, upheld) — but **latent, not live**: the principal cost lands when `FORMAT_VERSION` becomes 3, which has not happened |
| **Status** | **CONFIRMED** |
| **Where** | `client/src/utils/loadoutCodec.js:444–457` (`DECODERS`, `fromData`) |
| **Defect** | `fromData` picks the decoder whose `v` matches and otherwise takes the `v: null` entry — `fromLegacy`, the one decoder that reads item references as **array positions** into the frozen 2026-08-09 tables. "Unknown" and "ancient" are the same case, and they are not |
| **Evidence** | `v=2` decodes correctly; `v=3`, `v=99` and `v="2"` all discard everything **except the name**, so the result looks like a deliberately-empty build rather than a failure. Worse, the fallback *fabricates*: `{v:3, w:[[20,1],null], e:[["T",1]], tr:[0], …}` decodes to `Frontier 73C ["High Velocity",13]` with a trait and an equipment item conjured from bare integers — reproduced independently in Round 2, which is precisely the class issue #26 created the version envelope to eliminate |
| **Consequence** | Share URLs are permanent and this is a cached SPA. When `FORMAT_VERSION` becomes 3, every client that has not picked up the new bundle decodes a v3 link into an empty loadout carrying the right *name* — and because the store subscriber persists a decoded loadout (`store/index.js:26` → `writeStoredLoadout`, verified at source in Round 2 via `App.jsx:20-21`), opening one such link **overwrites the reader's stored build**. Today the only reachable door is a hand-crafted record; the server rejects a non-numeric `v` |
| **Fix direction** | Make the fallback explicit rather than positional: route absent-or-legacy `v` to `fromLegacy`, and route a recognised-but-unknown *higher* `v` either to the newest known decoder or to a distinguishable "cannot decode" result that `readHashLoadout`/`readStoredLoadout` can turn into a message instead of an empty grid |

#### S2-F2 — Nine weapons vanish from the picker whenever any ammo filter is active

| | |
|---|---|
| **Severity** | **P2** (filed P2, upheld). Round 2: *"the strongest thing in Seat 2's filing that no other seat found"* |
| **Status** | **CONFIRMED**, single-seat |
| **Where** | `client/src/components/Picker/Picker.jsx:28-35` (predicate at `:41`, call site at `:51`) |
| **Defect** | `AMMO_FILTERS` declares six buckets covering nine of the ten `ammoClass` values; `special` is in **no** bucket, and `aOK` is applied unconditionally on the Weapons tab |
| **Evidence** | Uncovered classes: `['special']` → `dolch-96` $690, `nitro-express` $1015, `bomb-launcher` $110, `chu-ko-nu` $75, `flame-rifle` $0, `shredder` $0, `dolch-96-bullseye` $725, `dolch-96-claw` $700, `dolch-96-precision` $730. Round 2 read `AMMO_FILTERS` and `aOK` from source rather than from the filing and reproduced it exactly |
| **Consequence** | **Restated by Round 2, and the restatement is stronger than what was struck**: the `Other` chip is a false claim of exhaustiveness. A player who reads six chips as a partition and picks "Other" to find the unusual weapons gets a list silently omitting the whole Dolch 96 family, the $1015 Nitro Express, the Bomb Launcher, the Chu Ko Nu, the Flame Rifle and the Shredder |
| **Fix direction** | Add `special` to `Other`, or give it its own chip using the existing `AMMO_LABEL.special`. The durable repair Round 2 endorses: assert every `WEAPONS[i][4]` is a member of `new Set(Object.values(AMMO_FILTERS).flat())`, so the next new `ammoClass` fails loudly instead of hiding rows |
| **Struck / corrected** | *"Clearing the filter is the only recovery, and nothing signals that"* — **struck**: `Picker.jsx:246-253` always renders an **"All"** chip first and marks the active chip. *"#254 tripled the `special` roster from 3 to 6 to 9"* — **corrected** against recovered history to **2 → 6 → 9** (`077e747` 2, `261cfc8` 6, `192aac5` 9); adjacent, not load-bearing |

#### S5-F2 — Eight Scarce traits and four Scarce weapons are presented as costing zero, on three surfaces, today

| | |
|---|---|
| **Severity** | **P2** (filed P2, upheld; Round 2 confirms it cannot rise to P1 and notes Seat 5 resisted the available inflation) |
| **Status** | **CONFIRMED**, rendered rather than argued |
| **Where** | `client/src/components/Picker/Picker.jsx:142`, `client/src/components/TraitsPanel/TraitsPanel.jsx:36`, `client/src/components/Picker/Picker.jsx:65` |
| **Defect** | Zero means two different things in this dataset — "free" and "cannot be bought" — and three live renderings assert the first |
| **Evidence** | Round 2 rendered all three surfaces. Picker Traits tab: `Berserker … 0 pts`, `Catalyst … 0 pts`, `Shadow … 0 pts`, `Shadow Leap … 0 pts`. Picker Weapons tab: `Flame Rifle · Special ammo · Size 2 · $0`, `Homestead 78 · $0`, `Shredder · $0`, `Wildland · $0`. `TraitsPanel` with Berserker equipped: `aria-label="Berserker, 0 upgrade points. Activate to remove."`. `PickerRow.jsx:8-32` renders `row.badge` and `row.costStr` inside a `<button>` with **no** `aria-label`, so the zero composes into the accessible name on the picker too. The twelve zero-cost rows enumerate exactly as filed (8 traits, 4 weapons). ADR-0018 calls this *"the current false claim"* and *"the only part of this that is unambiguously a bug"*; nothing in `client/src` reads `acquisitionClasses`, `statsFor` or `ITEM_STATS` |
| **Shared source, not corroboration** | ADR-0018 already states the **screen-reader** surface verbatim, with the same example trait. Round 2 says the chair must not count that as panel-independent confirmation. Seat 5's own contribution is the picker `0 pts` badge, the picker `$0` weapon cost, and the `PickerRow` accessible-name observation — two of three surfaces are new |
| **Consequence** | A player planning a budget reads eight traits and four weapons as free additions when they are items they must already own. The arithmetic is *correct* under ADR-0013 — right number, wrong label |
| **Fix direction** | ADR-0018's chosen option (spur colour **plus a text channel**; the text channel is the load-bearing half). **Read S5-F3 before implementing** — the ADR's named data source does not cover 4 of the 12 affected rows |

---

### P3 — unverifiable / rot risk

Corroborated or Round-2-promoted first, then single-seat by seat. `⊕` marks independent
corroboration (two seats, different evidence).

| Id | Where | Defect | Evidence | Player-facing consequence | Status | Fix direction |
|---|---|---|---|---|---|---|
| **S3-F6 ⊕** | `client/src/utils/calc.js:116-118`; `client/src/store/selectors.js:16`; `client/src/utils/loadoutCodec.js:329` | Grid capacity is derived in three places, two of them dead, and a comment names a fourth that does not exist | `slotMax` and `selectSlotMax` are independent copies of `8 - blocked.length` with **no production consumer** (`slotMax`'s only reference is `calc.test.js:3,111,121,122`; `selectSlotMax` has none); `loadoutCodec.js:329` names "loadoutSlice's `slotMax`", absent from `loadoutSlice.js`. `calc.js:29-41` claims the opposite as the design's central claim. ⊕ Seat 1 reaches the same two functions from the wire-format side (S1-F10, handoff #2) and adds that they **disagree** with `hasFreeCell` — Round 2 verified it: `blocked [0,0]` → `slotMax = 6` where 7 cells are usable and `hasFreeCell` is `true` | Indirect: `EquipmentPanel.jsx:132` advertises `{equipCount}/8 SLOTS` regardless of blocking, so three blocked cells read `5/8` on a grid that is as full as it can get | CONFIRMED | Delete `selectSlotMax`; delete `slotMax` **or** make the panel header use it; correct `loadoutCodec.js:329` to name `hasFreeCell`. Round 2: the disagreement with `hasFreeCell` is the strongest argument for deleting rather than wiring up — see the coupling with S1-F10 |
| **S1-F6 ⊕** | `client/src/data/catalog.js:32–45` (the WIRE-FORMAT GATE) and `:46–66` (`AMMO`) | The repo's most severe invariant is enforced by a comment; the hand-edit path that produced every historical violation has almost no test coverage | ⊕ Corroborated by **S2-F4** from provenance where this argues from enforcement. Round 2 replaced Seat 1's greps with **mutation testing** on an isolated copy (control 759/759 green, reverted between runs): caught — `frontier-73c` class flip, `nagant-m1895` class flip, `AMMO.compact` idx 0↔1, `AMMO.compact` FMJ 15→99, `AMMO.compact` idx 1 deleted; **not caught, 759 pass** — `romero-77` `shotgun`→`xbow`, `AMMO.medium` idx 1↔2, `AMMO.medium` Spitzer 60→999, `AMMO.shotgun` idx 0↔1. Seat 1's historical claim **holds**: `loadoutCodec.test.js:587` arrived at `c3b6bba` (2026-08-12) and the `calc.test.js` literal at `f438857` (2026-08-11), both after `077e747` and `e9b2c1d`, so all historical violations did land green | None today; the pools are unchanged since `1572027` (negative result N1). This is the missing control that let S1-F1 and S1-F2 happen | CONFIRMED, **evidence corrected** | Two pins in `catalog.test.js`: a golden snapshot of `AMMO` (`[name, price]` per pool) and a snapshot of `id -> ammoClass`, worded to point at the gate comment and at `FORMAT_VERSION`. **The merged statement must read**: no assertion pins any `AMMO` pool, and only **two of 147** weapons' classes are pinned |
| **S2-F4 ⊕** | `client/src/data/catalog.js:46-66` (and `:43-45`) | The `AMMO` price table has no provenance at all: 31 budget-affecting numbers, unpinned | 31 `[roundName, price]` pairs across 8 non-empty pools, $13–$90. No `itemStats.json` record, no test, and `catalog.js:43-45` states the scraper can never write them (SPEC-0007 "Fields the Scraper Must Not Derive"). Round 2 verified the bare negative itself: grepping the client test tree for `AMMO` returns only `controlScale.test.jsx:534` and a comment at `loadoutCodec.test.js:169`, and grepping for `Spitzer`, `High Velocity` and `Dumdum` across all tests returns **nothing**. Contrast the pinned columns: weapon size 147/147, weapon cost 143/147, tool 21/21, cons 30/30, trait UP 50/58. ⊕ Corroborated by **S1-F6** | Ammo enters `totalCost` directly; two weapons at the dearest round is **$180** of a loadout's price resting on numbers with no recorded verification date | CONFIRMED that it is unpinned; **no specific value is claimed wrong** | The route exists on paper (`weapon-catalog-wiki-audit.md:227-233`, per-weapon ammo unlock rows) and is ADR-0014's territory. Short of building it, a dated cited comment beside the table, modelled on the `TRAITS` block at `catalog.js:647-653` |
| **S5-F9 ⊕** | `itemStats.json`; `scripts/scrape-stats.mjs:1016-1023`; `client/src/data/itemStats.test.js:161-166` | Five scraped values carry a space before a comma, and the guard that catches this is `description`-only | The test's own regex applied to every other string-bearing field: `acquisition` and `fields.Type` = `"Burn , Scarce"` for `death-cheat`, `rampage`, `relentless`, `remedy`; `fields.ConditionalEffect` = `"Solo , Catalyst"` for `frontiersman`. Round 2 counts **nine (field, item) hits across five items** and confirms the guard is description-only. SPEC-0007 (`spec.md:251`) documents `"Burn , Scarce"` verbatim and routes around it, so four of five are known and harmless; `"Solo , Catalyst"` is documented **nowhere** — Round 2 searched. ⊕ Corroborated in class by **S4-F3** | None today — `statFieldFor` has no non-test caller. Visible the day ADR-0018's text channel or ADR-0019's stat block ships, since ADR-0019 specifies uncoerced wiki strings | CONFIRMED, latent | Normalise list separators for multi-valued infobox fields at scrape time — narrower than loosening `textContent`, which the comment rightly refuses — then extend `itemStats.test.js`'s regex from `description` to `acquisition` and all `fields` values. Render rarity from the `acquisitionClasses` **array**, never from the `acquisition` scalar. Do not let a later reader raise this on the four documented instances |
| **S3-F8 ⊕** (merged with S5-F10) | `LoadoutListsPanel.jsx:105-110`, `:196-200`, `:824-826`; `itemStats.test.js:150-153` | The trait-count denominator is stale in five live locations, and one comment describes the fifteen-trait cap as unenforced | `LoadoutListsPanel.jsx` claims "the catalog holds 32 traits" (actual **58**), "the server accepts 40" (actual `MAX_TRAITS = 15`, `server/src/routes/loadouts.js:78`, enforced `:113`) and "not an invariant this application enforces" (enforced on `addTrait`, all three decoders, `randomize`, and the server). `itemStats.test.js:150` says "9 of the **32** traits" — the nine named ids are exactly right, the denominator is 58, so the share is 9/58 not 9/32. Round 2 finds the stale `32` in **five live locations**: `LoadoutListsPanel.jsx:109`, `global.css:1096`, `itemStats.test.js:150`, `scrape-stats.mjs:975` and `:1372`, plus `scrape-stats.test.mjs:1410`. Dead-code half holds: `traitOverflow` and the `+N more` affordance can never fire | None to the player; the cost is to the next reader of a load-bearing comment | CONFIRMED; **diagnosis struck** (see appendix) | Correct the figures and re-state the last clause. Round 2's better framing: the sentence exists in more than one place and only the spec copy was amended (`hunter-loadout-lists/spec.md:603` carries it struck through with *"Amended 2026-08-11 (ADR-0012)"*) — so the fix is "find the other copies", not "correct three figures". Then decide deliberately whether `traitOverflow` stays |
| **S5-F8** | `itemStats.json` ids `marathon`, `marathon-swift` | Marathon Swift carries its base weapon's description, which contradicts its own committed stats | Both rows carry the byte-identical string *"Caldwell made, pump-action rifle. Good cycle rate and high capacity, but has a wasteful reload."* — the **only** byte-identical description pair in the file. Round 2 reproduced every statistic: **55** base pages, **35** multi-row families, **92** variant subpages, **34 of 35** families give every member distinct prose. `marathon` rev 16303 `ReloadSpeed` 19.2; `marathon-swift` rev 16305 `ReloadSpeed` **10**, cost 95 against the base's 68; both `selectedBy: canonical-title`. Every other `Swift` variant carries the expected clause | None today — no weapon description has a render path. The day ADR-0019 Phase 1 ships a description surface, a paying player is told the $95 variant reloads wastefully, identically to the $68 base | **SUSPECTED** — two causes fit (scrape fell back to the base lead, or the page genuinely repeats the base text) and the wiki cannot separate them. Round 2: *"the strongest original finding in the filing"*, and asks that it lead the surviving P3s | Re-run `scrape-stats.mjs --only weapons` when the wiki is reachable and diff this record; if the page repeats the base prose that is a wiki fix and the app carries a note, never a hand-edit. Consider a scrape-time assertion that a variant subpage's description differs from its base's, reported rather than fatal |
| **S1-F7** | `client/src/utils/loadoutCodec.test.js:336–357`; tables at `loadoutCodec.js:194–243` | The legacy-table test proves the tables *resolve*, not that they are *faithful* | The assertion checks only that every non-null entry names a live id, plus a length. Round 2 converted the argument into a measurement: **transposing `LEGACY_WEAPON_IDS[20]` and `[21]` — the precise drift the frozen tables exist to prevent — passes all 759 client tests** | None today; the tables are faithful (negative result N2). A future drift would decode old share URLs and stored builds to the wrong items, silently — the P0 class | CONFIRMED, strengthened | Pin the tables themselves — a snapshot or a per-array checksum, with a comment saying that changing it means changing history and requires git provenance in the commit message. Keep the existing resolvability test; it catches a different thing well |
| **S1-F8** (merged with S5-F5) | `client/src/data/catalog.js:131` (contradicting `:91–94`) | The wire-format documentation states the opposite of the invariant it appears inside | Line 131 reads *"since the scraper is allowed to write ammoClass through"*, contradicting `catalog.js:91–94`, `scripts/scrape-stats.mjs:56–59` and `GATED_CATALOG_FIELDS` (`:1391–1396`) — and contradicting behaviour, verified in negative result N4. Reproduced verbatim in Round 2 | None directly. The harm is to the next maintainer: line 131 sits inside the very comment explaining the ammo-index hazard, so a reader arrives primed to believe it and will look for the cause of a future S1-F1 in the scraper, which cannot produce it | CONFIRMED | **FIX CORRECTED.** Seat 1's *"say the scraper is forbidden"* would replace one inaccuracy with another. **Use Seat 5's three-tier framing**, stated once in `catalog.js`'s header and matching the scraper: **written now** (cost, size, up — `CATALOG_FIELD_MAP`, `scrape-stats.mjs:1374-1381`); **gated pending a `FORMAT_VERSION` bump** (`ammoClass`, `name` — `GATED_CATALOG_FIELDS`, `:1391-1400`); **never derived** (`group`, `type`, `AMMO` — `NEVER_DERIVED`, `:1403+`). Strike the parenthetical at `:130-131` |
| **S1-F9** (merged with S2-F7) | `client/src/data/catalog.js:55–57` (block `:55-64`) | The comment justifying the empty `special` pool names six weapons; nine draw from it | `WEAPONS.filter(w => w[4] === "special")` returns 9: `dolch-96`, `nitro-express`, `bomb-launcher`, `chu-ko-nu`, `flame-rifle`, `shredder`, `dolch-96-bullseye`, `dolch-96-claw`, `dolch-96-precision`. The comment says "as of #233"; the three Dolch variants arrived in `192aac5` (#254), confirmed against recovered history. Both seats ran the same probe on the same comment — **same source, one finding** | None; the pool is empty either way. It matters because this is the stated justification for an empty pool, and because it is the comment that would have flagged S2-F2 — three rows joined a class whose downstream consumers nobody re-checked | CONFIRMED | Restate the membership as derived rather than enumerated, or pin it: an assertion that every `special`-class weapon's record has no purchasable round keeps the justification true by construction |
| **S1-F10** | `loadoutCodec.js:437`, `:397` (`fromV2`) vs `server/src/routes/loadouts.js:88–125` (`isValidData`) | The client decoder and the server validator disagree about what the wire format permits | Three items, all reproduced in Round 2: (1) duplicate blocked cells — server rejects (`:122`), `fromV2` accepts, and `slotMax` then reports 3 free where `hasFreeCell` correctly reports true; (2) a cell can be both occupied and blocked, permitted at both ends; (3) decoders clamp traits to `TRAIT_MAX` but do not clamp equipment to ADR-0015's four-per-type — `e: Array(8).fill(["C","dynamite-stick"])` decodes to eight | **None reachable today** — Seat 1 states this up front and Round 2 calls the framing correct. `slotMax`/`selectSlotMax` have no callers; the reducer cannot produce an occupied-and-blocked cell | CONFIRMED as an inconsistency | Decide, once and in writing, whether the decoder's contract is "produce a *loadable* loadout" or "produce a *legal* one" — it currently does the first for equipment and the second for traits. Then make `isValidData` and the decoders enumerate the same rejections, ideally from a shared statement of the format |
| **S2-F3** **⚠ ESCALATES TO P1** | `client/src/data/catalog.js:507`; `client/src/data/catalog.test.js:89`, `:255`; item `dark-dynamite-satchel` | The satchel may be in the wrong consumable cap category | Signal 1: it is the only one of 18 `Throwable` rows with no `ThrowRange` (the three `Placeable` rows also have none). Signal 2: its prose (rev **16070**, `https://huntshowdown.wiki.gg/wiki/Consumables/Dark_Dynamite_Satchel`) reads *"A **deployable** bundle … **Can be attached to walls and floors**"*, in the same words as `medical-pack` (rev 15196), which #155 moved *to* `Placeable`. **Round 2 weighs a counter-signal Seat 2 did not surface**: the satchel carries `Damage` 3000, `EffectRadius` 11 and `FuseTimer` 1, and **no Placeable carries any of the three**, while its melee profile `13 / 27` matches every dynamite Throwable exactly. Four fields point Throwable, one points Placeable. No committed artifact settles it — `suggested-adrs.md` §I quotes the four cap categories but never assigns the satchel | If confirmed, `calc.js:82-87` caps the wrong budget in both directions: a satchels-plus-bombs loadout is refused earlier than the game refuses it, and a satchels-plus-placeables loadout the game permits reads as over-cap | **SUSPECTED** — the deciding evidence is page-category membership, which the scrape does not persist (S2-F5) | Resolve against the live page's category block, **not** against the prose. Durable repair is S2-F5's: persist the consumable cap-category axis and pin `CONS[i][3]` against it. **Downgraded P2 → P3 because "P2 rising to P1" does not exist on the ladder** — the described defect is a rules error, never a presentation one. The escalation condition is preserved, not dropped |
| **S2-F5** | `client/src/data/catalog.js:476-515` (the `type` column), `:552` | Consumable `type` — the cap key — has no scraped counterpart anywhere | Across all 30 consumable records the persisted fields are `Price 30 · Update 30 · Unlock 30 · MeleeDamage 30 · HeavyMeleeDamage 30 · ThrowRange 17 · Damage 16 · EffectRadius 16 · EffectDuration 11 · FuseTimer 8 · ControlRange 3 · DamageperTick 2` — no `Category`, no `Type`, and `acquisitionClasses` empty for all 30. Round 2 sharpens it: a `fields.Category` **does** exist, but only on traits, and it is the trait infobox field (`Supportive` 30 / `Offensive` 12 / `Defensive` 10 / `Movement` 6), 0 of 147 weapons, 0 of 21 tools, 0 of 30 consumables. Round 2 verified the fix is mechanically sound: `scrape-stats.mjs:468-470` already parses whole-page categories, carries them at `:481` and passes them into `acquisitionOf` at `:527` | None today. `CONS[i][3]` is a rules input with no source of truth in the repo — parent of S2-F3 | CONFIRMED | Persist a second filtered category axis for consumables at no new crawl cost, and pin `CONS[i][3]` in `itemStats.test.js` the way cost is pinned. Until then, a comment at `CONS_CAP_CATEGORIES` recording that `type` is hand-authored and uncheckable, matching the candour of the `TRAIT_GROUPS` note at `catalog.js:769-779` |
| **S2-F6** | `client/src/data/itemStats.test.js:41-43`, `:399-406`, `:150`, `:406` | The file that governs the pinning documents its own skip with a row that no longer exists | Every clause of the comment is false: `winfield-m1873c` is in neither the catalog nor `itemStats`, and `KNOWN_CATALOG_DUPLICATES` is `{}`. What the skip actually covers is **12 rows for a different reason** — the pinned field parses to null: weapon cost 143/147 (4 skipped, `fields.Price === "Scarce"`), weapon size 147/147, tool cost 21/21, consumable cost 30/30, trait UP 50/58 (8 skipped, no `Cost` row). Round 2 re-derived the whole table with its own `asNumber` and **strengthened it**: the same file already knows, at `:399-401`, that *"#243 retires it"* — so it contradicts itself across 360 lines. `:406`'s `toBeGreaterThan(WEAPONS.length - 3)` passes at 145/147, so two weapons may silently lose their record | None directly; the harm is to the next reviewer auditing coverage | CONFIRMED, strengthened | Rewrite the comment to describe the parse-null skip, name the two evidenced-Scarce mechanisms and point at the ADR-0013 block; tighten `:406` to `toBe(WEAPONS.length)`; correct "32" to "58" at `:150`. **Round 2 offers a merge here**: the residual of struck S5-F6 — `catalog.js:118-121`'s dangling *"above"* — is the same #243 retirement leaving a stale comment in a second file |
| **S2-F8** | items `decoys`, `chaos-bomb`, `flash-bomb` | Three consumable/tool pages are a stale corner, ~3,900 revisions behind the rest | `sourceRevision` is `wgCurRevisionId` at scrape time (`scrape-stats.mjs:453-455`). `decoys` **10076**, `chaos-bomb` **10096**, `flash-bomb` **10105**; next oldest `blank-fire-decoys` **13984** (gap **3,879**). Per-category medians re-derived independently in Round 2: weapons 15976, tools 16044, consumables 15286, traits 15641; file max 16390. All 256 `ingestedAt` values fall in the single hour bucket `2026-08-12T22`, so the spread is page currency, not scrape currency — Round 2 calls this Seat 2's key methodological point and confirms it. Catalog costs pinned to those revisions: `decoys` $6 (`catalog.js:375`), `chaos-bomb` $15 (`:489`), `flash-bomb` $25 (`:496`) | **None demonstrated.** No value is claimed wrong | CONFIRMED as a revision gap; **SUSPECTED** that any value is wrong | Nothing to change in the data; these three are the natural first target for ADR-0016's incremental refresh. **Round 2 framing caution:** revision distance measures *edit recency*, not age or correctness — keep Seat 2's own wording over the "~3,900 revisions behind" headline |
| **S2-F9** | `client/src/data/catalog.test.js:31-107` | The `describe` titled *"data accuracy (verified against huntshowdown.wiki.gg, Update 2.8.1)"* pins whole-tuple literals with no URL, no revision and no read through `statFieldFor` | For `size`, `cost` and `up` this is harmless redundancy. For the hand-authored columns it is a regression pin on values corrected in #36/#37/#40, and its title says otherwise. The contrast Round 2 checked and confirmed: `catalog.test.js:419-492` explicitly re-derives its claims through `statFieldFor` off the generated dataset | None directly. The harm is to the panel's own question: a reader counting what is "verified against the wiki" will count this block | CONFIRMED | Retitle to what it is, or re-express the sourceable assertions through `statFieldFor` and leave the genuinely hand-authored columns as literals with a comment saying they are unsourced. **Do not delete it** — as a change-detector it is useful |
| **S3-F3** | `client/src/utils/randomize.js:52`; rows at `catalog.js:146`, `:147`, `:148`, `:311` | The generator can never produce a size-5 weapon without Quartermaster | The primary pool is filtered to `size <= cap - 1`, reserving a point for a secondary unconditionally. Seat 3 over 200,000 builds: QM 30.0%, size-5 present 0.96%, **size-5 without QM: 0**, weapons never drawn: 0. Round 2 re-measured independently over its own 200,000: QM 29.99%, size-5 0.94%, **0 without QM, 0 as a solo weapon**; counts differ only by draw. The manual path disagrees — `loadoutSlice.js:75` accepts a lone size-5 weapon and `Picker.jsx:56` enables it | **No wrong number reaches the player.** Every build Randomize returns is legal, correctly priced and correctly sized; the sample is biased and the UI does not claim otherwise | CONFIRMED as measured | Draw the primary against the full `cap` and let the secondary pool be empty and `weapons[1]` be `null` — which SPEC-0008's "A large primary leaves room for nothing" already specifies and the store already accepts. **Downgraded P2 → P3**: SPEC-0008 records the requirement as **satisfied** with this exact mechanism pre-recorded as a caveat, so this is not a spec violation; the novel content is the measured consequence |
| **S3-F4** | `client/src/utils/randomize.js:99-112` | The budget retry misses budgets that are demonstrably reachable | `randomizeLoadout` draws 81 uniform independent attempts and keeps the cheapest. Seat 3 over 300,000 single attempts: min 142, p0.1% 207, p1% 271, p5% 341, median 594; P(≤200 in 81) = **5.6%**, P(≤250) = 34.4%, P(≤300) = 82.8%. Round 2's own 300,000: min 129, p0.1% 209, p1% 272, p5% 340, median 594, max 2075; P(≤200 in 81) = 5.5%, P(≤250) = 35.1%. Both observed a build at **$123**, so the floor is ≤ $123. Fixed-budget runs agree within noise (budget 200: over 470/500 and 468/500) | **No number the player reads is wrong** — `Header.jsx:17,33` and `ActionsPanel.jsx:26-28` recolour the total when it exceeds the budget. What survives is that `randomizeThunk` (`thunks.js:21`) clears the status on every press, so the app never distinguishes "nothing fits" from "I took 81 uniform draws and none fit" | CONFIRMED as measured; **conformance argument struck** | **Downgraded P2 → P3.** Keep the cost profile — it is the only quantitative characterisation of the current sampler in the corpus and the baseline whoever implements SPEC-0008's archetype search will want. Interim fix: have `randomizeThunk` set a message when the returned build exceeds the budget, so "cheapest of 81" is disclosed rather than implied |
| **S3-F5** | `client/src/store/loadoutSlice.js:24` | The loadout shape guard accepts an equipment array shorter than eight cells | `payload.equip.length > 8` is an upper bound only; a three-cell array is accepted verbatim, after which `hasFreeCell` finds no `null` and reports the grid full while `EquipmentPanel.jsx:145` still renders eight cells. Round 2 verified the unreachability claim rather than taking it: all three decoders pad to exactly eight (`loadoutCodec.js:142`, `:379`, `:406-417`), `clearBuild` sets eight (`:182`), `randomize` returns eight (`randomize.js:63`), and all three `setLoadout` callers route through one of those | None today. If it ever fires: an app that silently refuses to equip anything with five cells visibly empty, where clicking one would *block* it rather than fill it | CONFIRMED (defect) / not reachable from any current caller | Make the guard exact — `length !== 8` — matching ADR-0009's fixed-grid model and matching `server/src/routes/loadouts.js:106`. The server is stricter than the client here, which is backwards |
| **S3-F7** | `client/src/utils/randomize.js:13-15` and `client/src/utils/calc.js:36-40` | Two comments state that the generator consults `hasFreeCell`; it does not import it | `randomize.js:2` imports `TRAIT_MAX, consAllowed, totalCost` only; the generator re-derives the scan inline at `:17`, character-for-character the body of `hasFreeCell`'s predicate (`calc.js:44`). Round 2 confirmed from the import line. Half of each comment **is** true — `consAllowed` is genuinely shared (`randomize.js:79`) and both seats' fuzzing confirms the sharing is real | None today. The exposure is drift: a future change to `hasFreeCell` would be picked up by the reducer and the picker and silently missed by the generator — precisely the drift both comments claim is impossible | CONFIRMED | Import and call `hasFreeCell` from `place()`, or amend both comments to say the generator carries its own equivalent scan. Sharing the predicate is cheaper than maintaining the claim |
| **S3-F9** | `client/src/utils/randomize.js:58` vs `client/src/utils/calc.js:152` | `mkAmmo` reads a pool unguarded where `totalCost` guards the same lookup | `calc.js` defends with `(AMMO[...] \|\| [])`; `randomize.js` does not, and would throw a `TypeError` on ~30% of draws for a weapon whose class the pool table lacks. Not live: Round 2 re-derived that all ten used `ammoClass` values are present in `AMMO`, no key is unused, and every used class has an `AMMO_LABEL`. The **empty**-pool half is handled correctly — the `.length` test short-circuits, and 200,000 builds recorded zero `special`/`none` selections and zero out-of-range ammo indices | None (not live) | CONFIRMED (asymmetry) / not live — Round 2 calls this exactly the right calibration | Mirror `calc.js`'s `\|\| []`. **Do not merge with S1-F9 or S2-F7**: Round 2 notes S3-F9's passing reference to "six weapons" is quoting the panel brief, not making a claim |
| **S3-F10** | `client/src/utils/calc.js:133-135` | `consCount` was retired by ADR-0015 and is still exported | `calc.js:96-97` and ADR-0015's Decision Outcome both say per-item counting is *"RETIRED, not kept alongside"*. Its only reference anywhere is `calc.test.js` (lines 3, 79, 88, 89, 101, 106, 107), confirmed in Round 2 | None. A future caller reaching for the obviously-named `consCount` gets the retired per-item rule and would pass review — reproducing in code the ambiguity ADR-0015 rejected in the rules | CONFIRMED | Delete it, or rename it to state that it is a per-item count and not the cap |
| **S4-F1** | `server/src/routes/hunterFavorites.js:168` (DELETE), `:52-65` (`assertKnownHunter`), `:101-110` (GET) | A favorite whose hunter leaves the roster can never be deleted | PUT and DELETE both validate against `data/hunters.json`; GET does not. Round 2 reproduced it exactly with its own script against the real router and a private db: `GET stale -> 200 ['retired-hunter-slug']`, `DELETE stale -> 400 {"error":"unknown hunter"}`, `GET after DEL -> 200 [...]`. Every line citation is exact, and Round 2 traced the client half: `hunterFavoritesSlice.js:84` is `state.ids = action.payload` with **no filtering against `HUNTERS`** anywhere between the server and `favored`. The re-key mechanism is confirmed: `scrape-hunters.mjs:1198` seeds `idsByPortrait` from a **portrait → id** map, so a wiki *media-file* rename is enough to re-key an entry | The stored record is invisible and permanently unremovable. Round 2 bounds the visible half: the zero-tile picker needs either the user checking "Favorites only" or **≥11** stale ids on open (`FAVORITES_ONLY_DEFAULT_THRESHOLD = 10`, strictly greater, `HunterPicker.jsx:127`); with one stale id and the toggle off, all 242 show | CONFIRMED. **Severity disputed — see [Unresolved](#unresolved-disagreements) #4** | Drop the roster check from DELETE (keep the length cap), and decide separately whether GET filters unknown ids or the client intersects `ids` with `HUNTERS` before computing `favored.size`. One of the two is needed regardless |
| **S4-F2** | `data/hunters.json` entries `desolations-delegate` (index 37) and `the-statesman` (index 208); mechanism at `scrape-hunters.mjs:1024-1025`, `:1311` | One hunter is misfiled in the picker grid, splitting a two-variant family by 171 tiles | The dataset is `id`-sorted (`allEntries.sort((a, b) => a.id.localeCompare(b.id))`, verbatim) and `id` derives from the wiki media filename. **78 hunters have names beginning `The `; 77 have ids beginning `the-`** — this is the only exception and the only tile out of alphabetical position. Round 2 reproduced every number, including exactly one adjacent name-order inversion across the whole file. The id/name divergence is **spec-sanctioned** (`hunter-roster-dataset/spec.md:90-92`); the defect is that a *consumer* treats id-order as name-order | One tile of 242 out of name order. Round 2's caveat: `design.md:189/197` shows the design's mental model is name-alphabetical but is not a requirement, and **no spec REQ, no test and no UI string asserts alphabetical order**; the free-text filter matches on `name`, so both variants are reachable by typing "statesman" | CONFIRMED | **Do not touch the ids** — that would break stored `hunterId` references and violate the spec scenario. Sort at the consumption seam: order the picker by `name.localeCompare(name)` or export a name-ordered view from `hunters.js`, then pin it with a name-order test. **Downgraded P2 → P3** on the finding's own durable content: *"this will get monotonically worse as hunters are renamed, and each new divergence is silent"* |
| **S4-F4** | `client/src/components/HunterPicker/HunterPicker.jsx:112-116`; `scripts/scrape-hunters.mjs:483-487`; fixtures `hunterFavorites.test.js:27`, `:123`, `HunterPicker.test.jsx:23` | The "Not obtainable" filter can never match anything, and the tests covering it use fixtures the real dataset contradicts | `obtainable` domain over 242: **240 `true`, 2 `null`, zero `false`** — re-derived in Round 2, which also confirms `the-foxhound` and `the-ol-cowpoke` are the same two entries in all three fields. `false` is producible only from `acquisition === "mythic"`, and no stored `source` matches `/\bmythic\b/i`; four rule values are dormant (`soul-survivor`, `hunt-dollars`, `mythic`, `free`). `OBTAINABLE_OPTIONS` is a hardcoded literal twenty lines above an acquisition select that gates its own sentinel on `HAS_UNKNOWN_ACQUISITION` (`:475`). The fixtures invent `obtainable: false` (`hunterFavorites.test.js:27`) and assert on it (`:123`), and `HunterPicker.test.jsx:23` invents a second (`bad-hand`) — Round 2 calls this "the best part of the finding" and the brief's *"a green suite is evidence about the tests"* case exactly | Nothing displayed is wrong; a control offers a bucket with no members | CONFIRMED (dead option and fixtures); the `[UNVERIFIED]` half stays `[UNVERIFIED]` — **whether any hunter in the game *should* be classified unobtainable is precisely what the blocked wiki prevents anyone answering.** If one should be, this is a *missing classification* and the finding is worse, not better | (a) Gate the option on the data the way the sibling select already does — a `HAS_UNOBTAINABLE` predicate beside `HAS_UNKNOWN_ACQUISITION`; (b) resolve the `[UNVERIFIED]` half against the wiki when reachable. Round 2 adds the higher-value half: a fixture asserting a value the production dataset has never carried should say so in a comment, or the predicate should additionally be asserted against `HUNTERS`. **Downgraded P2 → P3**; consequence sentence struck |
| **S4-F5** | `scripts/scrape-images.test.mjs:786-807` versus `scripts/scrape-hunters.test.mjs` | The 242-portrait tree is the only image tree with no on-disk coverage test | The item-tree assertion reads real directories with `readdirSync` and checks both directions, and its `rows` object has exactly four keys — hunters are not among them, though they are 242 of 498 committed image files and 2.49 MB. Round 2 confirms `readdirSync` appears in exactly two places in the whole test surface, both in that file, and that every hunter-scraper filesystem test uses an in-memory fake. `listOrdering.test.js:165-192` runs against the real `HUNTERS` and never mentions `portrait` | None today. The exposure is that a broken portrait is *invisible* — a missing portrait and a deliberately art-less hunter render identically through `hunterThumb`. `hunters.js:64-70` records this happening at full scale once (#147 deleted all 242 `-thumb` files; a human caught it) | CONFIRMED | Extend `scrape-images.test.mjs:786` to a fifth tree, or add the equivalent to `scrape-hunters.test.mjs`, keyed on `portrait` and `.avif` rather than `slugify(name)`. Both directions — a re-scrape re-keying an entry produces one of each simultaneously |
| **S4-F6** | `scripts/scrape-hunters.mjs:447-462` (`ACQUISITION_RULES`) | A compound `source` is silently reduced to one channel, with no multi-match diagnostic | Four rows carry `"900/800 Blood Bonds / Garden of the Witch Event"` and store `acquisition: "blood-bonds"`: `bruja-crone`, `bruja-maiden`, `welder-flame`, `welder-torch`. Round 2 re-derived the multi-match set from all 13 patterns rather than trusting the four: exactly four, exactly those, and "Garden of the Witch" appears nowhere else; the Event bucket is exactly 50 | Filtering the picker to `Event` returns 50 hunters and omits the only four the app associates with that event | CONFIRMED for the four rows; **SUSPECTED** for the mythic half | (a) Hoist `mythic` above the channel rules, since it answers a different question and is the only rule feeding `deriveObtainable`; (b) more durably, have `normaliseAcquisition` report multi-match the way `formatSummary` already reports `unmappedSources` (`:1391-1394`) — Round 2 says (b) is the one worth doing. **Headline narrowed** from "four hunters are misfiled" (Seat 4's own body says the opposite and is right); citation **corrected**: `event` is rule **11**, not 12 |
| **S4-F7** | `client/src/components/ItemThumb/ItemThumb.jsx:22`, `:33`, `:63` | Every item thumbnail costs two wasted requests, and the ordering hint that exists to prevent exactly that is unreachable | `IMAGE_EXTENSIONS = ["jpg","jpeg","png","webp"]` against a tree that is **242 avif + 256 png and zero jpg/jpeg/webp** — re-censused in Round 2. `onError` walks one candidate per failure (`:129-132`), so each item image costs two failed loads. Second half: `EXTENSIONS_BY_CATEGORY = { hunters: ["avif"] }` is unreachable because `:63` returns `sources` first and `HunterPortrait` (the only hunter call site, grepped) always passes `sources` — the justification comment at `:28-32` describes traffic that cannot occur | No wrong number, no wrong label — wasted bytes and latency. It is in this seat's charge because it is the mechanism that hides S4-F5 | CONFIRMED; **the "404" evidence is struck and replaced** | Put `png` first in the chain, keep the rest (the chain exists so the scrape can re-extension without a code change), and either route `HunterPortrait` through `category="hunters"` or delete the dead entry with its rationale. Round 2 kept the finding despite it being scope-marginal under Part IV, because the second half is a comment-gone-false, which the brief explicitly asks for |
| **S5-F3** | `docs/adrs/ADR-0018-*.md` (Decision Drivers; Confirmation #1) vs `client/src/data/itemStats.json` | ADR-0018's confirmation criterion cannot be met from the field it names | Non-empty `acquisitionClasses`: **58 of 256**, all traits — `Regular 49 · Scarce 4 · Burn+Scarce 4 · Burn 1`, i.e. the counts the ADR quotes are the trait counts and net to the trait roster. SPEC-0007 (`equipment-catalog-dataset/spec.md:251`) scopes the field to traits **by specification**. `flame-rifle`, `homestead-78`, `shredder`, `wildland` all carry `acquisitionClasses: []`, `acquisition: null`, `priceStated: "Scarce"`, `fields.Price: "Scarce"`. Reproduced exactly in Round 2 | None (ADR unbuilt). **4 of the 12** zero-cost rows have no rarity to render, so a literal implementation leaves those four showing a bare "$0" — the exact defect ADR-0018 exists to remove, for a third of the affected rows | CONFIRMED | Amend ADR-0018 to source rarity for non-trait rows from `priceStated`/`fields.Price`, or extend the scrape to record `acquisitionClasses` for weapons (which needs a SPEC-0007 amendment). Do not let an implementation quietly cover 8 of 12 and call Confirmation #1 met. **Trimmed:** the rhetorical hinge that the ADR "reads the trait counts as *per item*" is an over-read — the field genuinely is per-item (all 256 records carry the key) and the ADR nowhere claims 256. Drop the phrase; the finding does not need it |
| **S5-F4** | `client/src/data/catalog.js:16-21`, `:892-897` vs `:881-890`, `:928-938` | The image-model header describes a two-tier lookup the code does not have, and a group count that is wrong | All four dispatch functions are single-tier group lookups with no per-item map in existence. Round 2 verified the counts by reading the objects: `THUMBS` **7**, `TOOL_THUMBS` **7**, `TRAIT_THUMBS` **5**, `CONS_THUMBS` **5**, against `:894`'s *"5 groups per category"* — contradicted by the file's own `:899-902` note recording the #166 split | None. ADR-0020 records that this comment already misled one piece of downstream analysis | CONFIRMED | Correct the header to describe the single-tier group dispatch that exists, and fix "5 groups per category" to per-category counts (weapons 7, tools 7, traits 5, consumables 5). If the two-tier lookup is still wanted, that is a code change, not a comment. **Attribution split:** the two-tier half is **ADR-0020's own recorded finding** (`ADR-0020:109-113`), which deliberately left the fix to `catalog.js` — credit ADR-0020 and record that the panel confirmed it is still unfixed. The **"5 groups per category" half is novel** — Round 2 searched `docs/` and `client/src` and found no prior record. Minor: the contradiction is five lines later, not twelve |
| **S5-F7** | `client/src/data/catalog.js:625-630`, `:639-641` | The Event-trait hold-back rests on a premise ADR-0018 disproved, and half its revisit trigger cannot fire (disputed) | `catalog.js` justifies holding back 17 Event traits with *"`Traits/Shadow Crush` appears to have been replaced by `Traits/Shadow Leap`"*; ADR-0018 read both pages and refuted it. Confirmed against committed data in Round 2: `shadow-crush` is absent from both `TRAITS` and `itemStats.json`; `shadow-leap` carries `acquisitionClasses: ["Scarce"]` and `fields.Category: "Movement"` | None directly. The hold-back's stated ground is false, so 17 traits stay out by inertia rather than by decision. ADR-0018 is careful that the hold-back **still stands** on its other ground (the Event index cannot be trusted) | CONFIRMED (data); **the conclusion is ADR-0018's own** — shared source, not panel corroboration | **Disputed — see [Unresolved](#unresolved-disagreements) #3.** Seat 5 and ADR-0018: strike the second clause of the REVISIT trigger and the "appears to have been replaced" sentence. Round 2: ADR-0018's page comparison *is* the resolution, so the clause has already fired and the revisit is overdue. Both positions condemn the comment and imply different fixes |
| **S5-F12** | `client/src/components/ActionsPanel/ActionsPanel.jsx:85`, `:99` vs `client/src/utils/calc.js:19` | The "Trait cap" control does not cap traits | The visible label is `Trait cap {ui.upBudgetOn ? "ON" : "OFF"}` on a toggle that bounds `upBudget`; the same input's accessible name is `aria-label="Trait point cap"` — correct, and different from the visible text. Meanwhile `TRAIT_MAX = 15` is unconditional under ADR-0012 and explicitly not gated on `ui.upBudgetOn` (`calc.js:10-13`). Round 2 adds that the file argues against itself at `:90-93` (*"'Trait cap' names its own unit"*) | **Consequence struck.** Seat 5's *"a user who turns 'Trait cap OFF' may conclude no limit on traits applies"* has no reachable path: `TraitsPanel` draws a fixed fifteen-cell grid (`:74`, `Array.from({length: TRAIT_MAX})`) with an unconditional group label, rendered as `aria-label="Traits, 1 of 15"`, neither gated on the toggle | CONFIRMED (label mismatch); consequence struck | Make the visible label match the accessible one — "Trait point cap" — freeing "trait cap" to mean ADR-0012's fifteen. Right regardless of the struck consequence |

---

## Merged and coupled findings

Two different relationships, and conflating them is how a panel either double-counts or ships half a
fix.

### Merged — the same finding counted twice; recorded once

| Pair | Basis | Carried as | Recorded by |
|---|---|---|---|
| **S1-F8 ≡ S5-F5** | Same line (`catalog.js:131`), same conclusion, overlapping sources. Both read the same scraper | **S1-F8** — it additionally verified *behaviour* (negative result N4) rather than only reading the field map. **But use Seat 5's three-tier fix direction**, which is better than Seat 1's single-clause correction | challenge-of-seat1; challenge-of-seat5 |
| **S1-F9 ≡ S2-F7** | Same comment (`catalog.js:55-57`), same `WEAPONS.filter(w => w[4] === "special")` probe, same conclusion, same "restate as derived" fix. Two seats reading one comment is **one** piece of evidence | **S1-F9**, cross-referencing S2-F7. Keep Seat 2's addition: this is the comment that would have flagged S2-F2 | challenge-of-seat1; challenge-of-seat2 |
| **S5-F10 ≡ the item Seat 2 folded into S2-F6 at `itemStats.test.js:150`** | Same file, same lines, same nine verified ids, same corrected denominator. **Same source — no promotion.** This is the correlated-recall arithmetic in its benign form | Recorded once, both seats noted; Seat 5's write-up additionally sources the "32" to `catalog.js:604-606` as the pre-#157 count | challenge-of-seat2 |
| **S3-F8 + S5-F10** | *Different* files (`LoadoutListsPanel.jsx` vs `itemStats.test.js`), same root cause. Round 2 calls this corroboration by different evidence, not a duplicate, and asks for **one class-level P3** | Merged into the S3-F8 row above: *the trait-count denominator is stale in five live locations; the fifteen-trait cap is described as unenforced in one* | challenge-of-seat3 |
| **Struck S5-F6's residual → S2-F6** | The #243 retirement left a stale comment in **two** files: `itemStats.test.js:41-43` (S2-F6) and `catalog.js:118-121`'s dangling *"above"*. Round 2 offers the residual to the chair at P3, materially weaker than S5-F6 as filed | Recorded as a note on the S2-F6 row. **Not counted as a surviving finding** — the finding it came from is struck | challenge-of-seat5 |

### Corroborated — different evidence, same conclusion; kept as two findings

| Pair | Why not merged |
|---|---|
| **S1-F6 ⊕ S2-F4** | Seat 1 argues from *enforcement* (no test assertion; three historical violations landed green); Seat 2 from *provenance* (zero `itemStats` coverage; SPEC-0007's never-written rule; no validating consumer). Genuinely different evidence bases — promote, do not merge |
| **S4-F3 ⊕ S5-F9** | Different files, different scrapers, different consumers. Round 2 is explicit: *"merging them into one finding would lose the fact that two independent surfaces are affected"* |
| **S1-F3 ⊕ S3-F2** | Same conclusion about the codec's contract (shape, not rules) from different code paths and different data. Keep separate — the fixes differ |
| **S3-F6 ⊕ S1-F10** | Seat 1 filed its half as a handoff and as part of F10, so there is nothing to merge; the agreement is recorded and earns S3-F6 the top P3 slot |

### Coupled — fixing one without the other creates a new defect

| Coupling | What breaks if they are split |
|---|---|
| **S2-F1 + S1-F1** | Re-classing the Conversion to `compact` alone **manufactures a second S1-F1**: both pools are length 5, no bounds check trips, and index 1 flips Spitzer ($60) → High Velocity ($13). `catalog.js:122-131` records that this cost was *accepted rather than migrated* once already. The class change must land **with** a `FORMAT_VERSION` bump and a saved-selection migration. Round 2: **COUPLE, do not merge** — different rows, different evidence, keep them adjacent |
| **S3-F1 + S3-F2** | S3-F1 manufactures the over-cap state; S3-F2 is why nothing between there and the server notices. Fixing S3-F1 alone leaves every record already written; fixing S3-F2 by clamping alone silently discards items the user chose |
| **S3-F2's own two halves** | **Warning before clamping.** Clamp-first discards four chosen items with no explanation; warn-first makes the ADR-0015 tightening visible, which ADR-0015's own consequence list argues for |
| **S2-F3 + S2-F5** | S2-F3 is the live candidate, S2-F5 is the mechanism. S2-F3 must not be read without S2-F5, and the durable repair is S2-F5's — pinning the type against a persisted category axis would have caught it without anyone noticing a missing field |
| **S4-F3 + S5-F9** | One root (tag → space) and one shared fix, stated once: move `tidyProse` into `scripts/lib/wiki.mjs`, apply it to the hunter description path **and** to multi-valued infobox fields, **not** to `stripTags` wholesale (`scrape-stats.mjs:1016-1018` gives the reason and it is a correct reason), then extend `itemStats.test.js:161` over `HUNTERS` and over `fields` |
| **S3-F6 + S1-F10** | "Wire up `slotMax` into the panel header" without S1-F10's duplicate-`b` question ships the disagreement: `slotMax` reports 6 where `hasFreeCell` correctly sees 7 on `blocked [0,0]`, which the client codec admits and the server rejects |
| **S5-F2 + S5-F3** | Implementing ADR-0018's rarity disclosure from `acquisitionClasses` alone leaves 4 of the 12 zero-cost rows still showing a bare "$0" |
| **S5-F1 + S2-F1 + S1-F6 + S2-F4** | Round 2 asks for **one consolidated ammo-model entry**: S2-F1 (label/filter), S5-F1 (disclosure), S1-F6 and S2-F4 (nothing pins the pools). Each fix alone leaves the app asserting something it cannot support |

---

## Unresolved disagreements

**No filer response is on the record.** The brief allows the filer one response; the corpus contains
five Round 1 filings and five Round 2 challenges and nothing else. Where a challenger invited a
response, none was filed, and that is recorded rather than resolved. Both positions are given with
both citations. **No middle position is synthesised here.**

### 1. Which finding carries the ammo P1 — and whether either does

| Position | Held by | Citation |
|---|---|---|
| S2-F1 is **P2**; its cost consequence is **subsumed by S5-F1** plus ADR-0014, and the chair should "list Seat 5 F1 as the cost finding and Seat 2 F1 as the narrower label/filter finding beneath it" | challenge-of-seat2, §F1 and "Subsumed — list beneath, not beside" | `docs/audits/adversarial-data-qa-2026-08-14-round2-challenge-of-seat2.md` |
| S5-F1 is **P2**; **"the P1 belongs to Seat 2's F1, not to Seat 5's F1"** — Seat 2 can show a specific wrong dollar figure from repo artifacts alone and Seat 5 cannot; file S5-F1 beneath it | challenge-of-seat5, §F1 | `docs/audits/adversarial-data-qa-2026-08-14-round2-challenge-of-seat5.md` |

**Net effect, recorded rather than adjudicated:** each challenger downgraded the finding in front of
it and deferred the P1 to the other, so **neither survives at P1** and both are listed at P2 above,
adjacent. The two challengers also disagree about the relationship itself — subsumption
(challenge-of-seat2) versus independent corroboration (challenge-of-seat5).

### 2. The direction of the Conversion cost error, and whether the directed fix helps

| Position | Evidence | Citation |
|---|---|---|
| The app **overstates**: it charges the `medium` pool for a weapon the scrape types Compact, per-index +$7 / +$47 / +$6 / +$6 / +$5, and the picker offers "Spitzer", a round absent from the pool the scrape points at | `catalog.js:47` against `:48`; `itemStats.json` `AmmoType` at revs 16153 / 16154 | seat2 F1 |
| The app **understates**, and the directed fix makes it worse: `docs/reports/suggested-adrs.md` §A2, written when the wiki was reachable, quotes the Conversion's own ammo section (`{{Ammo\|FMJ Ammo}} - 50 {{Hunt Dollars}}`, Dumdum Scarce) — the app charges **22** against a stated **50**, and re-classing moves it to `AMMO.compact`'s **15**, further from that source. Re-classing also trades one set of phantom rounds for another | `docs/reports/suggested-adrs.md` §A2 / §3; ADR-0014 | challenge-of-seat2 §F1.3 |

**Provenance caveat, from the challenger itself:** `suggested-adrs.md` carries an amendment
retracting §4 and §G because its corpus was pulled through MediaWiki API paths that `robots.txt`
disallows. The amendment is explicit that the retraction covers the *recommendation to adopt the
API*, not the readings, and the Conversion readings are in §A and §3. The challenger weights them as
"real wiki readings of contested provenance" and flags that at each use. **This report does not
adopt either direction as a fact about the live game** — the wiki was unreachable for the entire
panel and neither side re-read the page. What both sides agree on is the coupling: do not hand-edit
the row.

### 3. ADR-0018's revisit trigger — "resolved either way"

| Position | Reading | Citation |
|---|---|---|
| The clause **can never fire**, so strike it and the "appears to have been replaced" sentence, leaving the page-level liveness signal as the sole condition | ADR-0018 states *"Shadow Crush and Shadow Leap are two different traits, so there is nothing to resolve"* and *"What needs correcting is the trigger: half of it can never fire"* | seat5 F7, quoting ADR-0018 |
| The clause **has already fired**: a plainer reading of *"resolved either way"* is that ADR-0018's 2026-08-12 page read *is* the resolution — in the direction "not a replacement" — so the revisit of the 17 held-back Event traits is **overdue** rather than impossible | `catalog.js:639-641`, ADR-0018's own page comparison | challenge-of-seat5 §F7 |

Both positions condemn the comment. They differ on the fix: strike the clause versus honour it.

### 4. S4-F1's severity, and S4-F7's scope — invited responses, none filed

| Position | Reasoning | Citation |
|---|---|---|
| **P2** | The record is "invisible and immortal"; the picker can reach a zero-tile state through a door the file's own comment (`hunters.js:211-213`) does not cover | seat4 F4-1 |
| **P3** | Nothing displayed is wrong; the state is unreachable until a future re-scrape drops or re-keys a hunter, which **has never happened** across all three commits to `data/hunters.json` (`5058699`, `9ae3ba7`, `1bc67cb`: 0 dropped, 0 added, 0 portrait changes for a stable id); the worst visible state is an *explained* empty grid (`HunterPicker.jsx:530-540`) one click from recovery. The genuinely unrecoverable part is the stored record, which is what keeps it a finding | challenge-of-seat4 §F4-1 |

The challenger explicitly invited a response on this and on whether S4-F7 is in scope under Part IV
("a style or refactor opinion about code that produces correct data") — it declined to strike S4-F7
on scope because the second half is a comment-gone-false, which the brief asks for. **No response was
filed.** This report carries the challenger's severity (P3) in the table because Round 2 verdicts
govern, and records Seat 4's position here unaltered.

### 5. The evidentiary standing of `docs/reports/suggested-adrs.md`

| Position | Citation |
|---|---|
| It is a usable second oracle — *"a committed document citing a live page at a stated date"* — and its Conversion readings are load-bearing enough to invert S2-F1's consequence and downgrade it | challenge-of-seat2, Method, "A second oracle Seat 2 did not use" |
| Its figures are **one unreplicable measurement cited twice**; `491 / 243 / 147 / 137 / 13-of-46` must be marked `[UNVERIFIED]` in the consolidated report, and only `587` — derivable from `catalog.js` alone — may be promoted to CONFIRMED | challenge-of-seat5 §F1 |

This report follows the narrower position for **figures** (all ADR-0014 magnitudes stay
`[UNVERIFIED]`; `587` is CONFIRMED) and records the disagreement rather than resolving whether the
document may be used to *invert a consequence*, which is what disagreement #2 turns on.

---

## Struck findings

> ### ⚠ Two proposed fixes would have damaged the codebase. Do not apply either.
>
> **1. S5-F6's fix — DO NOT APPLY.** Seat 5 proposed rewriting `catalog.js:118-121` to say
> "Frontier 73C is a lightened Ranger 73". That rewrite would **delete the only in-file record of why
> `winfield-m1873c` was retired and why `RETIRED_WEAPON_ALIASES` (`loadoutCodec.js:292`) exists**,
> leaving a future maintainer looking at a live alias with no justification in the data file it
> governs. The finding it rests on is struck outright (below).
>
> **2. S1-F8's fix direction — CORRECTED, do not apply as written.** Seat 1 proposed correcting
> `catalog.js:131` to say the scraper is *"forbidden"* to write `ammoClass`, citing
> `GATED_CATALOG_FIELDS`. That **replaces one inaccuracy with another**: `GATED_CATALOG_FIELDS` is a
> *third tier* — gated pending a `FORMAT_VERSION` bump — distinct from `NEVER_DERIVED` (`group`,
> `type`, `AMMO`). Use Seat 5's three-tier framing instead (see S1-F8's row).
>
> Three further fix directions are conditionally harmful and are marked in place: **S1-F1's**
> `fromLegacy`-only remap (cannot reach records already laundered to v2), **S2-F1's** bare re-class
> (manufactures a second S1-F1), and **S3-F2's** clamp-before-warn ordering (silently discards four
> items the user chose).

### Struck in full, or struck as findings

| Id | Filed as | Disposition | Reason |
|---|---|---|---|
| **S5-F6** | P3 CONFIRMED — *"The Frontier 73C note claims two rows are the same weapon; the scrape says they are not"* | **STRUCK.** Does not reproduce | **The wrong pair was compared.** The comment names `winfield-m1873c` / "Winfield M1873C", a real catalog row that sat directly above `winfield-m1873` until `c3b6bba` retired it (*"fix(catalog): retire the winfield-m1873c duplicate behind a legacy alias (#243) (#250)"*), whose commit message states the comment's claim as the reason for the deletion. Seat 5 compared `winfield-m1873` / "Ranger 73" against `frontier-73c` instead. Three further corroborations that the comment is **true**: `RETIRED_WEAPON_ALIASES = Object.freeze({ "winfield-m1873c": "frontier-73c" })` (`loadoutCodec.js:292`), whose existence presupposes the identity; `loadoutCodec.js:272-284` restating it in prose; and S2-F6 independently confirming the id is gone from the catalog, from `itemStats.json` and from `KNOWN_CATALOG_DUPLICATES`. **Root cause of the strike, recorded for the next panel:** the retirement commit is present even in the shallow tree and `git log -S` finds it; Seat 5's Method records no consultation of git history at any point, and that omission failed exactly once — on the one claim whose subject was a past state of the file. **Residual available at P3, materially weaker**: the comment is now a *dangling reference* — the row it points at with "above" no longer exists — correctable by naming the retirement, not by changing the claim. Merged into S2-F6 |
| **S5-F11** | P3 CONFIRMED (divergence) — SPEC-0001 mandates non-empty `alt`; the trait cell passes `alt=""` | **Downgraded to an observation; not a panel finding** | Three grounds: (1) **the enumeration is wrong** — `TraitsPanel.jsx:44` is not "the one call site that opts out"; `LoadoutListsPanel.jsx:739-750` (`PreviewCell`) passes `alt=""` for every weapon, tool, consumable and trait tile in the saved-loadout preview; (2) `ItemThumb.jsx:69-71` licenses `alt=""` *"where the name is already visible adjacent to the image"*, and at the trait cell the name is **not** visible — it lives in an `aria-hidden` tooltip (`TraitsPanel.jsx:60-63`); the real justification is the button's `aria-label` at `:41`, a different and better rule than the component's comment states; (3) no player gets a wrong answer **by the filer's own argument** — Seat 5 concludes the code is right and the spec is wrong — and this is code-versus-spec, which the brief routes away from this review. Carry it as a SPEC-0001 internal-inconsistency note with the second call site added. **Seat 5's own instruction stands: do not "fix" the code to satisfy the spec — that would make the announcement worse** |

### Sub-claims struck or corrected inside surviving findings

Recorded because each one is a path the next reviewer should not re-walk.

| Where | Struck or corrected claim | Disposition |
|---|---|---|
| S1-F1 | *"The legacy half is deterministically fixable and was never fixed"*, and the `fromLegacy`-only remap that follows from it | **STRUCK.** A v2 laundering path dissolves the split — `toData` stamps `v: FORMAT_VERSION` and the store subscriber persists every decoded loadout, so any legacy record opened since 2026-08-13 is now an unmarked v2 record. Seat 1's date-based *derivation* is separately unsound (it fails under the cached-stale-bundle scenario Seat 1 itself relies on in F4); the conclusion survives on an argument Seat 1 does not make |
| S1-F1 | *"The last chance to record the v1 ambiguity closed at `0f4f5b1`"* | **Overstatement**, contradicted by Seat 1's own fix direction, which proposes recording it now. The fix direction is the correct sentence |
| S1-F6 | *"There is no assertion anywhere that … `frontier-73c` draws from `compact`"*; *"flipping **any** weapon's `ammoClass` passes all 759 client tests"*; *"No test enforces any part of it"* | **All three false / overstated**, falsified by mutation rather than argument. `loadoutCodec.test.js:587` asserts `expect(WEAPONS[FRONTIER][4]).toBe("compact")`; `:532` asserts `"none"` for the Katana; `scripts/scrape-stats.test.mjs:1171` asserts the gate text is present and `:1242` asserts a `--write-catalog` run leaves `AMMO` byte-identical. Coverage exists but is **incidental and confined to `AMMO.compact[0]` and two of 147 weapons**. Seat 1's grep searched the literal string `ammoClass` and could not see assertions indexing tuple position `[4]`. The conclusion survives |
| S1-F8 | Fix direction: *"say the scraper is forbidden to write `ammoClass`"* | **CORRECTED** — see the callout above |
| S2-F1 | *"The cost line is overstated on every Conversion loadout"* + the per-index delta table as the magnitude of the player's error | **Contested and unresolved** (disagreement #2). The delta table compares two app-internal pools, neither of which the challenger's counter-source matches |
| S2-F2 | *"Clearing the filter is the only recovery, and nothing signals that"* | **STRUCK** — `Picker.jsx:246-253` always renders an "All" chip first, with the active chip marked |
| S2-F2 | *"#254 tripled the `special` roster from 3 to 6 to 9"* | **CORRECTED** to **2 → 6 → 9** against recovered history (`077e747`, `261cfc8`, `192aac5`). Adjacent, not load-bearing |
| S2-F9 | *"These literals are the **only** thing asserting … `ammoClass` … and consumable `type`"* | **STRUCK for `ammoClass`** — `loadoutCodec.test.js:532` and `:587` pin two weapons' classes outside the block. Holds for consumable `type`. The conclusion survives, since it rests on the title and the literals, not on exhaustiveness |
| S3-F4 | The whole *"why this is a conformance failure and not just tuning"* framing | **STRUCK.** SPEC-0008 lists *"The Dollar Budget Is Searched Within the Chosen Archetype"* under **Unbuilt** thirty lines above the scenario Seat 3 quotes, and the overview calls the current behaviour "80 blind re-rolls that keep the cheapest miss" with "two secondary gaps in scope". Quoting the scenario without the unbuilt note converts a roadmap fact into a conformance failure, which Part IV excludes. Seat 3 disclosed the equivalent note for F3 and not for F4. **The measurement is kept in full** |
| S3-F8 | *"The 40 is `WIRE_CATEGORIES.tr` … the client comment made the mistake the server comment was written to prevent"* | **STRUCK.** Three sources show the "40" was a true statement about the **count** when written: the pre-#222 server source (`bb99434^`: `data.tr.length > 40`), the server's own current comment (`loadouts.js:66`, *"Tightened from 40"*), and SPEC-0003 (`hunter-loadout-lists/spec.md:603`) carrying the identical sentence struck through with *"Amended 2026-08-11 (ADR-0012) … The struck sentence **was true when written**"*. The comment is **uniformly stale, not confused** — which points at a different fix: find the other copies |
| S4-F1 | *"Both sections come back empty, and the picker renders zero tiles — the exact state that comment exists to prevent"* | **PARTIALLY STRUCK.** True only with `favoritesOnly` on; with the toggle off, a stale-only favorites set yields all 242. Arriving pre-filtered needs **≥11** stale ids |
| S4-F3 | *"`marian-lee` also ends with a trailing space that survived `.trim()`"* | **STRUCK.** Zero of 242 descriptions carry leading or trailing whitespace. `marian-lee` still belongs in the 21 |
| S4-F4 | *"A user selects 'Not obtainable' and gets an empty picker with no explanation … indistinguishable from a failed load"* | **STRUCK.** `HunterPicker.jsx:531-540` renders an explicit empty-state message beneath an `aria-live` `0 of 242 hunters` count; a failed load leaves both absent |
| S4-F6 | *"`event` is rule 12"*; headline *"four hunters are misfiled today"* | **CORRECTED** to rule **11** (non-load-bearing); headline **NARROWED** to "a compound source is silently reduced to one channel, with no multi-match diagnostic" — which is what Seat 4's own body says |
| S4-F7 | *"two guaranteed 404s"*, *"a noisy console"* | **STRUCK for production.** `server/src/index.js:144-155` registers `express.static` followed by an SPA catch-all, so `/images/weapons/nagant-m1895.jpg` and `.jpeg` both answer **`200 text/html`** carrying the whole index document; only `.png` returns `image/png`. The byte cost is *worse* than filed and the console cost *smaller* (a decode failure, not a network error). It also sharpens the finding: a genuinely missing asset does not 404 either, so "missing art" and "wasted probe" are indistinguishable **by status code**. In dev, Vite does 404 them, which is presumably where the observation came from |
| S5-F3 | *"The ADR reads [the trait counts] as **per item**"* | **TRIMMED.** `acquisitionClasses` genuinely is a per-item field — all 256 records carry the key — and the ADR nowhere claims 256. The finding does not need the phrase |
| S5-F5 | *"`catalog.js:91-94` is imprecise in the other direction"* | **STRUCK.** That comment says `ammoClass` is never written by a scrape, and S1's negative result N4 shows that is behaviourally **true today**. A merely-imprecise comment is not a finding |
| S5-F12 | *"A user who turns 'Trait cap OFF' may reasonably conclude no limit on traits applies"* | **STRUCK.** `TraitsPanel` draws a fixed fifteen-cell grid with an unconditional label (`aria-label="Traits, 1 of 15"`), neither gated on `ui.upBudgetOn`, so the fifteen-cap is disclosed visually and to assistive technology on the very panel it governs |
| Seat 4, handoff #2 | *"All seven server test files share one db and **vitest runs files in parallel by default**"* | **DIAGNOSIS STRUCK.** `server/vitest.config.js:17` already sets `fileParallelism: false`, with a comment explaining why; the suite run alone under the repo's own config passes 161/1-skipped. The observation was real; the cause is the hardcoded shared `OUTFITTER_DB_FILE=./data/db.test.json` (`server/package.json:10`) plus concurrent panel seats. See Method §4. The surviving half of the recommendation is the good half: give each run its own db path |

---

## Consolidated negative result

What the panel checked and found **clean**, so the next reviewer does not redo it. The
**Re-derived** column distinguishes results a Round 2 challenger rebuilt from scratch with its own
harness from results asserted once and left unchallenged. All of it is bounded by Method §1: none of
it can find a value where `catalog.js` and `itemStats.json` agree with each other and both are stale.

### Wire format and persistence

| Result | Detail | Source | Re-derived in Round 2? |
|---|---|---|---|
| **No `AMMO` pool has ever been non-append edited** | All 26 commits touching `catalog.js` reconstructed and diffed against true parents. The eight populated pools are byte-identical in content, order and price to their form in `1572027` (2026-08-07). The only structural change ever made was adding the empty `special` key. Exactly **3** `ammoClass` transitions in 277 commits — S1-F1's one and S1-F2's two — and **0** non-append pool edits | seat1 N1 | **Yes** — independent clone, independent parser, all 26 commits parsed against **every** parent edge with zero failures. *"The panel's most load-bearing negative, now established by two independent implementations"* |
| **All four frozen `LEGACY_*_IDS` tables are faithful** | Length and order match the pre-versioning catalog at `2a6bd05` in all four categories (37 / 20 / 16 / 32); the four deviations are exactly the four documented substitutions (`[9] null` Electric Lamp, `[13] choke-bombs`, `[12] iron-eye`, `[26] pain-sense`); no table maps two positions to one id | seat1 N2 | **Yes, and strengthened** — the challenger verified a premise Seat 1 asserted but did not check: name order at `2a6bd05` is identical to `2a6bd05^` in all four categories, without which the comparison would not have been valid |
| **Every legacy array position decodes to the right item** | All 105 positions through the live decoder: one documented drop (`T[9]` Electric Lamp) and every other deviation a documented rename, alias, promotion or category crossing. The `winfield-m1873c → frontier-73c` alias-safety claim verified at the commit that removed the row: same size, same pool | seat1 N3 | **Yes** (105/105) |
| **v2 round-trips are lossless** | Every weapon × every valid ammo index, all 408 equipment placements across all eight cells, a stale `["T","katana"]` promotion, and a full loadout with blocked cells, traits and name | seat1 N6 | **Yes** — 734 weapon × ammo round trips and 408 placements, **0 mismatches** |
| **The scraper cannot write `ammoClass`** | Three barriers: the positive allow-list in `planCatalogWrites` (`scrape-stats.mjs:1463-1493`), the `parseNumeric`/`rangeViolation` type barrier, and a test at `scrape-stats.test.mjs:1017` asserting the planned label set is exactly `["cost"]` with `ammoClass` absent | seat1 N4 | Corroborated by seat5's independent reading of the three tiers, and the tier structure was verified by challenge-of-seat5 |
| **Id retirement is clean** | Across 147 weapons, 21 tools, 30 consumables and 58 traits: no duplicate id within a category, no id shared between categories, no retired id back under a new meaning, no duplicate display name. `choke-bomb`, `electric-lamp`, `iron-repeater`, `poison-sense`, `winfield-m1873c` all absent | seat1 N5 | Corroborated by seat2's structural table (0 duplicate ids within or across categories) |
| **The v1 → v2 migration is sound** | The blocked-count lift cannot overlap a packed item, because the v1 reducer capped `equip.length + blocked ≤ 8` on both writers; v1-era `toData` wrote `b` as a number, the shape `v1BlockedCells` expects | seat1 N7 | Asserted once |
| **Share codes do not use URL-fragile base64 characters** | 0/2000 randomised loadouts contain `+`; 0/2000 contain `/` — the payload is ASCII JSON | seat1 N8 | Asserted once |
| **Malformed input decays to the empty grid rather than throwing**; **`toData` never throws on well-formed store state**; **`FORMAT_VERSION` history is 1 → 2 with no other values**; **`boundedAmmo` is correct for all 147 weapons** including the 9 on empty `special` and the 7 melee on `none` | | seat1 N9 | Asserted once |

### Catalog against the scrape

| Result | Detail | Source | Re-derived in Round 2? |
|---|---|---|---|
| **Catalog/scrape coverage is exact** | 147 + 21 + 30 + 58 = **256** rows, **256** records, **0** rows with no record and **0** records with no row. The brief predicted this enumeration would be "probably the single most valuable artifact the panel produces"; it is empty | seat2, headline structural result | Corroborated by seat3 (weapons 147/147 with records, 0 missing `Size`) and by seat5's independent row count |
| **Structural provenance** | 0 duplicate ids; 0 pairs sharing a `wikiUrl`; 0 duplicate or missing `infoboxTitle`; **0 of 256** `selectedBy` other than `canonical-title`; 0 `wikiUrl` off `https://huntshowdown.wiki.gg/wiki/`; 0 absent or non-numeric `sourceRevision`; 0 absent `ingestedAt` | seat2 | Spot-checked (the `selectedBy`/`Price`/`Size` triple was re-read for both Conversion rows) |
| **Re-scrape reproducibility** | For all **256** rows, `resolveWikiPath` computed from today's display names equals the recorded `wikiUrl`. **0 mismatches** — no display-name edit has silently re-pointed a row | seat2 | Asserted once |
| **The Katana-class defect: zero instances** | WEAPONS 147/147 under `/wiki/Weapons/`, TOOLS 21/21, CONS 30/30, TRAITS 58/58; no cross-namespace override masks one. `throwing-spear` reads as a melee weapon in prose but the wiki files it at `/wiki/Tools/Throwing_Spear`, so catalog and namespace agree | seat2 | Asserted once |
| **Hand-authored `name` agrees with the scrape** | 0 mismatches against `record.name` across all 256, and 0 between `record.name` and `record.infoboxTitle`. Load-bearing beyond display, since `name` feeds `slugify()` and therefore the image path | seat2 | Corroborated by challenge-of-seat4's call-site check (every `ItemThumb` call site passes tuple index 1) |
| **Weapon variant inheritance is clean** | Over all 92 three-segment variant paths, `ammoClass` differs from the true parent's in **0** cases and wiki `AmmoType` in **0** cases, independently re-verifying `catalog.js:236-242`. The 6 rows whose `group` differs from their path-prefix parent are exactly the six the file documents by name | seat2 | Asserted once |
| **ADR-0013's zero-cost invariant holds in both directions, item by item** | All **12** cost-0 rows evidenced: 4 weapons by `purchasable: false` + `priceStated: "Scarce"` (revs 15222 / 15736 / 15144 / 15176), 8 traits by `acquisitionClasses` (`["Scarce"]` ×4, `["Scarce","Burn"]` ×4). Reverse direction clean: **0** rows with `cost > 0` carrying `purchasable: false`, `null`, or a Scarce class. `priceStated === fields.Price ?? fields.Cost` for all 256; no `Price`/`Cost`/`Size` field contains a comma or decimal point | seat2 | **Corroborated by seat5 independently** (same 12 rows, same two mechanisms), and the skip table re-derived by challenge-of-seat2 with its own `asNumber` |
| **Chu Ko Nu is still the only infobox/prose disagreement on the ammo axis** | Rev 15216, `fields.AmmoType: "Special"` against prose reading "Compact Bolts", exactly as `catalog.js:60-63` documents. All 147 weapon descriptions scanned; every other apparent hit is a false positive ("Medium damage", "Bolts"/"Arrows" as ordinary prose). Trait infobox `Type` agrees with category-derived `acquisitionClasses` for **58/58** | seat2 | Asserted once |
| **Generated-file integrity** | `_generated` carries `by: "scripts/scrape-stats.mjs"` and the do-not-hand-edit warning; all 256 records carry `sourceRevision` and `ingestedAt`; no non-test consumer of `acquisition`, `acquisitionClasses`, `purchasable`, `priceStated`, `variantCount` or `sourceRevision` exists in the client | seat2 | Corroborated by challenge-of-seat5 (`statsFor`, `statFieldFor`, `dualWieldFor`, `ITEM_STATS`, `STATS_GENERATED` have **zero** non-test consumers) |

### Rules, caps and the generator

| Result | Detail | Source | Re-derived in Round 2? |
|---|---|---|---|
| **Weapon `size` is fully pinned and correct** | 0 of 147 with no record, 0 with no `Size` field, **0 mismatches**, 0 non-integer `Size` strings; histogram `{1:25, 2:35, 3:28, 4:55, 5:4}`, all within the documented 1–5. **No weapon size makes an impossible loadout look legal or a legal one look impossible** | seat3 | Histogram re-derived identically in challenge-of-seat3 |
| **The other arithmetic columns pin** | Weapon cost, tool cost, consumable cost: 0 missing, 0 mismatches. Trait `up`: 0 mismatches; the eight `up = 0` rows are exactly the rows whose infobox carries no `Cost` field and whose acquisition is Scarce | seat3 | Corroborated by seat2's skip table and by challenge-of-seat2 |
| **The randomizer cannot produce a loadout the manual UI would refuse** | 11 option scenarios × 3,000 builds = 33,000, eight invariants each (grid length, slot cap, trait cap, trait uniqueness, no item in a blocked cell, per-category ≤ 4, no duplicate tool, ammo index in range): **zero violations everywhere**, including all-8-blocked, budget 0 and −5, and upBudget 0 | seat3 | **Yes** — re-run with an independent harness at the same scale plus 200,000 further builds, **and a twelfth scenario Seat 3 did not try (duplicate blocked indices), also clean** |
| **Degenerate generator inputs do not hang, throw, or return malformed grids** | All eight cells blocked → an eight-`null` grid with two weapons, no hang. Budget 0 / −5 → the cheapest of 81, per SPEC-0008's degrade scenario. `upBudget: 0` → QM dropped, only zero-cost traits taken. Empty `AMMO` pools never drawn, `a: -1` every time | seat3 | Yes |
| **Full catalog reach for tools and consumables** | Over 20,000 builds each: 0 of 21 tools and 0 of 30 consumables never drawn. `TOOLS[0]` appears only as the guaranteed starter, which is correct today; the starter is id-resolved and safe, though the draw range hardcodes the exclusion of index 0 | seat3 | Weapon reach re-derived (0 weapons never drawn over 200,000) |
| **No consumable row's `type` is undeclared** | `CONS` uses exactly `Shot` (9), `Throwable` (18), `Placeable` (3), all members of `CONS_CAP_CATEGORIES`, so `capCategoryOf` never returns `UNDECLARED_CATEGORY`. ADR-0015's shared-budget fallback is not exercised by live data | seat3 | **Three times** — seat3, independently seat5, and re-derived by challenge-of-seat3. **Scope note:** this answers *is the type declared*, not *is it right* — S2-F3 asks the second question and the two do not conflict |
| **`CONS_CAP_CATEGORIES` vs `CONS_TYPES` is deliberate and correctly consumed** | `Tarot Cards` is in the cap list and not the type list, as `catalog.js:526-565` explains; the cap reads `CONS_CAP_CATEGORIES` (`calc.js:1,83`), the badge palette reads `CONS_TYPES`, and no production code reads `CONS_TYPES` for a rules decision | seat3 | Yes |
| **Stacking is arithmetically consistent with cost and cap** | `equipRuns` derives runs at render time and stores nothing, so the badge count *is* `cells.length`, and `totalCost` and `consCategoryCount` iterate the same cells. A ×3 stack is charged three times and counts 3. No state could be constructed where badge and charge disagree, **including after S3-F1's duplication**. Holds *structurally*, because the quantity is derived. Adjacency across the rank break is correct: SPEC-0006 defines a run over consecutive cell indices and its transpose requirement preserves neighbours | seat3 | Not re-run; unchallenged |
| **Blocked cells are not counted as room by any live caller** | `hasFreeCell`, `addEquip`'s scan and the generator's `place` all test `e === null && !blocked.has(k)`; `toggleBlockedSlot` refuses to block an occupied cell; `moveEquip` refuses any move touching a blocked cell. The only route to an item in a blocked cell is a hand-built decoded record, and it renders and is removable | seat3 | Yes (via the duplicate-blocked fuzz scenario) |
| **Weapon over-capacity from the manual path is surfaced** | Take QM, equip 5 + 1, remove QM → `capUsed 6 / capMax 5`, and `WeaponsPanel.jsx:8,33-35` renders *"Over capacity — drop a weapon or take Quartermaster."* The state is reachable and disclosed. This is the model S3-F2 asks for | seat3 | Confirmed by challenge-of-seat3's render (`any "Over capacity" string on screen? false` for the *equipment* panel) |
| **The picker and the reducer agree on the consumable cap** | Both go through `consAllowed`; the picker's displayed count goes through `consCategoryCount`, the same function the cap reads | seat3 | Yes |
| **Ammo pool integrity** | No `ammoClass` used by a weapon is missing from `AMMO`; no `AMMO` key is unused; every used class has an `AMMO_LABEL`; the two empty pools are empty deliberately | seat3 | Yes |
| **Seat 3's pointer-side analysis of `moveEquip`** | `startGrab` refuses a grab on an empty cell; the off-grid release guards `equip[from] === null`; the ✕ removal effect really does null a live grab | seat3 F1 | **Yes — recorded as verified, not merely unchallenged.** *"Every pointer path I tried holds"* |

### The hunter roster and the image trees

| Result | Detail | Source | Re-derived in Round 2? |
|---|---|---|---|
| **Image coverage is complete in all five trees, both directions** | weapons 147/147, tools 21/21, consumables 30/30, traits 58/58, hunters 242/242 — **0 missing, 0 orphaned, 0 slug collisions across 498 files**. The brief predicted a long list of items silently running on the SVG fallback; the list is **empty** | seat4 | **Yes, with a check Seat 4's method did not make** — the challenger first verified *what each `ItemThumb` call site passes as `name`* (tuple index **1**, the display name, at every call site), because a method reading the wrong field would produce clean zeros for the wrong reason. `find` returns exactly five directories and exactly **498** files, so no sixth tree exists and no category was excluded. Hunter portraits cross-referenced on the stored `portrait` field, not `slugify(name)` — the correct choice, since `portrait !== slugify(name)` for exactly three entries |
| **File integrity** | All 242 hunter files carry `ftypavif`; all 256 item files carry the PNG signature; no file under 200 bytes; portraits 2.49 MB total | seat4 | **Yes.** (Seat 4 quotes 7.6–20.4 KB / median 10.5; the challenger 7.5–20.0 KiB / median 10.3 — KB vs KiB, not a disagreement) |
| **`KNOWN_CATALOG_DUPLICATES` is empty**, so the exemption at `scrape-images.test.mjs:797` currently exempts nothing and all 256 item rows are genuinely covered by that test | An exemption list is where a silently-uncovered row would hide; this one is inert | seat4 | Yes, by importing it |
| **Roster schema and duplicates** | All 242 records carry an identical nine-key set; **0** duplicate ids, names, portraits or descriptions; no same-hunter-under-a-renamed-edition pairs (the Union Suit and Statesman pairs are distinct hunters with distinct portraits and sources) | seat4 | **Yes** |
| **The generated roster agrees with its generator** | `normaliseAcquisition(source)` re-derived over all 242 → **0 drift**; `deriveObtainable(acquisition)` → **0 drift**. This is the check that would have caught a hand-edit of a do-not-hand-edit file | seat4 | **Yes** |
| **The two null-acquisition hunters are coherently presented, both directions** | `ACQUISITIONS` yields 9 values via `filter(Boolean)`; the null pair is served by `UNKNOWN_ACQUISITION` behind `HAS_UNKNOWN_ACQUISITION` and by "Unknown" in the availability select. **No hunter falls out of every bucket** — the union of offered filter values selects all 242 | seat4 | **Yes** — acquisition buckets + Unknown cover 242/242, availability buckets cover 242/242 |
| **No stale corner in the roster** | `ingestedAt` is a single value across all 242 (`2026-08-11T00:15:01.470Z`) — one scrape run. `sourceRevision` is numeric on all 242, range 6290–16307, and low values mean "not recently edited", not "stale entry" | seat4 | **Yes** |
| **Roster text quality** | No mojibake, no wiki markup, no entities, no `[1]` markers, no hatnotes, no embedded newlines/tabs/NBSP, no leading or trailing whitespace, no double spaces. Lengths 162–404, median 257. `server/src/lib/descriptions.js:16`'s claim that the longest is 404 and is "The Night Seer" is **exact**; next longest `Zhong Kui` at 323 | seat4 | **Yes** |
| **Favorites degrade cleanly on read** | A stale favorite does not break a load — `GET /` returns 200 and the client renders normally. PUT is idempotent and validates; DELETE of a known-but-unfavorited hunter returns 204 as specified; ownership is enforced through a single `ownedBy` predicate | seat4 | **Yes**, with the roster-churn history added: `data/hunters.json` has three commits and **0 dropped, 0 added, 0 re-keyed** entries across all of them |
| **A hunter can leave the roster, mechanically** | `readExistingIds` builds a **portrait → id** map, so a wiki media-file rename re-keys an entry; `runScrape` writes `allEntries` wholesale with no retention of prior rows | seat4 F4-1 | **Yes** — *"the sharpest part of the finding"* |

### Presentation, prose and ADR conformance

| Result | Detail | Source | Re-derived in Round 2? |
|---|---|---|---|
| **All 256 item descriptions are clean under 22 probes** | No mojibake, U+FFFD, entities, NBSP, `[[ ]]`, `{{ }}`, `'''`, HTML tags, `[1]` markers, `[edit]`, hatnotes, leading/trailing whitespace, double spaces, tabs, control characters, curly quotes, repeated sentences, name-equals-description, or lowercase openings. The only non-ASCII character in the corpus is an en-dash, used 3 times | seat5 | Spot-checked; the arithmetic behind it reproduced exactly |
| **The description test's own assertions re-derived independently** | The multi-paragraph set is exactly the nine named ids and they are the only nine in the 256-item file; no `/^see also/i`; no `/\s[,;:.!?]/` in any description; no `\n\s*\n`. Trait descriptions max at 209 (`serpent`) against `TIP_BUDGET` 240; file maximum 296 (`flame-rifle`) against `FILE_CEILING` 320 | seat5 | Corroborated by seat2's independent check of the same claims |
| **`dualWield` vs prose — clean in both directions** | All 25 `true` records say so in their description; all 231 `false` records do not. #178's named trap is not sprung | seat5 | `dualWield` true = 25 of 256 reproduced |
| **ADR-0019's field census is exact** | All 34 distinct infobox field names and **every one** of the 34 per-field coverage counts reproduce against the committed file with zero mismatches | seat5 | Spot-checked (198 / 171 / 147 / 2) and reproduced exactly |
| **ADR-0018's rarity census is exact** | 49 Regular · 8 Scarce · 5 Burn over 58 traits, with the Burn+Scarce overlap of 4 and Necromancer the sole Burn-only trait at `up = 4`; twelve zero-cost catalog rows | seat5 | **Yes** |
| **ADR-0022's data preconditions are clean** | No duplicate display name in any of the four arrays; no weapon name contains `" and "`; across all 147 × 146 ordered weapon pairs, **zero** derived names are produced by more than one distinct id-pair. Degenerate cases behave as specified | seat5 | Not re-run; unchallenged |
| **`calc.js`'s single-source claim for `TRAIT_MAX` holds** | `loadoutSlice.js:3`, `randomize.js:2` and `loadoutCodec.js:2` all import it; no file repeats the literal 15; all three decoder paths route through `boundedTraits` | seat5 | Corroborated by seat3's five-writer enforcement table (only `setLoadout` lacks a clamp, and all three of its callers pre-clamp) |
| **Taxonomy declarations are complete** | Every `group` value in all four categories is a member of its declared list — zero undeclared rows | seat5 | Yes |
| **`catalog.js`'s remaining statistical claims all verify** | Tool group distribution (21), trait group distribution (58), the wiki functional-category distribution, the `Solo`/`Catalyst` examples, the Medical-precedent four, the ammo-index worst case at `:128`, and the `58 = 49 + 8 + 1` decomposition at `:592-593` | seat5 | Spot-checked |
| **ADR-0014 and ADR-0017 are confirmed unbuilt** | `AMMO` is still ten shared `[name, cost]` pools addressed by one `ammoClass`; no per-weapon ammo row, no ammo id, no second ammo slot; no trait carries a condition vocabulary; nothing surfaces `ConditionalEffect`. **ADR-0017's non-implementation is silent**, which is the correct posture for an unbuilt advisory feature. ADR-0014's is not — that is S5-F1 | seat5 | Yes |
| **The accepted-but-unbuilt ledger** | ADR-0014 (ammo rows), ADR-0017 (trait conditions), ADR-0018 (rarity/burn — S5-F2/S5-F3), ADR-0019 Phase 1 (stat block), ADR-0021 (health-chunk disclosure — the string "health chunk" appears nowhere in `client/src`). **ADR-0022 is built** | seat5 | **Yes** — and extended: `statsFor`, `statFieldFor`, `dualWieldFor`, `ITEM_STATS`, `STATS_GENERATED` have zero non-test consumers, and `acquisitionClasses` is read nowhere in `client/src` outside comments |
| **198 of 256 committed descriptions have no render path** | `descriptionFor` has exactly two consumers, `Picker.jsx:136` (inside the `TRAITS.map` branch) and `TraitsPanel.jsx:33`, both traits-only. This is the self-correction that lowered several of Seat 5's own grades | seat5, Method | **Yes — verified true, and true more broadly than claimed.** This is load-bearing: it is why S5-F8 and S5-F9 are P3 rather than P2 |

### Test baseline

Every Round 2 challenger re-ran the client suite independently and got **33 files / 759 passed**.
Three re-ran the server suite alone against a private `OUTFITTER_DB_FILE` and got **161 passed,
1 skipped**; the scrape suite reproduces at **321 passed**. Every finding in this report is filed
against that green baseline, and **none of them is a test failure or would ever become one.**

### What the panel did **not** cover

Stated so silence is not read as coverage. This repeats Method §6 and adds the two leads Round 2
surfaced.

| Uncovered | Why | Lead |
|---|---|---|
| **Items missing from the catalog entirely** | Requires `scrape-stats.mjs --discover`, which crawls the wiki's category indexes — unavailable (network) and forbidden by the brief | **A partial offline oracle exists and nobody ran it**: `itemStats.json` carries `variantCount` (= `result.infoboxCount`, `scrape-stats.mjs:510`), the number of variant infoboxes on each page. Comparing that per family against the catalog's row count for the same family is entirely offline. Seat 2 raised it (handoff #6); challenge-of-seat2 confirms it is *"a live, cheap, unexploited lead"* and asks that it be assigned rather than the blind spot recorded as total |
| **Roster completeness** | A hunter absent from `data/hunters.json` is invisible from inside it; `scrape-hunters.mjs --names-only` would make a live request | None offered |
| **Any value where `catalog.js` and `itemStats.json` agree and both are stale** | Consequence of Method §1 | None available without the wiki |
| **Whether SPEC-0004's acquisition vocabulary matches `ACQUISITION_RULES`** | Seat 4 routed it to Seat 5 (handoff #3); **Seat 5 did not take it up**. Round 2 flags it as an open, uncovered question rather than a closed one | Direct comparison of `scrape-hunters.mjs:447-462` against SPEC-0004 |
| **Whether the `special` pool's substantive justification is true** | `challenge-of-seat2` records that `suggested-adrs.md` §3.1 and ADR-0014 hold, from the live wiki, that the comment's claim *"none of their custom rounds can be bought with Hunt Dollars"* is **false for Bomb Launcher and Chu Ko Nu**. **No seat filed this**, and it is `[UNVERIFIED]` here: single-source, contested provenance, and the wiki was unreachable. Recorded as a lead, not as a finding | Re-read those two pages when the wiki is reachable |

---

Source material, all committed:

| Round | Document |
|---|---|
| 1 | `adversarial-data-qa-2026-08-14-seat1.md` — persistence and the wire format |
| 1 | `adversarial-data-qa-2026-08-14-seat2.md` — the catalog against the scrape |
| 1 | `adversarial-data-qa-2026-08-14-seat3.md` — rules, caps, and the generator |
| 1 | `adversarial-data-qa-2026-08-14-seat4.md` — the hunter roster and assets |
| 1 | `adversarial-data-qa-2026-08-14-seat5.md` — presentation, prose, ADR conformance |
| 2 | `adversarial-data-qa-2026-08-14-round2-challenge-of-seat1.md` |
| 2 | `adversarial-data-qa-2026-08-14-round2-challenge-of-seat2.md` |
| 2 | `adversarial-data-qa-2026-08-14-round2-challenge-of-seat3.md` |
| 2 | `adversarial-data-qa-2026-08-14-round2-challenge-of-seat4.md` |
| 2 | `adversarial-data-qa-2026-08-14-round2-challenge-of-seat5.md` |
