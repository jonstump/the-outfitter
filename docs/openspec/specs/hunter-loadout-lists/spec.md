---
status: implemented
date: 2026-08-11
implements: [ADR-0006, ADR-0011, ADR-0012, ADR-0013, ADR-0022]
requires: [SPEC-0001, SPEC-0004]
---

# SPEC-0003: Hunter Loadout Lists

## Overview

Saved loadouts currently render as one flat, undifferentiated column. This capability introduces **lists**: user-named groups, each illustrated with a hunter portrait, that saved loadouts are filed into. A loadout filed nowhere belongs to a permanent **Unassigned** group.

**A list is a playlist.** That analogy governs every requirement below and is the fastest way to resolve an ambiguity in reading this spec. A playlist has a name you choose and cover art you pick; two playlists may wear the same cover; a track may sit in a playlist or in none; deleting a playlist deletes the playlist, not the tracks. Nothing about in-game hunter mechanics is modeled — no permadeath, carried traits, or recruitment cost. A list is a container with a face.

The defining property, per ADR-0006, is that **list identity and list imagery are independent**. A list's identity is a user-owned UUID with a free-text name; its portrait is a non-unique reference into a scraped portrait library. Many lists MAY share one portrait, and the size of the portrait library MUST NOT bound how many lists a user can create.

Portrait assets are self-hosted scraped images and therefore inherit the sourcing, fallback, and attribution rules of SPEC-0001 (Equipment Iconography).

See ADR-0006 for the decision record and the rejected alternatives.

**Two requirements were added 2026-08-13** *(per [ADR-0022](../../../adrs/ADR-0022-loadout-identity-and-derived-names.md), tracked by #102, #314 and #315)*; **both have since shipped**, confirmed via `/sdd:audit` 2026-08-16.

- **"Loadout Identity Is Scoped to Its List"** — ~~the server still upserts on `(owner, name)`, so two loadouts sharing a name in different lists silently overwrite one another~~ — **the upsert key became the triple `(owner, listId, name)` in #319**, so the same name in two lists is two records and neither relocates. The requirement's last paragraph, the loaded loadout's write-back onto the record id, **shipped client-side in #320/#321** — `loadSavedThunk` sets `savedId: record.id` on load (`client/src/store/thunks.js`).
- **"A Loadout's Name Is Derived From Its Weapons Until the User Owns It"** — **shipped in #322** (`nameIsDerived`/`derivedName()` in `client/src/store/loadoutSlice.js`), with integration coverage added in #324.

The `status: implemented` field below now correctly covers these two requirements as well as the capability's original scope.

**The ordering constraint is load-bearing and is easy to lose at planning time:** the identity fix must land and deploy before derived naming. A derived name is a pure function of the weapon pair, so shipping naming first makes same-name collisions the default outcome rather than a rare one — silently, and in exactly the case the identity fix exists to prevent. **Landing is done (#319); the constraint now rests on deployment** — #315 MUST NOT ship until the triple key is live, not merely merged.

**Implementation status.** The capability as originally specified is **implemented**, following the sequencing ADR-0006 sets out: the `loadoutLists` collection and its endpoints, `listId` filing on the loadout envelope, cross-collection ownership enforcement, retirement without cascade, the empty-list state, the unchanged wire format, the client-state selection cursor, the grouped roster UI, the hunter portrait picker with its filters and favorites (#88, #114), accent assignment and editing against `--list-accent-{1..6}`, portrait rendering against SPEC-0004's dataset (#110), and all four sort orders including hunter name (#109, #120). **"Loadouts Within a List Have a User-Chosen Order" (added 2026-08-17) is a subsequent amendment, and is now implemented**: the `order` field and its two writers (the `PATCH /api/loadouts/reorder` endpoint and the list-move append), the drag-and-drop UI with its full keyboard equivalent, and the dedicated live-region announcement are all live, tested server-side (`server/src/routes/reorder.test.js`) and client-side (`LoadoutListsPanel.test.jsx`, `savedLoadoutsSlice.test.js`, `listOrdering.test.js`), and confirmed live in the browser.

Three changes were accepted on **2026-08-10**; **one has shipped and survived**. A further change was accepted later that day — the row→card preview replacement, which also withdraws the shed-by-width rule, so the set is no longer purely additive. Each is marked where it appears. (Dropping most-recently-used ordering also happened on that date; it was a removal and is recorded in "List Ordering and Sorting".)

- ~~**Favorites are sectioned rather than interleaved**, and default to favorites-only past a threshold~~ — **implemented in #138.** Amended "Favorite Hunters" and one sentence of "The Hunter Picker Is Filterable and Bounded"
- ~~**Loadout rows preview what they hold**~~ — shipped in #139 as a compact strip, then **superseded the same day**: the requirement licensed something smaller than intended, and is now "Filed Loadouts Preview Their Contents" as a categorised panel plus "Saved Loadouts Render as a Card Grid". Both are **not yet implemented**
- ~~**Loadouts carry an editable description**~~ — shipped in #177, then **corrected in #181**: the field was put on the loadout, which is not the record that references a hunter. It is now two requirements — "Lists Carry an Editable Description" (the inherited one) and "Loadouts Carry a Description of Their Own" (the user's note) — plus the same clause on "The Saved-Loadout Wire Format Is Unchanged"

**Three security changes reached this spec from outside it on 2026-08-11**, all shipped before being specified — recorded here because the sequence was backwards and the spec should say so rather than read as though it led. They arrived as issues #198 and #199 from a security review of `796ca9e` and are now specified above:

- **The deployment trust boundary** (#199, PR #204) — `X-Forwarded-*` was believed from any peer, which made the per-IP floor bypassable on the two topologies with nothing in front. Now "Deployment Trust Boundary", and the reason this spec gained `implements: [ADR-0011]`
- **Allowlist validation and a per-owner ceiling** (#198, PR #205) — the `data` validator accepted unknown keys and nothing capped accumulation. Now "A Write Stores Only What the Wire Format Defines" and "One Owner Cannot Accumulate Records Without Bound"
- **A read budget** (#198, PR #205) — the collection `GET`s carried no limiter while parsing the whole data file on every request. Now a clause of "Rate Limiting", and the reason the endpoint table gained the reads it always had

**A rules change reached this spec on 2026-08-11, and this one arrives in the intended order** — decided first, specified here, not yet implemented. ADR-0012 caps a loadout at the game's fifteen-trait maximum, enforced at every path that writes a trait. It is specified as "A Loadout Holds At Most Fifteen Traits", and it is the reason this spec gained `implements: [ADR-0012]`.

Worth flagging for anyone reading the preview requirement: this **reverses a position this spec previously took**. "Filed Loadouts Preview Their Contents" recorded fifteen as a fact about the game rather than an invariant the app enforces, and specified what a preview does when a loadout exceeds it. That premise is struck; the overflow *rendering* is kept as defence rather than as a specified ordinary case, for the reason given there. Implementation is tracked by #160.

A fourth change reached this spec from outside it, also on 2026-08-10: the **ADR-0007 amendment replacing two portrait sizes with one trimmed asset**. It rewrites part of "Hunter Dataset Consumption Contract" — the size-selection rule, the cross-size fallback ordering, and the assumption of a uniform portrait aspect — and is **still outstanding — #148**. SPEC-0004 owns the production half, which shipped in #147; the consumption half is amended here rather than overridden from there, and is what #148 implements.

## Requirements

### Requirement: List Identity Is User-Owned and Independent of Portrait

A list SHALL be identified by a server-generated UUID that is unrelated to any portrait identifier. A list SHALL carry a user-supplied display name. A list MAY reference one portrait from the portrait library via a `hunterId` field.

The `hunterId` field MUST NOT be constrained to be unique within an owner's lists. The system MUST NOT impose any limit on the number of lists derived from the size of the portrait library.

A list's display name SHALL be mutable at any time without affecting the list's identity or the loadouts filed into it.

#### Scenario: Two lists share one portrait

- **WHEN** a user creates a list named "Rat — long ammo" and a second list named "Rat — shotgun", both referencing the same `hunterId`
- **THEN** both lists SHALL be persisted as distinct records with distinct UUIDs, and both SHALL be returned by a subsequent list fetch

#### Scenario: List count exceeds portrait library size

- **WHEN** a user creates more lists than there are portraits in the library
- **THEN** every creation SHALL succeed, and no error referencing portrait availability SHALL be returned

#### Scenario: Renaming a list preserves its filed loadouts

- **WHEN** a user renames a list that has loadouts filed into it
- **THEN** the list's UUID SHALL be unchanged, and every loadout previously filed into it SHALL remain filed into it

#### Scenario: A list may be created without a portrait

- **WHEN** a user creates a list and supplies no `hunterId`
- **THEN** the list SHALL be created successfully with a null `hunterId`, and the UI SHALL render a neutral placeholder in place of a portrait

### Requirement: New Lists Default Their Name from the Chosen Portrait

When a user creates a list by selecting a portrait and supplies no explicit name, the system SHALL default the list's name to the display name of the selected hunter. The defaulted name SHALL be an ordinary mutable value, indistinguishable in storage from a user-typed name.

When a user creates a list with no portrait and no name, the system SHALL apply a generic default name.

#### Scenario: Portrait selection supplies the default name

- **WHEN** a user creates a list selecting the portrait whose hunter display name is "The Rat", supplying no name
- **THEN** the created list's name SHALL be "The Rat"

#### Scenario: An explicit name overrides the default

- **WHEN** a user creates a list selecting a portrait and supplies the name "shotgun experiments"
- **THEN** the created list's name SHALL be "shotgun experiments", and the portrait's hunter name SHALL NOT appear in the record

#### Scenario: A defaulted name can be edited afterward

- **WHEN** a user renames a list whose name was defaulted from its portrait
- **THEN** the rename SHALL succeed exactly as it would for a user-typed name

### Requirement: Loadouts Are Filed into Lists by Nullable Reference

Each saved loadout record SHALL carry an OPTIONAL `listId` field on the record envelope, sibling to `name` and `updatedAt`. The `listId` field MUST NOT be placed inside the loadout's `data` payload.

A loadout whose `listId` is null or absent SHALL be presented in the Unassigned group. Unassigned SHALL be a permanent, legitimate group, not an error state or a migration artifact.

Any number of loadouts MAY reference the same `listId`. The system MUST NOT impose a per-list loadout cap.

Records written before this capability existed carry no `listId` and SHALL therefore be presented as Unassigned without any migration, backfill, or rewrite.

#### Scenario: Many loadouts file into one list

- **WHEN** a user files ten saved loadouts into a single list
- **THEN** all ten SHALL persist with the same `listId`, and all ten SHALL be returned under that list on fetch

#### Scenario: Saving with no list selected

- **WHEN** a user saves a loadout while no list is selected
- **THEN** the loadout SHALL be persisted with a null `listId` and SHALL appear in the Unassigned group

#### Scenario: Pre-existing records require no migration

- **WHEN** the capability is deployed against a data file containing loadout records written before this change
- **THEN** those records SHALL be readable unmodified and SHALL appear in the Unassigned group

#### Scenario: A loadout is moved between lists

- **WHEN** a user moves a loadout from list A to list B
- **THEN** the loadout's `listId` SHALL be updated to B, the loadout SHALL disappear from A's group and appear in B's, and no other field of the loadout SHALL change

### Requirement: Loadout Identity Is Scoped to Its List

*(added 2026-08-13, per [ADR-0022](../../../adrs/ADR-0022-loadout-identity-and-derived-names.md); closes #102. **Implemented on the server in #319** — the upsert key below is live. The record-id write-back in the last paragraph is client-side and is **not yet implemented** — #314. See "Implementation status".)*

A saved loadout SHALL be identified by the triple `(owner, listId, name)`. A write whose triple matches an existing record SHALL update that record; a write whose triple matches nothing SHALL create one.

`listId` SHALL be compared **as a value, including when it is `null`**. The Unassigned pseudo-list is `null`, so treating `null` as "missing" rather than as a value collapses every Unassigned save onto the first such record — which is the defect this requirement exists to prevent, in a different form.

Two loadouts carrying the same name in different lists SHALL both persist, and neither SHALL relocate. This follows from the model ADR-0006 established: a list is a folder, and two loadouts named "Fanning" in different folders are different loadouts.

**Pre-existing records SHALL require no migration.** The key narrows rather than widens: any pair that matched under `(owner, name)` and shared a `listId` still matches, and any pair that matched *across* lists was the defect. No stored record changes shape and `FORMAT_VERSION` MUST NOT be raised — `listId` lives on the envelope, not inside `data`, per REQ "Loadouts Are Filed into Lists by Nullable Reference".

A loadout loaded from a saved record SHALL be updated **by its record id** rather than by triple, so that editing a loaded loadout still writes back to the record it came from. That provenance SHALL be client-only; see REQ "The Saved-Loadout Wire Format Is Unchanged".

The endpoint contract that carries this is the optional `id` on `POST /api/loadouts`, specified under "HTTP API" — including that an `id` naming no record the caller owns is a `404` rather than a fallback to the triple *(clause added 2026-08-13; the requirement above stated the behaviour without naming a mechanism, and no route could perform it — `PATCH /api/loadouts/:id` reaches `listId` and `description` only)*. *(**Not yet implemented** — #319 shipped the server key above, and a loaded loadout still round-trips by name today. This paragraph is #314.)*

#### Scenario: The same name in two lists is two loadouts

- **WHEN** one owner saves a loadout named "Fanning" into list A and another named "Fanning" into list B
- **THEN** two records SHALL exist, neither SHALL have relocated, and neither SHALL have overwritten the other

#### Scenario: Unassigned saves still upsert onto one record

- **WHEN** one owner saves twice under the same name with `listId` `null` both times
- **THEN** the second write SHALL update the first record rather than creating a second, because `null` is compared as a value

#### Scenario: A loaded loadout updates the record it came from

- **WHEN** a user loads a saved loadout, changes it, and saves without renaming it
- **THEN** the write SHALL update that same record rather than creating a copy or matching some other record by name

#### Scenario: Deployment over existing records changes nothing

- **WHEN** the change is deployed against a data file written under the old `(owner, name)` key
- **THEN** every record SHALL remain readable and unmodified, and `FORMAT_VERSION` SHALL be unchanged

### Requirement: A Loadout's Name Is Derived From Its Weapons Until the User Owns It

*(added 2026-08-13, per [ADR-0022](../../../adrs/ADR-0022-loadout-identity-and-derived-names.md). Not yet implemented — see "Implementation status".)*

**This requirement MUST NOT ship before "Loadout Identity Is Scoped to Its List" has landed and deployed.** A derived name is a pure function of the weapon pair, so two loadouts built from the same two weapons receive the same name by construction. Under the old `(owner, name)` key that turns a rare user error into the default outcome, silently. The ordering is part of the decision, not an implementation preference.

An unsaved loadout's name SHALL default to `{weapon1} and {weapon2}`, taken from each weapon's display name. Degenerate cases are specified rather than left open: **one weapon** SHALL yield that weapon's name alone, and **no weapons** SHALL yield the existing generic default — never the bare string "and".

The name SHALL be re-derived **only when a weapon changes**. It MUST NOT be re-derived on an equipment, trait, or ammo change, none of which the name can express.

Re-derivation SHALL stop permanently for the current editing session the moment the user edits the name field, and SHALL NOT resume. A loadout **loaded from a saved record** SHALL NOT re-derive at all — its name is one the user already owns.

The "still derived" state SHALL be client-only and ephemeral: not persisted, not sent to the server, and not part of the wire format. A derived name SHALL be stored as an ordinary string, indistinguishable from a typed one — the same property REQ "New Lists Default Their Name from the Chosen Portrait" establishes for lists, and for the same reason.

#### Scenario: A weapon change re-derives the name

- **WHEN** a user building a new loadout selects or replaces a weapon
- **THEN** the name SHALL update to reflect the current weapon pair

#### Scenario: Typing takes ownership of the name

- **WHEN** a user edits the name field and then changes a weapon
- **THEN** the name SHALL NOT be re-derived, and the user's text SHALL survive unchanged

#### Scenario: A loaded loadout keeps its name

- **WHEN** a user loads a saved loadout and changes one of its weapons
- **THEN** the name SHALL NOT be re-derived, because the record already carries a name the user owns

#### Scenario: A non-weapon change does not re-derive

- **WHEN** a user with a derived name adds a consumable, a trait, or an ammo variant
- **THEN** the name SHALL be unchanged

#### Scenario: The degenerate names are specified

- **WHEN** a loadout carries exactly one weapon, and separately when it carries none
- **THEN** the name SHALL be that weapon's name alone, and the existing generic default, respectively

### Requirement: Cross-Collection Ownership Enforcement

A `listId` supplied on any write SHALL be validated as referring to a list owned by the calling token. A write supplying a `listId` that is well-formed but owned by a different token MUST be rejected. The system MUST NOT accept such a write silently, and MUST NOT fall back to filing the loadout as Unassigned.

Every list endpoint SHALL filter by the caller's token before performing any read or mutation, following the ownership model established for loadouts.

A `listId` that refers to no existing list SHALL degrade on read rather than failing: the referencing loadout SHALL be presented as Unassigned.

#### Scenario: Filing into another token's list is rejected

- **WHEN** a request bearing token A supplies a `listId` belonging to a list owned by token B
- **THEN** the request SHALL be rejected with a client error, and no record SHALL be created or modified

#### Scenario: Another token's list cannot be read

- **WHEN** a request bearing token A fetches lists
- **THEN** the response SHALL contain only lists owned by token A, and SHALL NOT reveal the existence, name, or portrait of any list owned by another token

#### Scenario: Another token's list cannot be renamed or retired

- **WHEN** a request bearing token A attempts to rename or retire a list owned by token B
- **THEN** the request SHALL be rejected, and token B's list SHALL be unchanged

#### Scenario: A dangling list reference degrades on read

- **WHEN** a loadout references a `listId` for which no list record exists
- **THEN** the loadout SHALL be presented in the Unassigned group rather than causing an error or being hidden

#### Scenario: Requests without a token create no durable list

- **WHEN** a request carrying no `x-loadout-token` header creates a list
- **THEN** that list MUST NOT be visible to any subsequent request, consistent with the request-scoped anonymous identity used for loadouts

### Requirement: Retiring a List Never Destroys Loadouts

Retiring a list SHALL delete the list record and SHALL clear the `listId` of every loadout that referenced it, placing those loadouts in the Unassigned group. Retiring a list MUST NOT delete, archive, or otherwise render inaccessible any loadout.

The confirmation presented to the user before retiring SHALL state that the list is removed and its loadouts are preserved.

Retirement SHALL permanently delete the list record. The system MUST NOT retain the retired list in any form — no `retired` flag, no archived copy, no hidden or filtered-out record. A user who wants the list back SHALL create a new one.

#### Scenario: A retired list leaves no residue

- **WHEN** a user retires a list and the persisted data is inspected
- **THEN** no record of that list SHALL remain, in any form or under any flag

#### Scenario: Loadout count is unchanged by retirement

- **WHEN** a user retires a list containing five loadouts
- **THEN** the total count of that user's saved loadouts SHALL be identical before and after, and those five loadouts SHALL have a null `listId`

#### Scenario: Retiring an empty list

- **WHEN** a user retires a list containing no loadouts
- **THEN** the list SHALL be removed and no loadout SHALL be affected

#### Scenario: Confirmation states the outcome

- **WHEN** the retire confirmation is presented
- **THEN** it SHALL state that the loadouts move to Unassigned rather than being deleted

### Requirement: An Empty List Is a Valid Persisted State

A list SHALL persist independently of whether any loadout references it. A list created with no loadouts SHALL survive a page reload and SHALL be returned by a subsequent fetch.

The set of a user's lists MUST NOT be derived from the distinct `listId` values present on their loadouts.

#### Scenario: An empty list survives a reload

- **WHEN** a user creates a list, adds no loadouts, and reloads the application
- **THEN** the list SHALL still be present and selectable

### Requirement: Hunter Dataset Consumption Contract

This capability consumes a hunters dataset; it does not specify how that dataset is produced. Production is specified by SPEC-0004 (Hunter Roster Dataset), which realizes ADR-0007.

The dataset SHALL provide, for each hunter, a stable identifier, a display name, a description, and a portrait asset self-hosted under the application's own origin *(description added 2026-08-10, consumed by "Lists Carry an Editable Description" — by the LIST, which is the record that references a hunter, since 2026-08-11)*.

*(amended 2026-08-10; not yet implemented)* Per the ADR-0007 amendment of that date, a hunter has **one** portrait asset, trimmed to the subject and stored at its native resolution. Consuming code SHALL request that single asset and MUST NOT select between sizes. The `size` argument currently threaded through the portrait render path SHALL be removed rather than defaulted, so no call site can ask for a size that no longer exists.

Because each asset is trimmed to its own subject, portraits SHALL vary in dimensions and aspect ratio between hunters. Consuming code MUST NOT assume a uniform portrait aspect, and SHALL continue to size portraits by their container rather than by intrinsic dimensions.

The application at runtime MUST NOT issue any request to the wiki in order to render a list.

Portraits are encoded as AVIF (SPEC-0004). The render site's extension-resolution chain SHALL include `avif`, so that adding portraits requires no change at the call site — the same property that lets the item scrape replace or re-extension its images freely.

*(amended 2026-08-10; not yet implemented)* With one asset per hunter the fallback ladder has two rungs: the portrait, then the placeholder. The cross-size ordering this requirement previously stated — request the size appropriate to the context, fall back to the other size before the placeholder — no longer has two sizes to order and is removed. An empty tile remains a defect.

**The list card is knowingly upscaled.** SPEC-0003's 154×220 list card needs 440px of subject height at 2×, and the source supplies at most 256px, so no hunter's portrait reaches it. The card SHALL render the portrait upscaled by roughly 1.9× rather than the pipeline manufacturing pixels to close the gap. This is a source-resolution ceiling recorded in SPEC-0004, not a defect in either spec. Closing it would require rendering the card's portrait area at 113px tall or less, which is a card redesign and is not required here.

Consuming code MUST tolerate a dataset entry whose portrait asset is absent, and MUST tolerate a `hunterId` that is absent from the dataset entirely, since the dataset and a user's stored lists refresh independently.

Consuming code MUST likewise tolerate a dataset entry whose description is absent or empty, rendering no description rather than an empty element or a placeholder *(added 2026-08-10)*. Every entry carries one today; the tolerance exists because the dataset refreshes independently of this spec.

#### Scenario: Portraits are served from the application's own origin

- **WHEN** the application renders a list's portrait
- **THEN** the image SHALL be served from the application's own origin, and no request SHALL be issued to the wiki

#### Scenario: A missing portrait falls back to a placeholder

- **WHEN** a list references a hunter for which no portrait asset is present
- **THEN** the UI SHALL fall back to a neutral placeholder using the same fallback mechanism SPEC-0001 defines for items, and SHALL NOT render a broken image

#### Scenario: No consumer selects a portrait size

- **WHEN** the portrait render path is inspected
- **THEN** no call site SHALL pass a size, and the asset URL SHALL be derived from the hunter's `portrait` slug alone

#### Scenario: The extension chain resolves AVIF portraits

- **WHEN** a portrait exists only as AVIF
- **THEN** the render site SHALL resolve and display it without any per-hunter configuration

#### Scenario: A list survives its hunter leaving the dataset

- **WHEN** a list references a `hunterId` that no longer appears in the dataset
- **THEN** the list SHALL remain fully usable — selectable, renameable, and able to hold loadouts — rendering a neutral placeholder and its own name in place of the missing hunter

#### Scenario: A hunter carrying no description yields no default

- **WHEN** a list inherits its description from a hunter whose dataset entry has an absent or empty description
- **THEN** no description SHALL be rendered, and neither the list nor its loadouts SHALL fail

### Requirement: Lists Are Visually Distinguishable Independent of Portrait and Name

Because two lists MAY share a hunter, a list SHALL carry a distinguishing visual attribute that depends on neither its name nor its portrait. An accent colour SHALL be assigned at creation and SHALL be user-editable.

The accent SHALL be drawn from the fixed six-value palette defined in design.md and exposed as CSS custom properties in `client/src/styles/global.css`. Ad-hoc colour values MUST NOT be used. Every palette value SHALL meet WCAG 2.1 SC 1.4.11 (3:1 non-text contrast) against the panel, card, and page backgrounds.

The creating user MAY supply an accent, which SHALL be validated against the palette and used as given. **When the user supplies none**, assignment on creation SHALL select the least-used palette value among the owner's existing lists. Distinct lists SHOULD therefore receive distinct accent colours while any remain unused. The system MUST NOT reject or prevent a duplicate accent colour, whether it was chosen or assigned.

*(qualifying clause added 2026-08-10, #135 — this sentence described least-used assignment as unconditional, which the server never was: `POST /api/loadout-lists` has always read an `accent` from the body and fallen back to least-used only in its absence. The clause described the fallback as though it were the whole rule, and the client offered no way to reach the other branch. Widening the sentence rather than the endpoint is the smaller change, because the endpoint was already right.)*

Because palette values are separated primarily by hue rather than luminance, the accent MUST NOT be the sole means of distinguishing one list from another; the list name remains the primary accessible identity.

The accent attribute SHALL be persisted on the list record.

#### Scenario: Two lists sharing a hunter are distinguishable

- **WHEN** a user creates two lists referencing the same `hunterId`
- **THEN** each SHALL be assigned a distinct accent colour, and each SHALL render that accent in the list selector and in its group heading

#### Scenario: Accent colour is editable

- **WHEN** a user changes a list's accent colour
- **THEN** the change SHALL persist and SHALL be reflected everywhere the list is rendered

#### Scenario: Duplicate accents are permitted

- **WHEN** a user assigns an accent colour already used by another of their lists
- **THEN** the assignment SHALL succeed without warning or rejection

### Requirement: The Hunter Picker Does Not Restrict or Mark Reuse

The picker MUST NOT disable, hide, reorder-away, or otherwise prevent selection of a hunter already referenced by the user's other lists. Every hunter in the dataset SHALL be selectable at all times.

The picker MUST NOT mark or otherwise call out which hunters are already in use. Reuse is an unremarkable state, and surfacing it invites a user to read an unmarked hunter as the "correct" choice — the opposite of the intent. Lists that share a hunter are distinguished by their accent colour and name instead.

The picker SHALL offer an explicit "no portrait" choice, so a list can be created without selecting any hunter.

#### Scenario: An already-used hunter remains selectable

- **WHEN** a user opens the picker and selects a hunter already used by another of their lists
- **THEN** the selection SHALL succeed, and a new list SHALL be created referencing that hunter

#### Scenario: The picker draws no distinction between used and unused hunters

- **WHEN** the picker is displayed and at least one hunter is already used by another list
- **THEN** those hunters SHALL be presented identically to unused hunters within whichever section they belong to, with no badge, dimming, count, or ordering that derives from their being in use — the favorites sectioning being the only permitted grouping *(amended 2026-08-10)*

#### Scenario: A list can be created with no portrait

- **WHEN** a user chooses the "no portrait" option in the picker
- **THEN** a list SHALL be created with a null `hunterId`, rendering a monogram derived from its name

### Requirement: The Hunter Picker Is Filterable and Bounded

The roster is 242 hunters. A flat grid of every portrait is not a usable picker and is not a defensible payload, so filtering is a functional requirement rather than a refinement.

The picker SHALL provide a free-text filter matching on hunter name. It SHALL provide filtering by the classification SPEC-0004 supplies — at minimum `acquisition` and `obtainable`.

The picker MUST NOT load every hunter's portrait eagerly. Images SHALL be loaded lazily, so the bytes fetched are proportional to what the user has actually scrolled to rather than to the size of the roster.

Filtering SHALL narrow which hunters are shown. Apart from the favorites sectioning that "Favorite Hunters" requires *(carve-out added 2026-08-10; implemented in #138)*, it MUST NOT reorder or hide hunters for any other reason. In particular, this requirement does not reintroduce the in-use marking that "The Hunter Picker Does Not Restrict or Mark Reuse" forbids — a hunter already used by another list is shown exactly like any other hunter that matches the filter, in whichever section it belongs to.

An empty result SHALL say so, rather than rendering an empty grid.

#### Scenario: Name filtering narrows the roster

- **WHEN** a user types into the picker's filter
- **THEN** only hunters whose name matches SHALL be shown, and the count of shown hunters SHALL decrease

#### Scenario: Classification filtering uses the dataset's own values

- **WHEN** a user filters by an acquisition value
- **THEN** only hunters whose `acquisition` matches SHALL be shown

#### Scenario: Portraits are not loaded eagerly

- **WHEN** the picker is opened against the full roster
- **THEN** portraits outside the visible area SHALL NOT be fetched, and the bytes loaded SHALL be proportional to what has been scrolled to rather than to the roster size

#### Scenario: Filtering does not mark reuse

- **WHEN** a filter is applied and some matching hunters are already used by the user's other lists
- **THEN** those hunters SHALL be presented identically to unused ones within whichever section they belong to, with no badge, dimming, count, or ordering that derives from their being in use — the favorites sectioning being the only permitted grouping *(amended 2026-08-10)*

#### Scenario: An empty result is stated

- **WHEN** a filter matches no hunters
- **THEN** the picker SHALL say that nothing matched rather than rendering an empty grid

### Requirement: Favorite Hunters

With a roster of 242, finding the handful of hunters a user actually returns to is the picker's real cost. A user MAY mark any hunter as a favorite.

Favorites SHALL be token-scoped and persisted server-side, under the same ownership rules as lists: a favorite belongs to the token that created it, and MUST NOT be visible to any other token.

Favorites SHALL act as a **filter and a grouping over the full roster**, never as a gate. Every hunter SHALL remain reachable regardless of what is favorited.

The five sectioning rules below were **amended 2026-08-10 and are implemented (#138)** — they replaced an inline sort in which favorites simply sorted ahead of unfavorited hunters within one undivided grid:

- Favorited hunters SHALL be presented in their own labelled section, ahead of the rest of the roster
- A hunter SHALL appear in exactly one section per render: in Favorites when favorited, in the main section otherwise. The picker MUST NOT render the same hunter twice
- Both sections SHALL be narrowed by whatever filter is active, so a favorite that fails the active filter appears in neither
- Each section SHALL be labelled and SHALL state its own count, so "6 favorites, 65 others" is legible without counting tiles
- A section with no members SHALL be omitted entirely rather than rendered as an empty heading

These two rules are unchanged and already implemented:

- The picker SHALL offer a "favorites only" toggle
- With that toggle off, the roster SHALL be shown in full

An empty favorites set SHALL therefore behave as no filter at all, not as an empty picker. The system MUST NOT pre-populate favorites — a favorite records a choice the user made, and seeding it with arbitrary hunters would require the user to remove preferences they never expressed.

**When the owner's favorite set is empty**, the "favorites only" toggle SHALL be off and SHALL be rendered disabled, carrying an accessible explanation of why. Enabling it would narrow 242 hunters to zero, which is exactly the empty picker this requirement forbids. If the set becomes empty while the picker is open — the user unfavorites their last hunter — the toggle SHALL reset to off and disabled in place, and the full roster SHALL return, rather than leaving an enabled filter matching nothing.

**Sectioning replaces the previous inline sort.** The two are alternatives, not layers: a favorite is either lifted into its own section or sorted ahead within one list, and doing both would place a hunter above the section it is also inside. The previous behaviour is recorded here so this is read as a decision rather than as drift.

Favoriting SHALL NOT restrict or mark reuse, and MUST NOT be conflated with it: a favorite is the user's own preference, whereas reuse is a fact about their other lists, which "The Hunter Picker Does Not Restrict or Mark Reuse" requires stay unmarked.

#### Scenario: A favorite persists for its owner

- **WHEN** a user favorites a hunter and reloads the application
- **THEN** that hunter SHALL still be favorited

#### Scenario: Favorites are private to their token

- **WHEN** a request bearing token A fetches favorites
- **THEN** the response SHALL contain only token A's favorites, and SHALL NOT reveal any favorite belonging to another token

#### Scenario: Favorites occupy their own section within the active filter

- **WHEN** a user filters by an acquisition value and some matching hunters are favorited
- **THEN** the favorited matches SHALL appear in a labelled Favorites section ahead of a section holding the unfavorited matches, and no non-matching hunter SHALL be shown in either

#### Scenario: A favorited hunter is not also listed among the others

- **WHEN** the picker renders with at least one favorite
- **THEN** each favorited hunter SHALL appear once, in the Favorites section only, and SHALL NOT also appear in the main section

#### Scenario: A section with no members is omitted

- **WHEN** a filter matches favorited hunters but no unfavorited ones
- **THEN** the Favorites section SHALL be shown with its count and the main section SHALL be omitted rather than rendered empty

#### Scenario: The full roster stays reachable

- **WHEN** a user has favorites and the "favorites only" toggle is off
- **THEN** every hunter SHALL be shown, favorited or not

#### Scenario: An empty favorites set is not an empty picker

- **WHEN** a user who has favorited nothing opens the picker
- **THEN** the full roster SHALL be shown, no favorites filter SHALL be applied, and the "favorites only" toggle SHALL be off and disabled with an accessible explanation

#### Scenario: Unfavoriting the last hunter restores the roster in place

- **WHEN** a user with "favorites only" enabled unfavorites their last remaining favorite
- **THEN** the toggle SHALL reset to off and disabled, and the full roster SHALL be shown without the user having to re-open the picker

#### Scenario: Favorites are never pre-populated

- **WHEN** a user opens the picker for the first time
- **THEN** no hunter SHALL be favorited on their behalf

#### Scenario: Favoriting does not mark reuse

- **WHEN** a favorited hunter is also already used by one of the user's lists
- **THEN** the picker SHALL indicate only that it is favorited, and SHALL NOT indicate that it is in use

### Requirement: Favorites-Only Becomes the Default Past a Threshold

*(added 2026-08-10; implemented in #138)*

Curating past a certain number of favorites is itself evidence that the user has settled on who they care about. Once an owner's favorite count **exceeds 10**, the picker SHALL open with "favorites only" already enabled.

This MUST remain a change to the **default position of a user-operable control**, and MUST NOT become a gate:

- The toggle SHALL remain visible, SHALL remain operable whenever at least one favorite exists, and turning it off SHALL show the full roster immediately
- Turning it off SHALL hold for the remainder of that picker session; reopening the picker SHALL re-apply the default
- The auto-enabled state MUST NOT be persisted server-side, consistent with the toggle being client state under the same rule as the selected list and the sort order
- At or below the threshold the picker SHALL open with the toggle off
- The threshold SHALL be a single named constant, so changing it is one edit rather than a search

The threshold is a product judgement rather than a measured figure; design.md records it as such so a later reader does not go looking for the study that produced it.

Crossing the threshold MUST NOT retroactively change any stored favorite, and dropping back to the threshold or below SHALL restore the default-off behaviour on the next open. The empty-set rule stated in "Favorite Hunters" takes precedence over this one: a user whose favorites fall to zero SHALL see the full roster with the toggle off and disabled.

#### Scenario: Past the threshold the picker opens filtered

- **WHEN** a user with 11 favorites opens the picker
- **THEN** "favorites only" SHALL be enabled, and only the 11 favorited hunters SHALL be shown

#### Scenario: The full roster is always one control away

- **WHEN** a user whose picker auto-enabled "favorites only" turns the toggle off
- **THEN** every hunter SHALL be shown immediately, and no hunter SHALL be unreachable at any point

#### Scenario: Turning it off does not persist

- **WHEN** a user past the threshold turns "favorites only" off, closes the picker, and reopens it
- **THEN** the picker SHALL again open with "favorites only" enabled, and the server's data file SHALL contain no field recording the toggle

#### Scenario: At the threshold the default is off

- **WHEN** a user with exactly 10 favorites opens the picker
- **THEN** "favorites only" SHALL be off and the full roster SHALL be shown

#### Scenario: Falling back below the threshold restores the default

- **WHEN** a user with 11 favorites unfavorites one and reopens the picker
- **THEN** "favorites only" SHALL be off and the full roster SHALL be shown

### Requirement: List Ordering and Sorting

Lists SHALL be presented in alphabetical order by list display name by default. The system SHALL offer additional orderings, at minimum:

- alphabetical by the display name of the list's hunter, resolved through the hunters dataset
- creation date
- number of loadouts held, descending, ties broken by list display name

Hunter-name ordering SHALL be offered once the hunters dataset resolves names, and MAY be withheld while the dataset is empty, since with nothing to resolve it would silently duplicate the default ordering.

**Most-recently-used ordering was considered and dropped** (2026-08-10). It was originally specified here as "used means the list was last opened by the user", which requires persisting a `lastUsedAt` on the list record — a server write on every list open, for a single ordering. That also sits awkwardly beside "The Selected List Is Client State", which forbids persisting which list the user is looking at: an open *event* is arguably durable where the *cursor* is not, but the distinction is thin enough that it should be argued for rather than assumed. Neither the write cost nor that argument is worth one sort order, so the ordering is removed rather than left indefinitely deferred. If it returns, it needs both the field and a sentence reconciling it with the selection rule.

Under hunter-name ordering, a list that references no hunter, or whose `hunterId` is absent from the dataset, SHALL be grouped together after all lists that resolve to a hunter, ordered among themselves by list display name. Such lists MUST NOT be hidden, and MUST NOT be sorted as though their hunter name were an empty string interleaved with real names.

The Unassigned group SHALL occupy a fixed position independent of the chosen sort, so its location does not move as sorting changes.

A user's chosen sort order SHALL be treated as client state under the same rules as the selected list, and MUST NOT be persisted server-side.

#### Scenario: Default ordering is alphabetical by list name

- **WHEN** a user with several lists loads the application without having chosen a sort
- **THEN** the lists SHALL be ordered alphabetically by their display names

#### Scenario: Ordering by hunter name differs from ordering by list name

- **WHEN** a user with a list named "shotgun experiments" referencing the hunter "The Rat" selects hunter-name ordering
- **THEN** that list SHALL be positioned by "The Rat" rather than by "shotgun experiments"

#### Scenario: Hunterless lists sort to a defined position

- **WHEN** hunter-name ordering is applied and some lists reference no hunter or reference a hunter absent from the dataset
- **THEN** those lists SHALL appear together after all lists that resolve to a hunter, ordered among themselves by list display name, and none SHALL be omitted

#### Scenario: An alternative sort is applied

- **WHEN** a user selects ordering by number of loadouts held
- **THEN** the lists SHALL reorder accordingly, and the Unassigned group SHALL remain in its fixed position

#### Scenario: Sort preference is not server state

- **WHEN** the server's data file is inspected after a user changes sort order
- **THEN** no field recording the sort preference SHALL be present, and no write SHALL have occurred as a result

### Requirement: Loadouts Within a List Have a User-Chosen Order

*(added 2026-08-17, per design.md "Loadouts within a list have a user-set order, stored server-side")*

Unlike list ordering above, the order of loadouts WITHIN one list — or within Unassigned — SHALL be a user-arrangeable, server-persisted property, distinct from the sort preference governed by "List Ordering and Sorting", which remains client-only and unaffected by this requirement.

The system SHALL provide a drag-and-drop affordance for reordering loadout cards within their list, and SHALL provide a keyboard-operable equivalent achieving the same result without a pointer: a card SHALL be picked up, moved, and dropped using the keyboard alone, and an in-progress reorder SHALL be cancellable, restoring the card's original position. This requirement exists alongside, and does not relax, "Filing a loadout into a list MUST be achievable without a pointer" under Accessibility Requirements — that requirement governs which list a loadout is filed into and is untouched by this one, which governs only position within a list.

Reordering SHALL be scoped to one list (or Unassigned) at a time — a drag that reorders cards SHALL NOT move a loadout into a different list. Moving a loadout between lists remains the existing explicit control.

A moved loadout — filed into a different list by the existing move control — SHALL be placed at the end of its new list's order rather than at a position carried over from its old one.

The order SHALL persist across a page reload and be visible identically from any browser holding the same owner token, since it is server state.

A loadout record predating this requirement, carrying no stored order, SHALL render in the position implied by its existing storage order, without requiring a migration write, until the first time it or a list-mate is reordered.

#### Scenario: A drag reorders two cards

- **WHEN** a user drags a loadout card to a new position among its list-mates and drops it there
- **THEN** the cards SHALL render in the new order, and reloading the page SHALL preserve it

#### Scenario: The keyboard equivalent achieves the same result

- **WHEN** a user, without using a pointer, picks up a loadout card via the keyboard, moves it past a list-mate, and confirms the drop
- **THEN** the resulting order SHALL be identical to the outcome of doing the same move by drag, and the move SHALL be announced on a live region

#### Scenario: An in-progress reorder is cancellable

- **WHEN** a user picks up a card, by pointer or keyboard, and presses Escape before dropping it
- **THEN** the card SHALL return to its original position and no order SHALL be written

#### Scenario: Reordering does not cross a list boundary

- **WHEN** a user reorders cards within an open list
- **THEN** no loadout's `listId` SHALL change as a result

#### Scenario: A loadout moved between lists lands at the end

- **WHEN** a loadout is filed into a different list via the existing move control
- **THEN** it SHALL be positioned after every loadout already in that list, not at a position inherited from the list it left

#### Scenario: Order is server state, not client state

- **WHEN** a user reorders loadouts in one browser and then opens the application from a different browser holding the same owner token
- **THEN** the same order SHALL be visible in both

#### Scenario: A pre-existing record needs no migration

- **WHEN** a loadout saved before this requirement existed is rendered, and no reorder has touched its list yet
- **THEN** it SHALL appear in its original creation-order position, and no write SHALL have occurred merely from rendering it

### Requirement: Filed Loadouts Preview Their Contents

*(added 2026-08-10; shipped in #139 as a compact strip and superseded the same day — the replacement below is not yet implemented)*

A saved loadout currently shows only a name and a cost. Neither tells the user what the loadout actually holds, so choosing among a list's loadouts means loading each one in turn and undoing the ones that were wrong.

Each saved loadout SHALL present a preview of what that loadout holds. The preview SHALL be derived from the record's existing `data` payload, and SHALL require **no additional request for loadout data** and no change to the stored record. Fetching the imagery that depicts it is not such a request.

*(amended 2026-08-10 — replaces the compact-strip preview shipped in #139, which conformed to this requirement as originally written and was smaller than intended.)*

The preview SHALL be a **categorised panel**, not a single undifferentiated strip. Its categories SHALL match the builder's **grouping and cell counts**, so a loadout is read the same way in a list as in the panel that produced it. Parity is scoped to grouping and counts deliberately: SPEC-0006 added consumable stacking and per-cell blocking to the builder, and **neither is required of the preview by this requirement** — they need their own clause.

> **That clause is now owed, not anticipated** *(2026-08-13)*. SPEC-0006 shipped, so the scoping note above has outlived its "when that spec lands" framing. What the preview does today, recorded as fact rather than ratified as the rule: `previewGroups` builds each cell independently from `loadout.equip[slot]` and performs no run detection, so a run of three identical consumables renders as **three separate cells**, where the builder draws one badged anchor and two held cells. It also never reads `loadout.blocked`, so a **blocked cell is indistinguishable from an empty one**. Whether either is the desired behaviour is a design decision this correction does not make — it is left to whoever writes the clause, which is why no SHALL is stated here.

- **Weapons** SHALL be the visually largest element of the preview, reflecting that a loadout is identified first by what it shoots with
- **Tools and consumables** SHALL occupy an **eight-cell grid laid out as two rows of four**, matching the equipment grid's cell count
- **Traits** SHALL be rendered as a grid of **fifteen cells** — the per-hunter maximum in *Hunt: Showdown*, and independent of the trait-point budget — so the grid's shape does not change as traits are added or removed.

  ~~Fifteen is a fact about the game, **not** an invariant this application enforces: the trait-point budget is off by default (`upBudgetOn: false`), the catalog holds 32 traits, and the server accepts up to 40, so a loadout holding more than fifteen is an ordinary savable record today.~~ **Amended 2026-08-11 (ADR-0012): fifteen is now an invariant this application enforces**, at the interactive add, at the server, and in every decoder — see "A Loadout Holds At Most Fifteen Traits". The struck sentence was true when written and its premise no longer holds.

  **The overflow behaviour survives the premise that motivated it, deliberately.** Where a loadout holds more traits than the grid has cells, the preview SHALL still fill the fifteen cells and SHALL state the remainder as a count, and the grid MUST NOT grow, scroll, or clip silently. That is now defence rather than a specified ordinary case: enforcement bounds what the app *writes*, and the preview renders what it *reads*. A record predating the cap, a decoder that regresses, or a payload arriving by some path not yet imagined all reach the preview, and a component that trusts an invariant it does not itself enforce is how a bad ammo index blanked the page in issue #201. The same reasoning kept `WeaponSlot` defensive after PR #203 bounded the value at decode

Preview imagery SHALL be sized so an item is identifiable at a glance, and that SHALL be pinned rather than left to judgement: at the widest supported viewport a weapon SHALL be drawn at **no less than 50% of its intrinsic asset width**, and each equipment or trait cell SHALL be **no less than 48 CSS px on its shorter edge**.

Those floors exist because the strip this replaces drew 512×128 weapon art at 34×24 — about 7% of the available width — while conforming to a requirement that said only "preview". An unassertable size rule is what let that ship.

**The equipment grid SHALL place each item at its stored cell.** Where the underlying model supplies a cell index, the preview SHALL honour it; where it supplies a packed sequence, the preview SHALL fill cells in that order. Empty cells SHALL be rendered as empty rather than collapsed away, so the grid keeps a constant shape. This is stated in terms of *cells occupied* rather than a particular array shape deliberately: SPEC-0006 changed `state.equip` from a packed array to a fixed sparse one, and a preview written against either representation alone would have needed rewriting when the other landed. That change has shipped, and this requirement needed no amendment — which was the point of phrasing it this way. Both shapes still reach the preview, because a v1 record decodes to a packed-then-padded array while a v2 record decodes positionally.

Preview imagery SHALL use SPEC-0001's asset-path convention and its fallback chain, and SHALL be lazy-loaded, so a list holding many loadouts fetches imagery proportional to what has been scrolled to rather than to the number of loadouts.

An item that no longer resolves in the catalog SHALL be omitted, consistent with the decoder already dropping unknown ids. The preview SHALL render whatever resolves rather than a broken tile, a placeholder per missing item, or an error. **An omitted item SHALL leave its cell empty rather than shifting later items forward**, so a stale reference never silently relocates the rest of the grid.

A loadout holding nothing SHALL be stated as empty rather than rendered as three empty grids.

Rendering a preview MUST NOT write to the record, MUST NOT alter `data`, and MUST NOT issue any request that mutates state.

**The shed-by-width rule is withdrawn.** It was written for a strip that degraded along one ordered list; a fixed-cell categorised grid has no such list, and dropping cells would change the shape the grid exists to hold constant. Responsiveness is instead the card's concern — see "Saved Loadouts Render as a Card Grid".

#### Scenario: The preview comes from the stored record

- **WHEN** a list containing saved loadouts is expanded
- **THEN** each loadout SHALL show a preview derived from that record's existing `data`, and no additional request SHALL be issued to fetch loadout contents

#### Scenario: The three categories are separately grouped

- **WHEN** a loadout holding weapons, tools, consumables and traits is previewed
- **THEN** weapons SHALL be rendered largest, tools and consumables SHALL occupy an eight-cell grid of two rows of four, and traits SHALL occupy a fifteen-cell grid

#### Scenario: The trait grid does not change shape with the trait budget

- **WHEN** two loadouts hold different numbers of traits, or the trait-point cap differs between them
- **THEN** both SHALL render fifteen trait cells, and the filled cells SHALL differ while the grid's shape does not

#### Scenario: Equipment sits in its own cell

*(live and satisfied as of 2026-08-13. SPEC-0006's sparse model shipped, so gaps are reachable and this scenario is falsifiable; `previewGroups` indexes `loadout.equip[slot]` for each of the eight cells, so a hole yields an empty cell in place. The annotation this replaces said gaps were unreachable "once SPEC-0006's sparse model lands", which stopped being true when it did.)*

- **WHEN** a loadout's stored equipment leaves gaps between items
- **THEN** each item SHALL be drawn in the cell it occupies and the gaps SHALL render as empty cells, rather than items being packed toward the start of the grid

#### Scenario: An unresolvable item leaves a hole

*(live and satisfied as of 2026-08-13. The v2 decoder maps positionally over eight cells and returns `null` in place for an id it cannot resolve — "leaves a hole; later cells must not shift" — so an unresolved entry now reaches the preview as an empty cell rather than being filtered out. The annotation this replaces described the v1 decoder's filter-then-pack, which is still correct for v1 records, where the packed array IS the cell order.)*

- **WHEN** a saved loadout references a catalog item that no longer exists
- **THEN** the preview SHALL render the items that do resolve, the unresolvable item's cell SHALL be empty, and no later item SHALL move into it

#### Scenario: An empty loadout says so

- **WHEN** a saved loadout holds no weapons, no equipment and no traits
- **THEN** the preview SHALL state that it is empty rather than rendering three empty grids

#### Scenario: Previewing writes nothing

- **WHEN** a list is expanded and its previews render
- **THEN** the server's data file SHALL be unchanged, and no write request SHALL have been issued

### Requirement: Saved Loadouts Render as a Card Grid

*(added 2026-08-10; not yet implemented)*

Saved loadouts SHALL be presented as a **grid of cards**, not as rows. A categorised preview does not fit a row, and stacking full-height rows down a page makes a list of ten unreadable.

Each card SHALL carry at least: the loadout's name, its cost, its preview, controls to move it between lists and to delete it, and — where one is rendered — its description and that description's edit control (see "Loadouts Carry a Description of Their Own"). The list is a floor, not an exhaustive enumeration. Every control that was reachable on the row SHALL remain reachable on the card — **the move affordance in particular SHALL remain an explicit, keyboard-operable control** rather than becoming drag-only, preserving the rule "Keyboard Navigation" already states.

**A loadout card MUST be visually distinguishable from a list card at a glance.** The list selector directly above is already a grid of cards, and two nested card grids in one panel invite the reader to mistake a loadout for a list. The distinction MUST NOT rest on size alone, since both grids reflow with the viewport. The list card's identity is a portrait, an accent frame and a loadout count; a loadout card SHALL NOT reuse that combination.

The card grid SHALL be responsive: cards SHALL reflow by count rather than being clipped, and no card SHALL overflow horizontally at any supported width. Where a preview cannot be drawn at full size, the **card** SHALL adapt by scaling cells down toward the 48 CSS px floor and, once that floor is reached, by growing taller rather than clipping. The preview's category structure and cell counts SHALL be preserved at every width; cells SHALL NOT be shed.

#### Scenario: Loadouts render as cards, not rows

- **WHEN** a list containing several saved loadouts is expanded
- **THEN** each loadout SHALL be rendered as a card in a grid, each carrying its name, cost, preview, move control and delete control

#### Scenario: Filing stays possible without a pointer

- **WHEN** a keyboard user moves a loadout to another list from its card
- **THEN** the move SHALL be achievable using an explicit control reachable in the tab order, and MUST NOT require a pointer gesture

#### Scenario: A loadout card is not mistakable for a list card

- **WHEN** an expanded list is rendered beneath the list selector
- **THEN** a loadout card SHALL NOT reuse the list card's combination of portrait, accent frame and loadout count

#### Scenario: Narrowing reflows rather than sheds

- **WHEN** the panel is rendered at a phone width
- **THEN** the cards SHALL reflow to fewer per row, no card SHALL overflow horizontally, and each preview SHALL retain its category structure and cell counts

### Requirement: Lists Carry an Editable Description

*(added 2026-08-10 as "Loadouts Carry an Editable Description"; **split in two and moved to the list 2026-08-11** — see #181. The field was placed on the loadout, which is not the record that references a hunter, so inherited lore repeated on every card filed into a list and a note about a specific build had nowhere of its own to live. The inherited half is here; the per-build half is "Loadouts Carry a Description of Their Own" below.)*

Each loadout list record MAY carry a `description` field on the record **envelope**, sibling to `name`, `hunterId` and `accent`.

The field SHALL distinguish three states, and consuming code MUST NOT collapse them into two:

| Stored value | Meaning | Rendered as |
|---|---|---|
| absent or null | never edited | the inherited default, resolved live |
| empty string | deliberately blank | nothing |
| non-empty string | the user's own text | that text |

**The default is resolved, not copied.** When `description` is null, the UI SHALL render the description of the hunter the list references, resolved through the hunters dataset at render time. The system MUST NOT write that text into the record in order to display it.

Two consequences follow, and both are intended:

- Changing the hunter on an **unedited** list SHALL re-inherit the new hunter's description. Changing the hunter on an **edited** list SHALL preserve the user's text unchanged
- A re-scrape that improves a hunter's description SHALL be reflected on every unedited list without touching a single stored record

A list with no hunter to inherit from — carrying no `hunterId`, or carrying one absent from the dataset — SHALL render no description and SHALL remain fully usable. Absence of a default is an ordinary state, not an error.

**The description SHALL render in the expanded list header** and MUST NOT be rendered on the list card in the selector grid *(placement settled 2026-08-11)*. The card is a compact scanning target carrying a portrait, a name and a count; a paragraph of lore on each one would swamp the grid it exists to let the user scan. The header is where the list's other editable properties already live.

Unassigned is a rendering of the loadouts filed nowhere rather than a record, so it SHALL carry no description and SHALL offer no control to write one.

**A rendered description SHALL be bounded in height**, with an affordance to reveal the rest. Hunter lore runs to several hundred characters, so an unclamped description would push the card grid below it off the screen. A description MUST NOT cause its container to overflow at any width.

**Inheritance SHALL be restorable.** A user who has edited a description SHALL be able to return the list to the inherited state; editing MUST NOT be a one-way door. Clearing the field to empty is *not* that path — empty means deliberately blank — so restoring inheritance SHALL be a distinct, explicitly offered action that sets the stored value back to null.

On the wire, the distinction between the three states SHALL be carried explicitly:

- A write supplying `description: null` SHALL reset the field to the inherited state
- A write supplying `description: ""` SHALL store the deliberately-blank state
- A write **omitting** the `description` key SHALL leave the field unchanged

**`null` means two different things on this endpoint and both SHALL be honoured.** `hunterId: null` is an absence — the list depicts nobody. `description: null` is a deferral — inherit from whoever it depicts. A request supplying both SHALL apply both.

Editing a description SHALL persist it under the same ownership rules as every other field on the record. The description SHALL be length-capped on the server with an explicit maximum. Editing a description MUST NOT alter the list's `name`, `hunterId`, `accent`, or which loadouts are filed into it.

#### Scenario: An unedited list shows its hunter's description

- **WHEN** a list whose hunter is "The Turncoat" has no stored description
- **THEN** the expanded list SHALL render The Turncoat's description from the hunters dataset, and the stored record SHALL still carry no `description` field

#### Scenario: Editing replaces the inherited text

- **WHEN** a user edits the description of a list that was showing an inherited default
- **THEN** the typed text SHALL persist on the record, and the inherited default SHALL NOT be shown again for that list

#### Scenario: Clearing a description leaves it blank rather than re-inheriting

- **WHEN** a user clears an edited description to empty
- **THEN** the record SHALL store an empty string, the list SHALL render no description, and the hunter's text MUST NOT reappear

#### Scenario: Changing the hunter on an unedited list re-inherits

- **WHEN** a list with no stored description has its `hunterId` changed from "The Turncoat" to "The Rat"
- **THEN** the list SHALL render The Rat's description

#### Scenario: Changing the hunter on an edited list preserves its text

- **WHEN** a list with a user-written description has its `hunterId` changed
- **THEN** its description SHALL be unchanged

#### Scenario: A list with no hunter to inherit from

- **WHEN** a list carries no `hunterId`
- **THEN** no description SHALL be rendered, and the list SHALL remain fully usable

#### Scenario: A hunter absent from the dataset yields no default

- **WHEN** a list's `hunterId` no longer appears in the dataset
- **THEN** no description SHALL be rendered, and neither the list nor its loadouts SHALL fail

#### Scenario: The description never appears on a list card

- **WHEN** a list carries a description of any kind
- **THEN** its card in the selector grid SHALL be unchanged — portrait, name and count only

#### Scenario: Inheritance can be restored after editing

- **WHEN** a user restores an edited list to the inherited state
- **THEN** the stored `description` SHALL be null again, and the list SHALL render its hunter's description as it did before the edit

#### Scenario: An omitted key is not a reset

- **WHEN** a write renames a list without supplying a `description` key
- **THEN** the stored `description` SHALL be unchanged, and MUST NOT be reset to the inherited state

#### Scenario: An over-long description is rejected

- **WHEN** a description exceeding the server's cap is submitted
- **THEN** the write SHALL be rejected with a client error and the stored record SHALL be unchanged

### Requirement: Loadouts Carry a Description of Their Own

*(added 2026-08-11 — see #181. The per-build half of the requirement above, separated from it because the two differ in the only way that matters: this one has no hunter to inherit from.)*

Each saved loadout record MAY carry a `description` field on the record **envelope**, sibling to `name`, `listId` and `updatedAt`. The `description` field MUST NOT be placed inside the loadout's `data` payload.

**Nothing is inherited into this field.** A loadout has no hunter of its own, and it SHALL NOT draw a default from the list it is filed into, from that list's hunter, or from its own contents. A loadout with no stored description SHALL render none, and the editor SHALL open on an empty field rather than seeding it with text the user did not write.

It follows that the field has two states rather than three: a non-empty string renders as that text, and absent, null or empty renders nothing. Both null and `""` SHALL be accepted on write and stored as given; neither SHALL be rewritten into the other, since records already carry both and they say the same thing.

Because there is no inherited state, no control to restore one SHALL be offered.

Filing SHALL NOT affect the description. Moving a loadout between lists, into Unassigned, or into a list whose `hunterId` is absent from the dataset SHALL leave its description exactly as it was.

**A rendered description SHALL be bounded in height**, with an affordance to reveal the rest, under the same rule as a list's. It MUST NOT cause its card to overflow at any width, and MUST NOT displace the preview's category structure *(re-scoped from row to card 2026-08-10 — see "Saved Loadouts Render as a Card Grid")*.

On the wire, the same key-presence discipline applies: `description: null` clears the field, `""` stores the empty state, and an omitted key leaves it unchanged. The same distinction SHALL apply to `listId` on the same endpoint, where an explicit null files the loadout into Unassigned and an omitted key leaves its filing untouched. A write supplying neither key SHALL be rejected, so that "move" and "describe" remain independent operations rather than mutually required ones.

Editing a description SHALL persist it under the same ownership rules as every other field on the record. The description SHALL be length-capped on the server with an explicit maximum. Editing a description MUST NOT alter `data`, the format version, `listId`, or the loadout's position in any list.

#### Scenario: A loadout inherits nothing from anywhere

- **WHEN** a loadout with no stored description is filed into a list whose hunter is "The Turncoat"
- **THEN** the loadout SHALL render no description, and The Turncoat's description SHALL appear only on the list

#### Scenario: A written note persists

- **WHEN** a user writes a description on a loadout
- **THEN** the typed text SHALL persist on the record and SHALL render on its card

#### Scenario: Moving a loadout preserves its description

- **WHEN** a loadout with a stored description is moved between lists
- **THEN** its description SHALL be unchanged, and no description SHALL be inherited at either end

#### Scenario: No restore control is offered

- **WHEN** a loadout carries a stored description
- **THEN** no control returning it to an inherited state SHALL be offered, in any stored state

#### Scenario: An omitted key is not a reset

- **WHEN** a write changes a loadout's `listId` without supplying a `description` key
- **THEN** the stored `description` SHALL be unchanged

#### Scenario: A write carrying neither field is rejected

- **WHEN** a write to a loadout supplies neither `listId` nor `description`
- **THEN** it SHALL be rejected with a client error and the stored record SHALL be unchanged

#### Scenario: An over-long description is rejected

- **WHEN** a description exceeding the server's cap is submitted
- **THEN** the write SHALL be rejected with a client error and the stored record SHALL be unchanged

### Requirement: The Saved-Loadout Wire Format Is Unchanged

This capability MUST NOT change the loadout wire format. **Nothing in this spec** SHALL raise the format version or modify the encode and decode functions *(scoped 2026-08-10)*. This constrains SPEC-0003 only — it is not a repo-wide freeze, and SPEC-0006 raising `FORMAT_VERSION` to 2 for cell position is outside it. What this requirement forbids is *this capability's* fields reaching the wire. The `listId` and `description` fields MUST NOT appear in any encoded loadout payload, share URL, or local draft.

`description` is subject to this requirement for exactly the reason `listId` is: it is a property of the user's filing, not of the loadout itself. A recipient opening a share URL receives the build, not the sender's notes about it *(clause added 2026-08-10)*.

**Both descriptions are filing state** *(amended 2026-08-11, when the single description requirement was split in two)*. Since the split there are two of them — the list's own description and the saved loadout's note — and neither reaches an encoded payload, a share URL, or a local draft. The reason is the same for both and is the reason it was for `listId`: a list description belongs to the shelf rather than to anything on it, and a loadout note is the filer's annotation rather than a property of the build. Neither is something a recipient asked for. Where this requirement says `description` unqualified, it binds **both** fields.

**The identity and naming state ADR-0022 introduces is client-only, and this requirement is why it costs no version bump** *(clause added 2026-08-13)*. Two pieces of state are involved, and neither reaches the wire: the `savedId` that records which stored record a loaded loadout came from, and the flag tracking whether the current name is still derived rather than typed. Both live in client state for the editing session only. They MUST NOT be persisted, sent to the server, or written into an encoded payload, share URL, or local draft.

This is what keeps the two new requirements free of a migration. A derived name is stored as an ordinary string — storage cannot tell it from a typed one, and REQ "New Lists Default Their Name from the Chosen Portrait" already establishes that same property for lists. A share URL recipient receives a build and a name, never the sender's provenance.

#### Scenario: Provenance and derived-name state never reach the wire

- **WHEN** a loadout carrying a `savedId` and a still-derived name is encoded to a share URL, written to a local draft, or sent to the server
- **THEN** neither the `savedId` nor the derived-name flag SHALL appear in the payload, and `FORMAT_VERSION` SHALL be unchanged

#### Scenario: Share URLs are unaffected

- **WHEN** a user shares a loadout that is filed into a list
- **THEN** the resulting share URL SHALL be byte-identical to the URL the same loadout would produce with no `listId`, at the same format version

#### Scenario: Neither description reaches a share URL

- **WHEN** a user shares a loadout that carries its own note and is filed into a list that itself has a description
- **THEN** the share URL SHALL be byte-identical to the one the same loadout produces with no description anywhere, and neither description SHALL appear in the encoded payload or the local draft

#### Scenario: Loading a shared loadout produces no list assignment

- **WHEN** a user opens a share URL produced by another user
- **THEN** the decoded loadout SHALL carry no list assignment, and saving it SHALL follow the recipient's own selected-list behavior

#### Scenario: Payload validation is unchanged

- **WHEN** the server validates an incoming loadout payload
- **THEN** the validation applied to the `data` object SHALL be unchanged **by this capability**, and no `listId` or `description` field SHALL be accepted inside `data`

*(clarified 2026-08-11.* That scenario says "by this capability" and still holds, but read alone it now misleads: the `data` validator **has** changed since, tightened from a required-fields check into an allowlist by issue #198. That change came from outside this capability and is specified in "A Write Stores Only What the Wire Format Defines" above. The two agree — an allowlist is the strongest possible form of "no `listId` or `description` inside `data`" — and this note exists so a future reader does not take the scenario as a freeze on the validator.*)

#### Scenario: A description never reaches the wire format

- **WHEN** a user shares a loadout that carries a description
- **THEN** the resulting share URL SHALL be byte-identical to the URL the same loadout would produce with no description, and the description SHALL NOT appear in it

### Requirement: The Selected List Is Client State

The currently selected list SHALL be held as client state and MAY be persisted to browser-local storage. It MUST NOT be persisted server-side, and MUST NOT be represented in the server's data file.

While a list is selected, a new save SHALL default to filing into that list. The user SHALL be able to save to Unassigned without first deselecting.

#### Scenario: Selection drives the default file destination

- **WHEN** a user selects a list and saves a new loadout without specifying a destination
- **THEN** the loadout SHALL be filed into the selected list

#### Scenario: Selection is not server state

- **WHEN** the server's data file is inspected after a user changes selection repeatedly
- **THEN** no field recording the selected list SHALL be present, and no write SHALL have occurred as a result of selection changes

#### Scenario: Two browser contexts hold independent selections

- **WHEN** the same user opens the application in two tabs and selects different lists
- **THEN** neither selection SHALL overwrite the other, because selection is not shared state

### Requirement: Error Handling Standards

All error-producing operations in this capability MUST follow structured error handling:

- Errors MUST be wrapped with contextual information at each layer boundary, naming the operation, the list or loadout involved, and the reason
- Sentinel errors MUST be defined for the domain-specific failure modes callers need to distinguish programmatically — at minimum: list not found, list not owned by caller, and portrait reference unknown
- Silent error swallowing MUST NOT occur — every error MUST be returned to the caller, logged with sufficient context, or explicitly handled with a documented reason for suppression
- Structured logging MUST be used for error reporting, using key-value pairs rather than string interpolation
- Failed list operations MUST surface to the user through the same visible message channel that save and delete failures already use, so a failure is at least as visible as a success

#### Scenario: An ownership rejection is distinguishable from a missing list

- **WHEN** a write is rejected because the referenced list belongs to another token
- **THEN** the failure SHALL be represented by a distinct sentinel error from the one used when no such list exists at all

#### Scenario: A list operation failure is visible to the user

- **WHEN** creating, renaming, or retiring a list fails
- **THEN** the failure SHALL be surfaced in the user-visible message channel with the operation and reason, and MUST NOT fail silently

### Requirement: Database Operation Standards

All data-file operations in this capability MUST follow structured data access patterns:

- Multi-step mutations that must not be observed partially MUST be applied as a single atomic write. Retiring a list is such a mutation: deleting the list record and clearing the `listId` of its loadouts SHALL be committed together
- A failed write MUST NOT leave the data file in a state where a list has been deleted but its loadouts still reference it, nor the reverse
- Read-modify-write sequences MUST be structured so that concurrent requests cannot interleave in a way that loses a write

#### Scenario: A partially applied retirement is not observable

- **WHEN** a retirement fails partway through
- **THEN** the persisted state SHALL either reflect the complete retirement or none of it, and SHALL NOT contain loadouts referencing a deleted list

#### Scenario: Concurrent writes do not lose data

- **WHEN** two requests from the same token mutate lists concurrently
- **THEN** both mutations SHALL be reflected in the persisted state, or the losing request SHALL fail visibly — one mutation MUST NOT be silently discarded

### Requirement: A Write Stores Only What the Wire Format Defines

*(added 2026-08-11, recording behaviour shipped for issue #198)*

Payload validation SHALL be an **allowlist**, not a required-fields check. The server SHALL reject any `data` object carrying a key the wire format does not define, and SHALL bound the named fields on both sides rather than only below.

- The set of accepted `data` keys SHALL be declared as a named constant and SHALL be exactly the keys the client encoder emits
- A tuple inside a known field SHALL be required to have its **exact** length — a floor alone (`>= 2`) is the same hole wearing the shape of a defined field. *(amended 2026-08-15 for wire format version 3, per SPEC-0009 and ADR-0023. The exact length is the one **the payload's own declared version** defines, not a single fixed count: a weapon slot is `[ref, ammo]` at v1 and v2 and `[ref, ammo, d]` at v3, so the validator dispatches on `data.v` and applies that version's count. This does not loosen the rule — "exact" still binds as tightly as before, and the floor is still forbidden; the version is what selects which exact length applies. An equipment entry is unchanged at v3.)*

  *(further amended 2026-08-16 for wire format version 4, per SPEC-0010, ADR-0014, and issue #348. Version 4 keeps the weapon slot's element count at three, unchanged from v3 — `[ref, ammo, d]` — but narrows what its `ammo` element may hold. At v1 through v3, `ammo` is a single integer index into a shared pool; at v4 it is a two-element array, each entry a bounded identifier string or `null`, naming a round directly rather than by position. "Exact length" therefore now binds at two levels for a v4 weapon slot: the entry itself is exactly three elements, and its `ammo` element, when present, is exactly two. This is a type narrowing of an already-defined field, not a widening of the allowlist — see SPEC-0010 REQ "The Weapon Entry Is Validated at Version 4's Shape", which owns the check's implementation in `server/src/routes/loadouts.js`'s `isIslandV4`/`isAmmoSlotArray`.)*
- A rejected payload SHALL be a `400`, and **nothing SHALL be persisted** under the attempted name
- Type checks on individual fields SHALL survive allowlisting — a key being permitted SHALL NOT be taken as evidence its value is well-shaped

This requirement governs the **stored** shape. It does not constrain what a future format version may define; a wire format that adds a key adds it to the allowlist in the same change. What it forbids is a caller inventing one.

#### Scenario: An undefined key is refused and nothing is written

- **WHEN** a write carries a `data` object containing a key outside the declared set
- **THEN** the response SHALL be a `400`, and no record SHALL exist under the attempted name afterwards

#### Scenario: A permitted key is still type-checked

- **WHEN** a write carries an allowlisted key whose value is of the wrong type
- **THEN** the response SHALL be a `400` — allowlisting the key SHALL NOT bypass its type check

#### Scenario: An over-long tuple inside a known field is refused

- **WHEN** a write carries a weapon slot or an equipment entry with more elements than the payload's declared version defines
- **THEN** the response SHALL be a `400`

*(**WHEN** amended 2026-08-15 for wire format version 3. It previously read "more elements than the format defines", which was written when a weapon slot was two elements at every version and so implied one count for all of them. Version 3 makes the weapon slot three, and the scenario is unchanged in force — an over-long entry is still a `400` — but "the format" is now read as the payload's own `v`. A three-element weapon slot is over-long at v1 and v2 and exactly right at v3; the scenario refuses it in the first case and not the second, which is the behaviour `isValidData` implements. See SPEC-0009 REQ "The Weapon Entry Is Validated at an Exact Element Count", which owns the count itself.)*

#### Scenario: A version-4 ammo element must be an id array, not an integer

*(added 2026-08-16 for wire format version 4, per SPEC-0010 and issue #348)*

- **WHEN** a write declares version 4 and carries a weapon slot whose `ammo` element is an integer, rather than a two-element array each entry of which is a bounded identifier string or `null`
- **THEN** the response SHALL be a `400`, and nothing SHALL be persisted — a type check on an allowlisted field is not bypassed by the field being permitted, per the type-checks clause of this requirement above

### Requirement: One Owner Cannot Accumulate Records Without Bound

*(added 2026-08-11, recording behaviour shipped for issue #198)*

The store SHALL cap the number of saved loadouts held under a single owner token, declared as a named constant. The cap SHALL apply to **creation only**: an owner at the ceiling SHALL still be able to edit, move, describe, and delete everything they already hold.

**The cap is a courtesy ceiling and SHALL be specified as one.** Owner tokens are caller-chosen and unlimited, so a caller willing to rotate one is bounded by the rate limits below rather than by this. What the cap addresses is a single client — or a loop with a bug in it — making the store expensive to re-serialise, given that the data file is parsed and rewritten whole on every operation.

Records belonging to an owner that is unreachable by construction — those minted per-request for a caller that sent no token, which are never disclosed to that caller — SHALL be reclaimable. A reclamation pass MAY apply a short retention window so that an operator debugging a write still finds the evidence, and SHALL treat a record whose timestamp is missing or unparseable as expired. It MUST NOT remove a record whose owner could still reach it.

#### Scenario: A create past the ceiling is refused

- **WHEN** an owner already holding the maximum number of saved loadouts creates another under a new name
- **THEN** the response SHALL be a `409` whose body names the limit

#### Scenario: An owner at the ceiling can still edit what they hold

- **WHEN** an owner at the maximum re-saves an existing loadout under its existing name
- **THEN** the write SHALL succeed — the ceiling SHALL NOT convert an update into a refused create

#### Scenario: The ceiling is per owner, not global

- **WHEN** one owner is at the maximum and a different token creates a loadout
- **THEN** that create SHALL succeed

#### Scenario: Reclamation spares anything an owner can still see

- **WHEN** a reclamation pass runs over records older than the retention window
- **THEN** it SHALL remove only records whose owner is unreachable by construction, and SHALL leave a token-owned record of the same age untouched

### Requirement: A Loadout Holds At Most Fifteen Traits

*(added 2026-08-11, per ADR-0012)*

Fifteen traits is the per-hunter maximum in *Hunt: Showdown*, and this application SHALL enforce it. The bound SHALL hold at **every path that writes a trait**, because a value bounded at one writer is not bounded — traits reach a loadout interactively, by decode, and by generation, and the stored record feeds decode on the next load.

- The interactive add SHALL refuse a sixteenth trait **unconditionally**. It MUST NOT be gated on the upgrade-point budget toggle: that toggle exists because the budget varies with hunter level, and fifteen varies with nothing
- The server SHALL reject a write carrying more than fifteen traits with a `400`, tightening the previous bound of forty. Per "A Write Stores Only What the Wire Format Defines", the bound is exact rather than a floor
- **Every** decoder SHALL bound a decoded trait list to the first fifteen surviving ids. A decoder that bounds and a decoder that does not are the same defect this spec already met once, in the ammo index (issue #201)
- Generation SHALL draw within the bound

**Decode SHALL clamp rather than refuse, and the reason is a property of this system rather than a preference.** A decoded loadout is persisted before it is rendered, so a decode path that throws on an over-cap list writes the unrenderable state and then fails on it — the shape of issue #201, where the damage outlived the link. Clamping keeps the record loadable and makes it self-correcting: an over-cap loadout decodes to fifteen and the next save writes fifteen back. Stored records are not re-validated on read, so the tightened server bound SHALL NOT strand a record written under the old one.

Clamping loses the traits past the fifteenth, and this is accepted rather than overlooked: the alternative is refusing a share link that previously worked, which is louder and leaves the user nothing.

#### Scenario: A sixteenth trait is refused with the budget toggle off

- **WHEN** a loadout already holding fifteen traits is given another, with the upgrade-point budget disabled
- **THEN** the trait SHALL NOT be added, and the refusal SHALL NOT depend on that toggle's state

#### Scenario: Every decoder clamps, not just the current one

- **WHEN** a payload carrying twenty valid trait ids is decoded by the current-format decoder, and separately by the legacy decoder
- **THEN** both SHALL yield exactly fifteen traits

#### Scenario: The server refuses a sixteenth

- **WHEN** a write carries sixteen valid trait ids
- **THEN** the response SHALL be a `400`, and a write carrying fifteen SHALL succeed

#### Scenario: An over-cap stored record heals rather than trapping

- **WHEN** a record written under the old bound and holding twenty traits is read, rendered, and re-saved
- **THEN** the read SHALL succeed, the loadout SHALL hold fifteen traits, and the save SHALL NOT be refused

#### Scenario: Generation stays within the bound

- **WHEN** a loadout is generated
- **THEN** it SHALL hold at most fifteen traits, asserted against the bound rather than against the generator's current draw count

### Requirement: A Scarce Pick Costs Nothing and Still Occupies Its Slot

*(added 2026-08-12, per ADR-0013)*

Scarce items are obtainable only from a match. They can be sold but never bought, so they have no purchase value, and a player who owns one can field it. This application SHALL let them be selected, and SHALL charge nothing for them.

A Scarce pick SHALL contribute `0` to the Hunt Dollar total and `0` to the upgrade-point total. It SHALL nonetheless consume every **physical** allowance it occupies: a Scarce weapon consumes its equipment slot and its full size against the weapon size budget, and a Scarce trait consumes one of the fifteen trait cells.

Cost and occupancy are therefore independent, and conflating them is the failure this requirement exists to prevent: a free weapon that also costs no size would let a loadout carry more than a hunter can hold, which is a stronger claim than "this item is free" and is wrong.

**Fifteen free traits is a legal loadout, and this is accepted rather than overlooked.** It is coherent with why the two ceilings differ, as "A Loadout Holds At Most Fifteen Traits" already records: the fifteen-trait cap is unconditional because nothing about fifteen varies with the hunter, while the upgrade-point budget is opt-in because it varies with a hunter level this application cannot know. A cost-free trait is bounded by the ceiling that does not vary and unbounded by the one that does. No change to the cap, its number, or its enforcement at any write path follows from this requirement — the cap already counts the right thing, because it counts cells rather than cost.

The zero SHALL be a stored cost on the catalog row, not a value derived at render time from a rarity flag. Deriving it would place a game rule in the read path and put the two budgets' arithmetic out of step with the catalog they read, and SPEC-0007 REQ "Budget-Affecting Attributes Are Stored, Never Inferred" forbids it.

#### Scenario: A Scarce trait consumes a cell and no points

- **WHEN** a Scarce trait is added to a loadout holding fourteen traits
- **THEN** the loadout SHALL hold fifteen traits, and the upgrade-point total SHALL be unchanged

#### Scenario: Fifteen Scarce traits is legal and free

- **WHEN** a loadout holds fifteen Scarce traits
- **THEN** the upgrade-point total SHALL be `0`, a sixteenth SHALL still be refused, and the loadout SHALL save successfully

#### Scenario: A Scarce weapon costs no money and full size

- **WHEN** a Scarce weapon of size 3 is selected
- **THEN** the Hunt Dollar total SHALL be unchanged, and the size budget SHALL be charged 3

#### Scenario: A Scarce weapon cannot exceed the size budget by being free

- **WHEN** Scarce weapons are selected whose combined size exceeds the weapon size budget
- **THEN** the selection SHALL be constrained exactly as it would be for purchasable weapons of the same sizes

#### Scenario: The opt-in budget is unaffected by free traits

- **WHEN** the upgrade-point budget is enabled and a loadout's traits are all Scarce
- **THEN** the budget SHALL report zero points spent, and SHALL NOT report the loadout as over budget

### Requirement: Forwarded Request Origin Is Believed Only From a Configured Peer

*(added 2026-08-11, per ADR-0011)*

The set of peers whose forwarding headers the system believes SHALL be deployment configuration defaulting to **none**, and every control that keys on a caller's address SHALL resolve it through that single decision. The rationale, the operator-facing consequences, and the reason this cannot be confirmed in CI are in "Deployment Trust Boundary" below.

#### Scenario: An undeclared deployment believes nothing

- **WHEN** a request arrives carrying forwarding headers at a deployment with no trusted peer configured
- **THEN** the headers SHALL NOT influence the address the rate limiters key on, nor the origin comparison

#### Scenario: Rotating a forwarded address buys no additional budget

- **WHEN** a client at a directly-exposed deployment issues writes varying the forwarded-address header on every request
- **THEN** all of them SHALL count against a single bucket keyed on the connecting socket

#### Scenario: A declared proxy still separates the clients behind it

- **WHEN** a deployment declares its front-facing proxy and two distinct clients arrive through it
- **THEN** each SHALL receive its own budget — the trust boundary MUST NOT collapse everyone behind a real proxy into one bucket

#### Scenario: An unresolvable value stops the process

- **WHEN** the deployment is configured with a value that cannot be resolved to a peer test, including one meaning "trust everything"
- **THEN** the process SHALL fail to start, and SHALL NOT run with either extreme substituted

### Requirement: Reads Carry a Budget of Their Own

*(added 2026-08-11, recording behaviour shipped for issue #198)*

Every collection `GET` in this capability SHALL be rate limited. The budget SHALL be per-IP only, SHALL be substantially more generous than the write floor, and SHALL NOT reuse it. The reasoning is in "Rate Limiting" below.

#### Scenario: A read budget exists and exceeds a write budget

- **WHEN** the advertised rate-limit policy on a collection read is compared with the policy on a write
- **THEN** the read budget SHALL be strictly the larger of the two

#### Scenario: A read carries neither write limiter

- **WHEN** the middleware stack on a collection read is inspected
- **THEN** it SHALL carry the read limiter and neither of the two write limiters

#### Scenario: The application's own startup reads are unaffected

- **WHEN** the client performs its normal complement of collection reads on load, repeatedly
- **THEN** no read SHALL be refused

## Security Requirements

This capability adds HTTP endpoints and is therefore subject to the following. Note the model honestly: **this API has no authentication.** The `x-loadout-token` header is a pseudonymous scope key, not a credential — it establishes *which* data a caller sees, not *who* the caller is.

### Endpoints

| Method | Path | Auth | Budget | Description |
|--------|------|------|--------|-------------|
| GET | /api/loadout-lists | Token-scoped | Read | List the caller's lists |
| POST | /api/loadout-lists | Token-scoped | Write | Create a list |
| PATCH | /api/loadout-lists/:id | Token-scoped | Write | Rename a list, change its portrait or accent, or edit its `description` |
| DELETE | /api/loadout-lists/:id | Token-scoped | Write | Retire a list |
| GET | /api/loadouts | Token-scoped | Read | List the caller's saved loadouts |
| POST | /api/loadouts | Token-scoped | Write | Save a loadout, optionally with an `id`, a `listId` and a `description`. `409` past the per-owner ceiling on **create**; `404` when an `id` names no record the caller owns |
| PATCH | /api/loadouts/:id | Token-scoped | Write | Move a loadout between lists, and/or edit its `description` |
| DELETE | /api/loadouts/:id | Token-scoped | Write | Delete a loadout |
| GET | /api/hunter-favorites | Token-scoped | Read | List the caller's favorite hunters |

*(table amended 2026-08-11: the collection reads this capability always had were previously unlisted, which is how they came to carry no budget at all — see "Rate Limiting". The `Budget` column names which limiter set applies, and `409` is recorded because a create can now be refused for a reason other than a malformed payload.)*

**No endpoint in this capability is public.** The one public endpoint in the application — the liveness probe at `/healthz` — is outside this capability's scope and is public because orchestrator health checks require unauthenticated access.

*(added 2026-08-10)* `POST /api/loadouts` SHALL accept an optional `description`, so that saving a loadout with one written up front is a single write rather than a save followed by a patch. `PATCH /api/loadouts/:id` SHALL accept `listId` and `description` independently rather than requiring `listId`. The length cap and the null-versus-omitted semantics apply identically on both verbs.

*(added 2026-08-11)* `POST /api/loadout-lists` and `PATCH /api/loadout-lists/:id` SHALL accept an optional `description` under the same cap and the same key-presence rules, as defined in "Lists Carry an Editable Description". On the list endpoints an explicit `description: null` means *inherit*; on the loadout endpoints it means *clear*. The two are different fields on different records, and the endpoints SHALL NOT be made to agree on a single meaning.

*(added 2026-08-13, per [ADR-0022](../../../adrs/ADR-0022-loadout-identity-and-derived-names.md))* `POST /api/loadouts` SHALL accept an optional `id`, naming the record the write is addressed to. When `id` is present the system SHALL resolve the target by `(id, owner)` **instead of** by the `(owner, listId, name)` triple, and the resolved record's `name` SHALL be updated to the submitted name. This is what lets a loaded loadout be renamed and still write back to itself, which the triple cannot express — REQ "Loadout Identity Is Scoped to Its List" requires that behaviour and this clause is the endpoint contract that delivers it.

**An `id` that names no record the caller owns SHALL be a `404`.** It MUST NOT fall back to the triple and MUST NOT create a record. Both fallbacks fail the same way and it is worth stating why: the client sends `id` only for a loadout it believes already exists, so an unresolvable one means the client's provenance is stale or forged. Creating a record would mint a silent duplicate; matching the triple instead would write the user's edits over a *different* loadout that merely shares a name. A `404` is the only answer that neither destroys nor duplicates.

**An id-addressed write SHALL NOT re-file the record.** *(clause added 2026-08-13, during the review of #314; the requirement above specified the `name` update and was silent on `listId`, and the silence resolved as a silent relocation.)* When `id` is present the system SHALL leave the resolved record's `listId` exactly as it is, and SHALL do so whatever `listId` the request carries — a list id, `null`, or nothing at all. `listId` is a **keying** argument on the triple path, and `resolveSaveListId` supplies one on every save the client makes whether or not the user meant anything by it; honouring it here would turn "save the loadout I loaded" into "move it into whichever list I have open", which is the unasked-for relocation REQ "Loadout Identity Is Scoped to Its List" exists to stop. Re-filing is `PATCH /api/loadouts/:id`, an explicit control the user operates deliberately.

A `listId` the caller does not own SHALL still be rejected on this path with the same `404` the triple path gives it. Not applying a value is not the same as not validating it: a caller naming a list it does not own is wrong about something, and a `200` would conceal that.

`id` is an addressing argument on the request, not a field of the loadout. It SHALL NOT be written into the stored record's `data`, and REQ "The Saved-Loadout Wire Format Is Unchanged" continues to bar it from every encoded payload, share URL, and local draft. `FORMAT_VERSION` is unaffected.

`PATCH /api/loadouts/:id` is deliberately **not** the vehicle for this. That endpoint's mutable pair is `listId` and `description`; it reaches nothing else about a record — not `data`, not the format version, not the name — and widening it would make every future "just one more field" argument easier. The save path already exists and already validates a full payload, so addressing it by id is the smaller change.

#### Scenario: A save addressed by id updates that record even after a rename

- **WHEN** a caller saves with an `id` naming one of its own records, under a name different from the one that record currently carries
- **THEN** that record SHALL be updated in place, its `name` SHALL become the submitted name, and no new record SHALL be created

#### Scenario: An unresolvable id is refused rather than resolved another way

- **WHEN** a caller saves with an `id` that names no record, or names a record owned by a different token
- **THEN** the response SHALL be a `404`, no record SHALL be created, and no other record SHALL be modified

#### Scenario: A save addressed by id does not move the record between lists

- **WHEN** a user loads a loadout filed in list A, selects list B, and saves — so the request carries both that record's `id` and list B's `listId`
- **THEN** the record SHALL be updated in place and SHALL remain filed in list A, and a request carrying `listId: null` SHALL likewise leave it in A rather than moving it to Unassigned

#### Scenario: An unowned list is still refused on the id path

- **WHEN** a caller saves with an `id` naming one of its own records and a `listId` naming a list it does not own
- **THEN** the response SHALL be a `404` naming the list, even though a valid `listId` would not have been applied

**"Token-scoped" is the honest designation and is REQUIRED on every endpoint in this capability.** No endpoint in this capability SHALL be public. The one public endpoint in the application — the liveness probe at `/healthz` — is outside this capability's scope and is public because orchestrator health checks require unauthenticated access.

### Authentication and Authorization

The system SHALL scope every list and loadout to the caller's token, and SHALL treat a token as a bearer-equivalent scope key: anyone possessing it can read and mutate that scope. The specification makes no claim that a token authenticates a person.

The system SHALL generate tokens with sufficient entropy that they are not guessable, and SHALL NOT accept tokens that are not token-shaped, per the existing normalization rules.

Authorization for this capability SHALL include the cross-collection check defined in "Cross-Collection Ownership Enforcement": possession of a token SHALL NOT permit filing into a list owned by a different token.

### Deployment Trust Boundary

*(added 2026-08-11, per ADR-0011)*

Every requirement in this section that speaks of a caller's IP address depends on a prior question the application cannot answer from its own source: **which peers is this server willing to believe when they tell it who a request came from?** That is a property of the deployment topology, and this spec records it because the rate limits below are not satisfiable without it.

The system SHALL treat the set of trusted forwarding peers as **deployment configuration**, and SHALL default to trusting none. A deploy that says nothing about its topology SHALL believe no `X-Forwarded-*` header, because the topology most likely to omit the setting is the directly-exposed one, where believing the header is precisely the defect.

- Configuration SHALL accept a form that identifies the proxy by **address** — a named range, an address, a CIDR, or a list — because that compiles to a check on the peer that actually connected
- A value that cannot be resolved SHALL stop the process at startup with a named error. The system MUST NOT downgrade an unresolvable value to either extreme
- The system MUST NOT provide a value meaning "trust every peer". The most guessable affirmative input SHALL be refused at startup rather than resolved to the most permissive setting
- The trust decision SHALL be made **once** and consumed by every dependent control. There MUST NOT be a second, independently maintained notion of which peers to believe

**This setting also governs the protocol half of the same-origin check** and is therefore load-bearing in two directions at once. A deployment behind a proxy that terminates TLS and does not declare it will fail the origin comparison on every state-changing request while continuing to serve reads. Operator documentation SHALL state this consequence and the ordering it implies.

**Confirmation is out of CI's reach, by construction** — the value lives in the platform's environment rather than the repository. This is stated as a known limit rather than a gap to close: the check is a manual one against a deployed instance.

The testable form of this rule is the requirement **"Forwarded Request Origin Is Believed Only From a Configured Peer"** above, which carries its scenarios.

### Rate Limiting

All write endpoints (`POST`, `PATCH`, `DELETE`) SHALL be rate limited by the same stacked per-IP and per-token limiters already applied to loadout writes. The per-IP limiter SHALL remain a hard floor so that rotating a client-controlled token cannot bypass limiting entirely.

**Reads SHALL carry a budget of their own** *(added 2026-08-11, recording behaviour shipped for issue #198)*. Every collection `GET` parses the whole data file, so an unbounded read path is an unbounded amount of parsing per second, and it grows more expensive as the file does. The read budget:

- SHALL be **per-IP only**. A read costs the same parse whoever asks for it, so the thing worth bounding is requests per source, not fairness between tokens sharing one
- SHALL be **substantially more generous than the write floor**, and SHALL NOT reuse it. The intent is to bound parse cost, not to bound the user — the application issues several collection reads on load, and a person reloading repeatedly SHALL NOT approach the limit
- SHALL NOT apply either write limiter to a read

Both budgets are keyed on the caller's address as resolved through the trust boundary above, and are only as strong as that boundary is correctly configured.

The testable form of the read budget is the requirement **"Reads Carry a Budget of Their Own"** above, which carries its scenarios.

### Security Headers

Responses SHALL set `X-Content-Type-Options: nosniff`. The application SHALL set a Content-Security-Policy appropriate to a self-hosted static client; because portraits are served from the application's own origin, the policy MUST NOT require relaxing `img-src` to permit the wiki.

### Request Body Size Limits

The JSON body parser SHALL enforce an explicit maximum request body size rather than relying on an implicit default. List names SHALL be length-capped on the server, and `hunterId` SHALL be length-capped and validated against the known library.

List and loadout descriptions SHALL be length-capped on the server with an explicit maximum, declared as a named constant beside the existing name cap *(added 2026-08-10; extended to lists 2026-08-11)*. One constant SHALL govern both records: they carry the same kind of text under the same wire discipline, and two constants would be two places for the limit to drift. The cap SHALL be **at least 1000 characters**, which leaves room above the longest description the dataset currently carries (404 characters, "The Night Seer"). That floor is justified by the **list** description specifically — it is the only one seeded from the dataset, so it is the only one a user starts editing from the hunter's own text, and a cap that truncated it would reject the default the app itself offered.

The cap governs **stored** text only. A description resolved live from the dataset is never written to the record and is therefore not subject to it, so a future scrape producing longer prose cannot retroactively invalidate stored records or fail a read.

Both a user-supplied description and a description resolved from the hunters dataset MUST be treated as untrusted on output and MUST NOT be inserted as markup. The scraped text is the *less* trustworthy of the two — it originates off-origin — so a rule scoped only to user input would miss the larger risk.

### CSRF Protection

Because the API requires a custom request header, browsers SHALL preflight cross-origin requests, and the existing origin allow-list SHALL reject disallowed origins. The system MUST NOT accept authenticated-by-cookie requests for these endpoints, as that would remove the custom-header protection.

### Redirect Validation

This capability introduces no redirects. Should any be added, the target MUST be validated against an allow-list of application-relative paths, and user-supplied absolute URLs MUST NOT be used as redirect targets.

## Accessibility Requirements

This capability introduces user-facing UI. The following are MANDATORY per WCAG 2.1 AA.

### WCAG 2.1 AA Compliance

All UI produced by this capability MUST meet WCAG 2.1 Level AA conformance as the minimum accessibility target.

### ARIA Landmarks

Page structure elements MUST include ARIA landmark roles: `role="banner"` on the site header, `role="navigation"` on navigation regions including the list selector if presented as navigation, `role="main"` on the primary content area, and `role="contentinfo"` on the site footer.

### Icon-Only Controls

All icon-only controls MUST include an `aria-label` describing their purpose. This applies specifically to the retire control, which MUST NOT rely on a bare "✕" glyph — its accessible name MUST identify both the action and the list, for example "Retire list: shotgun experiments".

Portrait images used as list identifiers MUST have accessible names. A portrait that is purely decorative alongside a visible list name SHOULD be marked `alt=""` so screen readers announce the name once rather than twice.

### Loadout Previews Are Supplementary, Not the Card's Identity

*(added 2026-08-10; re-scoped from row to card the same day, when the preview became a categorised panel)*

The loadout's name remains the accessible identity of its card. A preview MUST NOT turn one card into three grids of separately announced images — twenty-three equipment and trait cells plus two weapons is not a navigable substitute for a name.

Preview imagery MUST be marked decorative, and the preview as a whole MUST carry a **single** text equivalent summarising what the loadout holds — for example "Sparks LRR, Caldwell Conversion, 3 tools, 2 consumables, 4 traits". A screen-reader user MUST be able to reach the next card without traversing every previewed cell, and **empty cells MUST NOT be announced at all**: a fifteen-cell trait grid holding four traits must not read as eleven blanks.

The text equivalent MUST describe everything the loadout holds that resolves in the catalog. Because the categorised preview no longer sheds content by width, that text is now the same at every viewport by construction rather than by rule — but it MUST still describe contents rather than what is drawn, so an unresolvable item is excluded from both.

### The Favorites Section Is Exposed, Not Merely Drawn

*(added 2026-08-10)*

The split between favorited and unfavorited hunters MUST be conveyed to assistive technology, not only visually. Each section MUST carry an accessible name identifying it and its count, so a screen-reader user knows which group they are in and how large it is.

Sectioning MUST NOT break the picker's existing composite-widget semantics: arrow-key navigation MUST continue to move between tiles across a section boundary, and the roving tabindex MUST still present the grid as a single tab stop rather than one per section.

### Dynamic Content Regions

Content updated without a page load — the saved-loadouts region after a save, move, or retirement, and the message banner — MUST use `aria-live` regions. Routine confirmations SHALL use `aria-live="polite"`. Failures SHALL use `aria-live="assertive"`.

### Keyboard Navigation

All interactive elements MUST be operable via keyboard: logical tab order following visual layout, Enter or Space to activate controls, Escape to dismiss the portrait picker and the retire confirmation, and arrow keys for navigation within the portrait picker if it is presented as a composite grid widget.

Filing a loadout into a list MUST be achievable without a pointer. The initial move affordance SHALL be an explicit control on the loadout card — a menu or select — rather than drag-and-drop *(re-scoped from row to card 2026-08-10)*. Drag-and-drop is deferred as a future enhancement; if it is later added, the explicit keyboard-operable control MUST remain rather than being replaced by it.

Reordering loadouts WITHIN a list *(added 2026-08-17, per "Loadouts Within a List Have a User-Chosen Order")* is a different affordance from the filing move above and is NOT covered by its drag-and-drop deferral — there is no discrete destination a menu or select can name for "one position earlier than this card." This capability's drag-and-drop MUST ship with a full keyboard equivalent from the start, never as a pointer-only enhancement added later: pick up a card via the keyboard, move it with the arrow keys, confirm the drop, and cancel with Escape, restoring the original position. Each of those four actions MUST be available without a pointer, and the resulting order MUST be identical regardless of which input method performed the move. The move MUST be announced on an `aria-live="polite"` region under "Dynamic Content Regions" below.

Editing a description MUST be achievable without a pointer *(added 2026-08-10; applied to both descriptions 2026-08-11)*. The edit control MUST have an accessible name identifying both the action and its subject — the list or the loadout — MUST be reachable in the tab order of the thing it describes, and MUST support Escape to abandon an in-progress edit without saving. Because a description may be long, the editor MUST NOT trap Tab as a text-insertion key — a keyboard user must be able to leave the field.

Because a list's description sits in the expanded list header, it MUST fall in that header's tab order alongside rename and accent, rather than after the loadout cards below it *(added 2026-08-11)*.

An inherited description MUST NOT be announced as though the user wrote it. It SHALL also be marked visually — rendered in italic and in a de-emphasised tone, where a written description is neither *(settled 2026-08-11; the spec previously left the visual half open)*. Because that marking is presentational, it MUST NOT be the only carrier of the distinction: the non-visual announcement remains REQUIRED rather than an alternative to it, and both MUST be driven from the same resolved state so they cannot disagree.

The de-emphasised tone SHALL meet the WCAG 2.1 AA text-contrast ratio this spec already mandates, on every surface the description renders on. "Greyed" licenses lower emphasis, not lower contrast.

### Focus Management

The portrait picker and the retire confirmation MUST implement focus management: focus MUST be trapped within the dialog while open, MUST move to the dialog's first focusable element on open, and MUST return to the triggering element on close.

After a list is retired, focus MUST move to a stable, predictable element rather than being lost to the document body.
