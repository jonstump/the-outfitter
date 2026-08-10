---
status: approved
date: 2026-08-09
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

The dataset SHALL provide, for each hunter, a stable identifier, a display name, and portrait assets self-hosted under the application's own origin. Per ADR-0007 the portraits are supplied in two sizes — a thumbnail and a full size. Consuming code SHALL request the size appropriate to its context: the thumbnail for picker tiles and list-selector cards, the full size for an expanded list header. The application at runtime MUST NOT issue any request to the wiki in order to render a list.

When the size appropriate to a context is unavailable, consuming code SHALL fall back to the other size before falling back to the placeholder. A too-large image is a performance cost; an empty tile is a defect.

Consuming code MUST tolerate a dataset entry that lacks either or both portrait sizes, and MUST tolerate a `hunterId` that is absent from the dataset entirely, since the dataset and a user's stored lists refresh independently.

#### Scenario: Portraits are served from the application's own origin

- **WHEN** the application renders a list's portrait
- **THEN** the image SHALL be served from the application's own origin, and no request SHALL be issued to the wiki

#### Scenario: A portrait missing from disk falls back across sizes

- **WHEN** a context requests the thumbnail and only the full size exists, or requests the full size and only the thumbnail exists
- **THEN** the UI SHALL render the size that does exist rather than a placeholder

#### Scenario: Both portrait sizes missing falls back to a placeholder

- **WHEN** a list references a hunter for which neither portrait size is present
- **THEN** the UI SHALL fall back to a neutral placeholder using the same fallback mechanism SPEC-0001 defines for items, and SHALL NOT render a broken image

#### Scenario: A list survives its hunter leaving the dataset

- **WHEN** a list references a `hunterId` that no longer appears in the dataset
- **THEN** the list SHALL remain fully usable — selectable, renameable, and able to hold loadouts — rendering a neutral placeholder and its own name in place of the missing hunter

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
- **THEN** those hunters SHALL be presented identically to unused hunters, with no badge, dimming, reordering, or count

#### Scenario: A list can be created with no portrait

- **WHEN** a user chooses the "no portrait" option in the picker
- **THEN** a list SHALL be created with a null `hunterId`, rendering a monogram derived from its name

### Requirement: The Hunter Picker Is Filterable and Bounded

The roster is roughly 285 hunters. A flat grid of every portrait is not a usable picker and is not a defensible payload, so filtering is a functional requirement rather than a refinement.

The picker SHALL provide a free-text filter matching on hunter name. It SHALL provide filtering by the classification SPEC-0004 supplies — at minimum `acquisition` and `obtainable`.

The picker MUST NOT load every hunter's portrait eagerly. Images SHALL be loaded lazily, so the bytes fetched are proportional to what the user has actually scrolled to rather than to the size of the roster.

Filtering SHALL narrow which hunters are shown; it MUST NOT reorder or hide hunters for any other reason. In particular, this requirement does not reintroduce the in-use marking that "The Hunter Picker Does Not Restrict or Mark Reuse" forbids — a hunter already used by another list is shown exactly like any other hunter that matches the filter.

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
- **THEN** those hunters SHALL be presented identically to unused ones, with no badge, dimming, reordering, or count

#### Scenario: An empty result is stated

- **WHEN** a filter matches no hunters
- **THEN** the picker SHALL say that nothing matched rather than rendering an empty grid

### Requirement: List Ordering and Sorting

Lists SHALL be presented in alphabetical order by list display name by default. The system SHALL offer additional orderings, at minimum:

- alphabetical by the display name of the list's hunter, resolved through the hunters dataset
- creation date
- most recently used, where "used" means the list was last opened by the user
- number of loadouts held, descending, ties broken by list display name

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

### Requirement: The Saved-Loadout Wire Format Is Unchanged

This capability MUST NOT change the loadout wire format. The format version SHALL remain unchanged, and the encode and decode functions SHALL be unmodified. The `listId` field MUST NOT appear in any encoded loadout payload, share URL, or local draft.

#### Scenario: Share URLs are unaffected

- **WHEN** a user shares a loadout that is filed into a list
- **THEN** the resulting share URL SHALL be byte-identical to the URL the same loadout would have produced before this capability existed

#### Scenario: Loading a shared loadout produces no list assignment

- **WHEN** a user opens a share URL produced by another user
- **THEN** the decoded loadout SHALL carry no list assignment, and saving it SHALL follow the recipient's own selected-list behavior

#### Scenario: Payload validation is unchanged

- **WHEN** the server validates an incoming loadout payload
- **THEN** the validation applied to the `data` object SHALL be identical to the validation applied before this capability existed

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
| POST | /api/loadouts | Token-scoped | Save a loadout, optionally with a `listId` |
| PATCH | /api/loadouts/:id | Token-scoped | Move a loadout between lists |
| DELETE | /api/loadouts/:id | Token-scoped | Delete a loadout |

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

### Dynamic Content Regions

Content updated without a page load — the saved-loadouts region after a save, move, or retirement, and the message banner — MUST use `aria-live` regions. Routine confirmations SHALL use `aria-live="polite"`. Failures SHALL use `aria-live="assertive"`.

### Keyboard Navigation

All interactive elements MUST be operable via keyboard: logical tab order following visual layout, Enter or Space to activate controls, Escape to dismiss the portrait picker and the retire confirmation, and arrow keys for navigation within the portrait picker if it is presented as a composite grid widget.

Filing a loadout into a list MUST be achievable without a pointer. The initial move affordance SHALL be an explicit control on the loadout row — a menu or select — rather than drag-and-drop. Drag-and-drop is deferred as a future enhancement; if it is later added, the explicit keyboard-operable control MUST remain rather than being replaced by it.

### Focus Management

The portrait picker and the retire confirmation MUST implement focus management: focus MUST be trapped within the dialog while open, MUST move to the dialog's first focusable element on open, and MUST return to the triggering element on close.

After a list is retired, focus MUST move to a stable, predictable element rather than being lost to the document body.
