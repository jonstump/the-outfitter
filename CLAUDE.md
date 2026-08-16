## Architecture Context

This project uses the [SDD plugin](https://github.com/joestump/claude-plugin-sdd) for architecture governance.

- Architecture Decision Records are in `docs/adrs/`
- Specifications are in `docs/openspec/specs/`

### qmd Dependency

Starting with SDD plugin v5.0.0, [qmd](https://github.com/tobi/qmd) is a hard dependency — `/sdd:init` enforces qmd presence at setup, and every qmd-aware consumer skill (`/sdd:prime`, `/sdd:check`, `/sdd:audit`, `/sdd:discover`, `/sdd:adr`, `/sdd:spec`, `/sdd:plan`, `/sdd:work`, `/sdd:review`) MAY assume qmd is installed and MUST NOT include conditional fallback paths. If a skill needs to handle "qmd installed but this repo not yet indexed", it routes to `/sdd:index` rather than silently degrading. This invariant lets every skill be designed for hybrid retrieval rather than around its absence.

### SDD Skills

| Skill | Purpose |
|-------|---------|
| `/sdd:adr` | Create a new Architecture Decision Record (ADR) using MADR format |
| `/sdd:spec` | Create a specification with requirements, scenarios, and design rationale |
| `/sdd:list` | List all architecture decisions and specs with their status |
| `/sdd:status` | Change the status of an ADR or spec (e.g., proposed to accepted, draft to… |
| `/sdd:docs` | Generate a documentation site from your ADRs and specs |
| `/sdd:init` | Set up CLAUDE.md with SDD plugin references for architecture-aware sessions |
| `/sdd:prime` | Load ADR and spec context into the session for architecture-aware responses |
| `/sdd:check` | Quick-check code against ADRs and specs for drift |
| `/sdd:audit` | Comprehensive audit of design artifact alignment across the project |
| `/sdd:discover` | Discover implicit architectural decisions and spec-worthy subsystems in an… |
| `/sdd:plan` | Break an existing spec into trackable issues in your issue tracker |
| `/sdd:organize` | Retroactively group existing issues into tracker-native projects |
| `/sdd:enrich` | Retroactively add branch naming and PR convention sections to existing issue… |
| `/sdd:work` | Pick up tracker issues and implement them in parallel using git worktrees |
| `/sdd:review` | Review and merge PRs produced by /sdd:work using reviewer-responder agent pairs |
| `/sdd:graph` | Build and query the SDD artifact graph |
| `/sdd:index` | Index a repository's ADRs, OpenSpec specs, and source code into qmd collections… |
| `/sdd:report-friction` | File a feedback issue against the SDD plugin (joestump/claude-plugin-sdd) when… |
| `/sdd:respond` | Respond to review feedback on a PR — gather review comments, requested changes,… |
| `/sdd:search` | Unified semantic exploration skill combining qmd hybrid retrieval with cgg call… |

Run `/sdd:prime [topic]` at the start of a session to load relevant ADRs and specs into context.

### Governing Comments

When implementing code governed by ADRs or specs, leave comments referencing the governing artifacts:

```
// Governing: ADR-0001 (chose JWT over sessions), SPEC-0003 REQ "Token Validation"
```

These comments help future sessions (and `/sdd:check`) trace implementation back to decisions.

### Workflow

1. **Decide**: `/sdd:adr` — record the architectural decision
2. **Specify**: `/sdd:spec` — formalize requirements with RFC 2119 language
3. **Plan**: `/sdd:plan` — break the spec into trackable issues in your tracker
4. **Enrich**: `/sdd:organize` and `/sdd:enrich` — add projects and branch conventions
5. **Build**: `/sdd:work` — pick up issues and implement in parallel using git worktrees
6. **Review**: `/sdd:review` — review and merge PRs with spec-aware code review
7. **Validate**: `/sdd:check` and `/sdd:audit` to catch drift

### Session Coordination

When orchestrating multiple SDD plugin skills in a single session (e.g., running `/sdd:work` on several issues), use `TeamCreate` to coordinate agents. Do not spawn ad-hoc background agents for work that requires coordination — `SendMessage` only works within a Team, and isolated agents cannot see sibling file claims or type creations.

### SDD Configuration

#### Tracker

- **Type**: github
- **Owner**: jonstump
- **Repo**: the-outfitter

#### Coding Models

Tickets are implemented by the models below — not by Opus. `/sdd:plan` and `/sdd:enrich` MUST size stories and write issue bodies for the *weakest* implementer in this list, not the strongest.

| Model | Identifier | Context | Role |
|-------|-----------|---------|------|
| Claude Sonnet 5 | `claude-sonnet-5` | 1M | Default for most stories |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K | Mechanical and well-scoped stories |
| DeepSeek V4 Flash 0731 | `deepseek-v4-flash-0731` | 1M | Non-Anthropic; runs outside Claude Code. Output cap 384K |

**Context is 1M; 384K is the output cap.** The serving provider's published spec lists a 1.0M context window, and the separately reported `max_tokens: 384000` is the per-response output ceiling — two different limits, both true, which is why an earlier revision of this row briefly recorded 384K as the window. The identifier remains self-reported rather than taken from a published reference; the context figure is not.

Neither number changes the sizing guidance below, because both exceed Haiku's 200K.

What this changes about planning:

- **Issue bodies must stand alone.** A non-Anthropic implementer runs outside Claude Code, so its agent sees none of this: not this file, not the SDD skills, not the qmd index, not the ADRs unless the issue quotes them. Name every file by path, state the governing ADR/spec constraint inline rather than by reference alone, and give the exact test command. `/sdd:plan`'s "extend `X` in `path/to/file`" framing is the floor here, not a nicety.
- **Size to the low end.** Prefer the ~150–300 line PR target over 200–500 even for greenfield stories, and split rather than stretch. The 3–4-stories-per-spec grouping may need to become 5–6.
- **Haiku's 200K window is the binding ceiling — now confirmed, not assumed.** Sonnet and DeepSeek both carry 1M windows, so Haiku 4.5 has the smallest of the three by a factor of five, and sizing to it sizes to all of them. A story whose working set is `spec.md` + `design.md` + `catalog.js` + a test file can exceed 200K on its own. Keep each story's file list short enough that the issue body fits alongside it.
- **Assume nothing is inferred.** Do not rely on the implementer noticing a load-bearing comment, a sibling test, or a wire-format invariant. If a constraint matters, it goes in the issue body.

No SDD skill reads this section yet — `/sdd:work` dispatches to `general-purpose` with no model override, and `/sdd:plan` has no model input. This is guidance for whoever runs those skills. If the skills should honour it directly, that is a plugin change (`/sdd:report-friction`).

#### Projects

- **Default Mode**: per-epic
- **Views**: All Work (table), Board (board), Roadmap (roadmap)
- **Iteration Weeks**: 2

Cached project IDs (reused by `/sdd:plan` and `/sdd:organize` instead of creating duplicates):

| Spec | Project | Number | ID | State |
|------|---------|--------|-----|-------|
| SPEC-0001 | SPEC-0001: Equipment Iconography | 7 | `PVT_kwHOA4k1ys4BgTKJ` | open |
| SPEC-0002 | SPEC-0002: Developer Environment Consistency | 1 | `PVT_kwHOA4k1ys4Bf4Mk` | open |
| SPEC-0003 | SPEC-0003: Hunter Loadout Lists | 2 | `PVT_kwHOA4k1ys4Bf478` | open |
| SPEC-0004 | SPEC-0004: Hunter Roster Dataset | 3 | `PVT_kwHOA4k1ys4Bf5nO` | **closed** |
| SPEC-0006 | SPEC-0006: Equipment Slot Arrangement | 6 | `PVT_kwHOA4k1ys4BgOAX` | open |
| SPEC-0007 | SPEC-0007: Equipment Catalog Dataset | 4 | `PVT_kwHOA4k1ys4Bf_8Z` | open |
| SPEC-0008 | SPEC-0008: Loadout Randomization | 5 | `PVT_kwHOA4k1ys4BgEvL` | open |
| SPEC-0009 | SPEC-0009: Weapon Slots and Dual-Wielded Pairs | 10 | `PVT_kwHOA4k1ys4BgUlt` | open |
| SPEC-0010 | SPEC-0010: Per-Weapon Ammo | 11 | `PVT_kwHOA4k1ys4BgUy6` | open |
| — | a11y: WCAG 2.1 AA Baseline | 8 | `PVT_kwHOA4k1ys4BgTKK` | open |
| — | About and Help | 9 | `PVT_kwHOA4k1ys4BgTKM` | open |

**SPEC-0005 is absent on purpose, and it is NOT a gap.** Desktop Distribution is `status: blocked` — it has no project, no epic and no stories *by decision*, and it MUST NOT be reported as unplanned work, missing coverage, or drift by `/sdd:audit`, `/sdd:check`, or any ticket review. The gate is **product completeness, not technical readiness** — an installed desktop build missing catalog items, carrying known-wrong data, or unable to express loadouts the game allows is half-baked, and desktop users cannot be redeployed out of it. **Seven gates as of 2026-08-15** — the original four, plus the rebrand and the app icon (always intended, simply not written down on the 14th), plus the ammo data:

1. Dual-wield pairs — **clear** (SPEC-0009 `implemented`, epic #327 closed 2026-08-15).
2. Tarot card support — **clear** (#37 admitted the fourteen rows via PR #426, #350's SPEC-0006 amendment landed with it, 2026-08-15).
3. The data-audit remediation worked down — the #351–#394 sweep, 25 of 42 closed (#355, #357, #358, #359 and #360 closed 2026-08-16 via PRs #437/#433/#434/#435/#436; #361, #365, #371, #372, #380, #382, #384, #385, #387 and #389 closed 2026-08-16 via PRs #442/#447/#444/#438/#448/#440/#441/#439/#449/#446; #367 and #373 closed 2026-08-16 via PRs #443/#445, both needing a fix-up round after review — a comment-placement CI failure and a missing ADR-0014 citation, respectively — before merging; #363 closed 2026-08-16 via PR #452, also gate 4's third blocker; #356 and #366 closed 2026-08-16, no PR — both were already superseded by merged ammo-epic work rather than needing new code: #356 asked the UI to stop *asserting* per-weapon ammo compatibility it didn't model, and closed itself on inspection by its own stated condition ("close it as obsolete if #338 lands first") once #344 gave the UI the real thing; #366 asked `AGENTS.md` to stay in step as the wire format and ammo model changed, and its four-item checklist (`FORMAT_VERSION`, the `AMMO` foot-gun section, the scrape-provenance line) was already fully satisfied by #340/#341/#345's PRs — verified directly against the file's current text, not assumed from the checklist; joining #351–#354 and #376), 17 open and none of them a blocker. **Its granularity is unsettled** and the strict and severity readings differ by roughly 4×; the spec says settle it before burning it down further.
4. Equipment drag and drop settled — **clear** (all five blockers closed 2026-08-15/16: #352/#353/#419 via PR #430, #382 via PR #440, #363 via PR #452 — its "fix" turned out to be correcting the issue's own stale premise, since #353 had already wired `slotMax` into the live `equipOverCapacity` path rather than leaving it dead code as #363 assumed, so the actual fix was deduping its blocked-cell count to match `hasFreeCell` instead — and #241 via PR #454, another stale-premise correction: #241 was filed against unimplemented SPEC-0006 and proposed a movement threshold plus a Delete/Backspace key, but the shipped implementation already resolved all three gesture collisions differently — via a dedicated remove button, cleanly separated Enter/Space semantics, and pointer-capture event retargeting — independently verified against the live component code and the W3C Pointer Events spec, not just the PR's narrative). Correction (`/sdd:audit`, 2026-08-16): a prior note here claimed a stale "designated remove target" phrase still survived in `spec.md`'s Icon-Only Controls subsection — re-checked directly and it was already cleaned up; the surviving text ("the remove target," no "designated") is current and matches the shipped implementation. That loose end is closed, not open.
5. The rebrand to "Backwater Outfitters" (#424) — **clear** (PR #463, merged 2026-08-16, reviewed independently twice — once in this session, once in a separate session sharing the same local repo — before merging). Copy-only: display strings and prose renamed across 21 files; the identifiers the governing spec (`desktop-distribution/spec.md:105-116`) says MUST NOT be renamed — `hunt-outfitter-token`, `hunt-outfitter-current`, `hunt-outfitter-selected-list`, `OUTFITTER_DB_FILE`, and `render.yaml`'s service/disk names (`the-outfitter`/`outfitter-data`) — were independently verified untouched by reading their live literal values, not just trusting the PR's own grep claims; a post-merge repo-wide grep for "The Outfitter" turned up zero hits outside two deliberate historical-narration exceptions. Correction to this line's prior text: it named npm workspace names as a fourth *protected* identifier family — the spec actually says those are safe to rename and were left alone only as the smaller diff, not because renaming them is unsafe.
6. The application icon (#428) — **clear** (PR #459, merged 2026-08-16). Landed *ahead of* gate 5 (the rebrand, #424 — also now clear, above) on the owner's explicit call — the mark is a pure pictorial symbol with no wordmark baked in, confirmed to contain no text, so it doesn't visually contradict either name. Review caught and fixed one defect before merge: the original `sizes="any"` on the `.ico` `<link>` tag is deprecated for that exact purpose (it made Chrome download both the ICO and the SVG instead of preferring one, per Evil Martians' favicon guide's own changelog) — corrected to `sizes="32x32"`.
7. The ammo data corrected (SPEC-0010, epic #338) — **clear as of 2026-08-16, and was the largest gate by far.** Epic #338 closed 2026-08-16: every tracked story is `Done` on the SPEC-0010 project board and no open issue anywhere in the repo references it. SPEC-0010's own `status:` frontmatter (`docs/openspec/specs/per-weapon-ammo/spec.md`) still reads `draft` — flagged as due for a bump to `implemented` via `/sdd:status`, not changed here. The app offered 587 (weapon, round) pairs where the wiki lists 491; 137 of 140 weapons were wrong in at least one direction — the 587-vs-491 count ambiguity was a data-scope question about which figures are authoritative, not outstanding work, and does not reopen the gate. The named dependency chain `#339 → #340 → #341 → #342 → #343 → #344 → #345` is **fully closed** as of 2026-08-16 (PRs #450/#451/#456/#457/#458/#460/#466, plus spec defect #431 via PR #453 — each independently verified against primary sources, not just code-read). **#344** (PR #460) switched every reader — UI dropdown, pricer, randomizer, save encoder — off the shared `AMMO` pool onto each weapon's own scraped accepted list; state shape changed from a bare index (`weapons[k].a`) to a two-slot id array (`weapons[k].ammo`). Two non-blocking gaps from its review were filed as follow-ups (#461 second-slot-dropped-silently, #462 missing acceptance-criteria tests). **#461 is now closed as fixed-by #345, not a real gap** — verified 2026-08-16 via a direct encode/decode round trip against `main`: `wireAmmoIndex`, the function #461's body cited, no longer exists; `wireAmmo` (added by #345) writes both ammo slots to the wire unconditionally, so the "silent drop" #461 described had already stopped happening by the time #461 was picked up. **#462 is now closed** via PR #469 (merged 2026-08-16), which added the two remaining named assertions — same-class weapons pricing a shared round id differently (verified against real scraped prices, `auto-4-shorty` $130 vs `drilling` $65 for the same Slug round, not a fabricated pair) and the randomizer never drawing ammo outside a weapon's own accepted list, guarded against a vacuous pass across 50 generated loadouts; its third named criterion (Conversion offers Compact rounds) was confirmed already covered by #347's own test coverage rather than duplicated. **#345** (PR #466) raised `FORMAT_VERSION` to 4 and switched the wire format from a single positional ammo index to a two-slot array of stable ids — `toData`/`fromV4` now write/read `[weaponId, [ammoId0, ammoId1], d]` directly, no more live-pool index translation, closing the Frontier-73C-style hazard for ammo specifically. It also widened the server's `isIslandV4` validator in place (safe because nothing had ever emitted #342's original single-id v4 shape). Two minor acceptance-criteria wording gaps were noted in review (a v2 draft test stood in for the v3 one the issue asked for; "total cost unchanged" is verified via capacity rather than a dollar-cost assertion) — both low-risk by code inspection, left as non-blocking. **#346/#347** (the second ammo control UI, PRs #467/#468) are **closed** as of 2026-08-16. #467 added a second `<select>` per weapon slot, one per entry in `ammoSlotsFor`'s groups — never a second disabled control for a one-slot weapon — with each control's `aria-label` distinguishing bound (dual-family, family-named) from unbound (split-reserve, ordinal-named) two-slot weapons, correctly reflecting #431's amendment (independently verified against the shipped code, not just the PR's claim). It also incidentally closed #465 (ammo slot 0 had no live-region cost announcement at all) as a side effect: the live region watches `ammoCostFor(w)`, the sum across both slots, not just the new one. #468 added the dedicated test coverage, verified via a reproduced mutation test (reverting #467's source turns exactly 14 of 40 tests red; both counts independently confirmed, not just quoted from the PR). **#348** (cross-spec amendments) is **closed**, merged 2026-08-16 (PR #470) — doc-only: SPEC-0003, SPEC-0006, SPEC-0007 and SPEC-0009's `spec.md` and `design.md` amended for wire format v4 (8 files), no requirement renamed, no source file touched, every claim cross-checked against the actual shipped code (`loadoutCodec.js`, `server/src/routes/loadouts.js`) rather than trusting SPEC-0010's own prose — a stale Implementation-status snapshot in SPEC-0009's `spec.md` was caught and corrected in the same pass (it said `FORMAT_VERSION` is 3; recorded as stale rather than silently rewritten). **#366** (AGENTS.md upkeep) is **closed** — its four-item checklist was already satisfied by #340/#341/#345's PRs; see gate 3 above. ADR-0020 (ammo iconography) is unaffected by this gate clearing — it sits behind the desktop ship independently.

The authoritative list lives in the spec's own "Blocked" section; read it there before acting, and do not re-derive it from the spec's requirements — those are the work, not the gate. Do not run `/sdd:plan SPEC-0005` and do not add a row to this table until those clear.

**A closed project is still a cache hit.** SPEC-0004's board is closed because every one of its seven items is done, not because it was abandoned. `/sdd:plan` and `/sdd:organize` MUST reuse the recorded ID rather than creating a second SPEC-0004 board; reopen it if that capability gains new work.

**Two projects have no spec, and that is deliberate.** Under `per-epic` mode a project tracks an epic, and both `a11y` (epic #81) and `About and Help` (epic #72) are epics with no spec of their own — the a11y epic is explicitly scoped as "the WCAG 2.1 AA baseline SPEC-0001 already claims", so its requirements live in SPEC-0001 rather than in a spec of its own. Do not synthesise a spec to fill the `Spec` column.

**Keep this table in step with the tracker.** It went stale once: three projects existed on GitHub that were absent here, which is precisely the duplicate-creation this cache exists to prevent. When a project is created, closed, or renamed, update the row in the same change.
