---
status: approved
date: 2026-08-10
implements: [ADR-0006]
requires: [SPEC-0001, SPEC-0004]
---

# SPEC-0003: Hunter Loadout Lists

## Overview

Saved loadouts currently render as one flat, undifferentiated column. This capability introduces **lists**: user-named groups, each illustrated with a hunter portrait, that saved loadouts are filed into. A loadout filed nowhere belongs to a permanent **Unassigned** group.

**A list is a playlist.** That analogy governs every requirement below and is the fastest way to resolve an ambiguity in reading this spec. A playlist has a name you choose and cover art you pick; two playlists may wear the same cover; a track may sit in a playlist or in none; deleting a playlist deletes the playlist, not the tracks. Nothing about in-game hunter mechanics is modeled — no permadeath, carried traits, or recruitment cost. A list is a container with a face.

The defining property, per ADR-0006, is that **list identity and list imagery are independent**. A list's identity is a user-owned UUID with a free-text name; its portrait is a non-unique reference into a scraped portrait library. Many lists MAY share one portrait, and the size of the portrait library MUST NOT bound how many lists a user can create.

Portrait assets are self-hosted scraped images and therefore inherit the sourcing, fallback, and attribution rules of SPEC-0001 (Equipment Iconography).

See ADR-0006 for the decision record and the rejected alternatives.

**Implementation status.** The capability as originally specified is **implemented**, following the sequencing ADR-0006 sets out: the `loadoutLists` collection and its endpoints, `listId` filing on the loadout envelope, cross-collection ownership enforcement, retirement without cascade, the empty-list state, the unchanged wire format, the client-state selection cursor, the grouped roster UI, the hunter portrait picker with its filters and favorites (#88, #114), accent assignment and editing against `--list-accent-{1..6}`, portrait rendering against SPEC-0004's dataset (#110), and all four sort orders including hunter name (#109, #120).

Three **additive** changes were accepted on **2026-08-10** and are **not yet implemented**. Each is marked where it appears. (A fourth change of that date — dropping most-recently-used ordering — was a removal and is recorded in "List Ordering and Sorting".)

- **Favorites are sectioned rather than interleaved**, and default to favorites-only past a threshold — amends "Favorite Hunters" and one sentence of "The Hunter Picker Is Filterable and Bounded"
- **Loadout rows preview what they hold** — new requirement, "Filed Loadouts Preview Their Contents"
- **Loadouts carry an editable description** — new requirement, "Loadouts Carry an Editable Description", plus a new clause on "The Saved-Loadout Wire Format Is Unchanged"

A fourth change reached this spec from outside it, also on 2026-08-10: the **ADR-0007 amendment replacing two portrait sizes with one trimmed asset**. It rewrites part of "Hunter Dataset Consumption Contract" — the size-selection rule, the cross-size fallback ordering, and the assumption of a uniform portrait aspect — and is likewise not yet implemented. SPEC-0004 owns the production half; the consumption half is amended here rather than overridden from there.

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

The dataset SHALL provide, for each hunter, a stable identifier, a display name, a description, and a portrait asset self-hosted under the application's own origin *(description added 2026-08-10, consumed by "Loadouts Carry an Editable Description")*.

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

- **WHEN** a loadout inherits its description from a hunter whose dataset entry has an absent or empty description
- **THEN** no description SHALL be rendered, and neither the loadout nor the list SHALL fail

### Requirement: Lists Are Visually Distinguishable Independent of Portrait and Name

Because two lists MAY share a hunter, a list SHALL carry a distinguishing visual attribute that depends on neither its name nor its portrait. An accent colour SHALL be assigned at creation and SHALL be user-editable.

The accent SHALL be drawn from the fixed six-value palette defined in design.md and exposed as CSS custom properties in `client/src/styles/global.css`. Ad-hoc colour values MUST NOT be used. Every palette value SHALL meet WCAG 2.1 SC 1.4.11 (3:1 non-text contrast) against the panel, card, and page backgrounds.

Assignment on creation SHALL select the least-used palette value among the owner's existing lists. Distinct lists SHOULD therefore receive distinct accent colours while any remain unused. The system MUST NOT reject or prevent a duplicate accent colour.

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

Filtering SHALL narrow which hunters are shown. Apart from the favorites sectioning that "Favorite Hunters" requires *(carve-out added 2026-08-10; not yet implemented)*, it MUST NOT reorder or hide hunters for any other reason. In particular, this requirement does not reintroduce the in-use marking that "The Hunter Picker Does Not Restrict or Mark Reuse" forbids — a hunter already used by another list is shown exactly like any other hunter that matches the filter, in whichever section it belongs to.

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

The five sectioning rules below were **amended 2026-08-10 and are not yet implemented** — they replace an inline sort in which favorites simply sorted ahead of unfavorited hunters within one undivided grid:

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

*(added 2026-08-10; not yet implemented)*

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

### Requirement: Filed Loadouts Preview Their Contents

*(added 2026-08-10; not yet implemented)*

A loadout row currently shows a name and a cost. Neither tells the user what the loadout actually holds, so choosing among a list's loadouts means loading each one in turn and undoing the ones that were wrong.

Each loadout row SHALL present a preview of what that loadout holds. The preview SHALL be derived from the record's existing `data` payload, and SHALL require **no additional request for loadout data** and no change to the stored record. Fetching the imagery that depicts it is not such a request.

The preview SHALL cover the loadout's weapons and its equipment. Whether it also depicts traits is left open, since traits are textual rather than iconographic and may summarise better as a count. Preview imagery SHALL use SPEC-0001's asset-path convention and its fallback chain, and SHALL be lazy-loaded, so a list holding many loadouts fetches imagery proportional to what has been scrolled to rather than to the number of rows.

**The preview SHALL be responsive, and narrowing the viewport MUST NOT cause the row to overflow horizontally or clip any control.** As available width decreases the preview SHALL shed content in this order — **equipment before weapons, and within each, later slots before earlier ones** — and SHALL summarise whatever it dropped as a count. Weapons SHALL be the last preview content to shed. The loadout's name, its cost, and its move control SHALL survive every width; the preview is the part that yields.

An item that no longer resolves in the catalog SHALL be omitted from the preview, consistent with the decoder already dropping unknown ids. The preview SHALL render whatever resolves rather than a broken tile, a placeholder per missing item, or an error.

A loadout holding nothing SHALL be stated as empty rather than rendered as an empty strip.

Rendering a preview MUST NOT write to the record, MUST NOT alter `data`, and MUST NOT issue any request that mutates state.

#### Scenario: The preview comes from the stored record

- **WHEN** a list containing saved loadouts is expanded
- **THEN** each row SHALL show a preview derived from that record's existing `data`, and no additional request SHALL be issued to fetch loadout contents

#### Scenario: An unresolvable item is omitted, not broken

- **WHEN** a saved loadout references a catalog item that no longer exists
- **THEN** the preview SHALL render the items that do resolve and SHALL omit the one that does not, without rendering a broken image or failing the row

#### Scenario: A narrow viewport sheds preview content

- **WHEN** the panel is rendered at a phone width
- **THEN** the row SHALL NOT overflow horizontally, the name, cost and move control SHALL remain present and operable, and the preview SHALL shed equipment before weapons with the remainder summarised as a count

#### Scenario: An empty loadout says so

- **WHEN** a saved loadout holds no weapons and no equipment
- **THEN** the row SHALL state that it is empty rather than rendering an empty preview area

#### Scenario: Previewing writes nothing

- **WHEN** a list is expanded and its previews render
- **THEN** the server's data file SHALL be unchanged, and no write request SHALL have been issued

### Requirement: Loadouts Carry an Editable Description

*(added 2026-08-10; not yet implemented)*

Each saved loadout record MAY carry a `description` field on the record **envelope**, sibling to `name`, `listId` and `updatedAt`. The `description` field MUST NOT be placed inside the loadout's `data` payload.

The field SHALL distinguish three states, and consuming code MUST NOT collapse them into two:

| Stored value | Meaning | Rendered as |
|---|---|---|
| absent or null | never edited | the inherited default, resolved live |
| empty string | deliberately blank | nothing |
| non-empty string | the user's own text | that text |

**The default is resolved, not copied.** When `description` is null, the UI SHALL render the description of the hunter referenced by the list the loadout is filed into, resolved through the hunters dataset at render time. The system MUST NOT write that text into the record in order to display it.

Two consequences follow, and both are intended:

- Moving an **unedited** loadout to a list with a different hunter SHALL re-inherit that list's hunter description. Moving an **edited** loadout SHALL preserve the user's text unchanged
- A re-scrape that improves a hunter's description SHALL be reflected on every unedited loadout without touching a single stored record

A loadout with no hunter to inherit from — filed into Unassigned, filed into a list carrying no `hunterId`, or filed into a list whose `hunterId` is absent from the dataset — SHALL render no description and SHALL remain fully usable. Absence of a default is an ordinary state, not an error.

**A rendered description SHALL be bounded in height**, with an affordance to reveal the rest. Hunter lore runs to several hundred characters and shares a row with the preview, so an unclamped description would dominate the row it is meant to annotate and would defeat the overflow guarantee "Filed Loadouts Preview Their Contents" makes. A description MUST NOT cause the row to overflow at any width.

**Inheritance SHALL be restorable.** A user who has edited a description SHALL be able to return the loadout to the inherited state; editing MUST NOT be a one-way door. Clearing the field to empty is *not* that path — empty means deliberately blank — so restoring inheritance SHALL be a distinct, explicitly offered action that sets the stored value back to null.

On the wire, the distinction between the three states SHALL be carried explicitly:

- A write supplying `description: null` SHALL reset the field to the inherited state
- A write supplying `description: ""` SHALL store the deliberately-blank state
- A write **omitting** the `description` key SHALL leave the field unchanged

The same distinction SHALL apply to `listId` on the same endpoint, where an explicit null files the loadout into Unassigned and an omitted key leaves its filing untouched. A write supplying neither key SHALL be rejected, so that "move" and "describe" remain independent operations rather than mutually required ones.

Editing a description SHALL persist it under the same ownership rules as every other field on the record. The description SHALL be length-capped on the server with an explicit maximum. Editing a description MUST NOT alter `data`, the format version, `listId`, or the loadout's position in any list.

#### Scenario: An unedited loadout shows its list's hunter description

- **WHEN** a loadout with no stored description is filed into a list whose hunter is "The Turncoat"
- **THEN** the loadout SHALL render The Turncoat's description from the hunters dataset, and the stored record SHALL still carry no `description` field

#### Scenario: Editing replaces the inherited text

- **WHEN** a user edits the description of a loadout that was showing an inherited default
- **THEN** the typed text SHALL persist on the record, and the inherited default SHALL NOT be shown again for that loadout

#### Scenario: Clearing a description leaves it blank rather than re-inheriting

- **WHEN** a user clears an edited description to empty
- **THEN** the record SHALL store an empty string, the loadout SHALL render no description, and the hunter's text MUST NOT reappear

#### Scenario: Moving an unedited loadout re-inherits

- **WHEN** a loadout with no stored description is moved from a list whose hunter is "The Turncoat" to one whose hunter is "The Rat"
- **THEN** the loadout SHALL render The Rat's description

#### Scenario: Moving an edited loadout preserves its text

- **WHEN** a loadout with a user-written description is moved between lists
- **THEN** its description SHALL be unchanged

#### Scenario: A loadout with no hunter to inherit from

- **WHEN** a loadout with no stored description sits in Unassigned, or in a list with no portrait
- **THEN** no description SHALL be rendered, and the row SHALL remain fully usable

#### Scenario: A hunter absent from the dataset yields no default

- **WHEN** a loadout with no stored description is filed into a list whose `hunterId` no longer appears in the dataset
- **THEN** no description SHALL be rendered, and neither the loadout nor the list SHALL fail

#### Scenario: Inheritance can be restored after editing

- **WHEN** a user restores an edited loadout to the inherited state
- **THEN** the stored `description` SHALL be null again, and the loadout SHALL render its list hunter's description as it did before the edit

#### Scenario: An omitted key is not a reset

- **WHEN** a write changes a loadout's `listId` without supplying a `description` key
- **THEN** the stored `description` SHALL be unchanged, and MUST NOT be reset to the inherited state

#### Scenario: A write carrying neither field is rejected

- **WHEN** a write to a loadout supplies neither `listId` nor `description`
- **THEN** it SHALL be rejected with a client error and the stored record SHALL be unchanged

#### Scenario: An over-long description is rejected

- **WHEN** a description exceeding the server's cap is submitted
- **THEN** the write SHALL be rejected with a client error and the stored record SHALL be unchanged

### Requirement: The Saved-Loadout Wire Format Is Unchanged

This capability MUST NOT change the loadout wire format. The format version SHALL remain unchanged, and the encode and decode functions SHALL be unmodified. The `listId` and `description` fields MUST NOT appear in any encoded loadout payload, share URL, or local draft.

`description` is subject to this requirement for exactly the reason `listId` is: it is a property of the user's filing, not of the loadout itself. A recipient opening a share URL receives the build, not the sender's notes about it *(clause added 2026-08-10)*.

#### Scenario: Share URLs are unaffected

- **WHEN** a user shares a loadout that is filed into a list
- **THEN** the resulting share URL SHALL be byte-identical to the URL the same loadout would have produced before this capability existed

#### Scenario: Loading a shared loadout produces no list assignment

- **WHEN** a user opens a share URL produced by another user
- **THEN** the decoded loadout SHALL carry no list assignment, and saving it SHALL follow the recipient's own selected-list behavior

#### Scenario: Payload validation is unchanged

- **WHEN** the server validates an incoming loadout payload
- **THEN** the validation applied to the `data` object SHALL be identical to the validation applied before this capability existed

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

## Security Requirements

This capability adds HTTP endpoints and is therefore subject to the following. Note the model honestly: **this API has no authentication.** The `x-loadout-token` header is a pseudonymous scope key, not a credential — it establishes *which* data a caller sees, not *who* the caller is.

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/loadout-lists | Token-scoped | List the caller's lists |
| POST | /api/loadout-lists | Token-scoped | Create a list |
| PATCH | /api/loadout-lists/:id | Token-scoped | Rename a list or change its portrait |
| DELETE | /api/loadout-lists/:id | Token-scoped | Retire a list |
| POST | /api/loadouts | Token-scoped | Save a loadout, optionally with a `listId` and a `description` |
| PATCH | /api/loadouts/:id | Token-scoped | Move a loadout between lists, and/or edit its `description` |
| DELETE | /api/loadouts/:id | Token-scoped | Delete a loadout |

*(added 2026-08-10)* `POST` SHALL accept an optional `description`, so that saving a loadout with one written up front is a single write rather than a save followed by a patch. `PATCH /api/loadouts/:id` currently requires `listId` in the body; it SHALL accept `listId` and `description` independently. The length cap and the null-versus-omitted semantics defined in "Loadouts Carry an Editable Description" apply identically on both verbs.

**"Token-scoped" is the honest designation and is REQUIRED on every endpoint in this capability.** No endpoint in this capability SHALL be public. The one public endpoint in the application — the liveness probe at `/healthz` — is outside this capability's scope and is public because orchestrator health checks require unauthenticated access.

### Authentication and Authorization

The system SHALL scope every list and loadout to the caller's token, and SHALL treat a token as a bearer-equivalent scope key: anyone possessing it can read and mutate that scope. The specification makes no claim that a token authenticates a person.

The system SHALL generate tokens with sufficient entropy that they are not guessable, and SHALL NOT accept tokens that are not token-shaped, per the existing normalization rules.

Authorization for this capability SHALL include the cross-collection check defined in "Cross-Collection Ownership Enforcement": possession of a token SHALL NOT permit filing into a list owned by a different token.

### Rate Limiting

All write endpoints (`POST`, `PATCH`, `DELETE`) SHALL be rate limited by the same stacked per-IP and per-token limiters already applied to loadout writes. The per-IP limiter SHALL remain a hard floor so that rotating a client-controlled token cannot bypass limiting entirely.

### Security Headers

Responses SHALL set `X-Content-Type-Options: nosniff`. The application SHALL set a Content-Security-Policy appropriate to a self-hosted static client; because portraits are served from the application's own origin, the policy MUST NOT require relaxing `img-src` to permit the wiki.

### Request Body Size Limits

The JSON body parser SHALL enforce an explicit maximum request body size rather than relying on an implicit default. List names SHALL be length-capped on the server, and `hunterId` SHALL be length-capped and validated against the known library.

Loadout descriptions SHALL be length-capped on the server with an explicit maximum, declared as a named constant beside the existing name cap *(added 2026-08-10)*. The cap SHALL be **at least 1000 characters**, which leaves room above the longest description the dataset currently carries (404 characters, "The Night Seer") — the text a user most often starts from when they edit, so a cap that truncated it would reject the default the app itself offered.

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

### Loadout Previews Are Supplementary, Not the Row's Identity

*(added 2026-08-10)*

The loadout's name remains the accessible identity of its row. A preview MUST NOT turn one row into a dozen separately announced images.

Preview imagery MUST be marked decorative, and the preview as a whole MUST carry a **single** text equivalent summarising what the loadout holds — for example "Sparks LRR, Caldwell Conversion, 3 tools, 2 consumables". A screen-reader user MUST be able to reach the next row without traversing every previewed item.

Where the preview sheds content at narrow widths, the text equivalent MUST describe everything the loadout holds that resolves in the catalog, rather than the subset currently drawn, so what is announced does not change with viewport width.

### The Favorites Section Is Exposed, Not Merely Drawn

*(added 2026-08-10)*

The split between favorited and unfavorited hunters MUST be conveyed to assistive technology, not only visually. Each section MUST carry an accessible name identifying it and its count, so a screen-reader user knows which group they are in and how large it is.

Sectioning MUST NOT break the picker's existing composite-widget semantics: arrow-key navigation MUST continue to move between tiles across a section boundary, and the roving tabindex MUST still present the grid as a single tab stop rather than one per section.

### Dynamic Content Regions

Content updated without a page load — the saved-loadouts region after a save, move, or retirement, and the message banner — MUST use `aria-live` regions. Routine confirmations SHALL use `aria-live="polite"`. Failures SHALL use `aria-live="assertive"`.

### Keyboard Navigation

All interactive elements MUST be operable via keyboard: logical tab order following visual layout, Enter or Space to activate controls, Escape to dismiss the portrait picker and the retire confirmation, and arrow keys for navigation within the portrait picker if it is presented as a composite grid widget.

Filing a loadout into a list MUST be achievable without a pointer. The initial move affordance SHALL be an explicit control on the loadout row — a menu or select — rather than drag-and-drop. Drag-and-drop is deferred as a future enhancement; if it is later added, the explicit keyboard-operable control MUST remain rather than being replaced by it.

Editing a loadout's description MUST be achievable without a pointer *(added 2026-08-10)*. The edit control MUST have an accessible name identifying both the action and the loadout, MUST be reachable in the row's tab order, and MUST support Escape to abandon an in-progress edit without saving. Because a description may be long, the editor MUST NOT trap Tab as a text-insertion key — a keyboard user must be able to leave the field.

An inherited description MUST NOT be announced as though the user wrote it. Where the distinction is surfaced visually, it MUST also be available non-visually.

### Focus Management

The portrait picker and the retire confirmation MUST implement focus management: focus MUST be trapped within the dialog while open, MUST move to the dialog's first focusable element on open, and MUST return to the triggering element on close.

After a list is retired, focus MUST move to a stable, predictable element rather than being lost to the document body.
