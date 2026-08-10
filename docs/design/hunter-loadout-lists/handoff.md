# Handoff: Hunter Loadout Lists UI (ADR-0006 / SPEC-0003)

> **Two deviations were applied when this handoff was integrated into SPEC-0003.
> Where this document and the spec disagree, the spec wins.**
>
> 1. **Accent palette.** `#c4a05e` was replaced with `#5a6e96` (slate). `#c4a05e` is
>    `--gold`, the theme's primary interactive colour, so a gold-framed card reads as
>    selected. The replacement clears 3:1 against all three backgrounds with the widest
>    hue separation of the candidates tested. Final palette:
>    `#b04a3e` `#7a8a4e` `#5a6e96` `#5e8a8a` `#8a5e86` `#a3703e`. The prototype's
>    `PALETTE` constant and the token list below were updated to match; every other
>    `#c4a05e` in the prototype is a legitimate `--gold` use (links, titles, cost).
> 2. **"Recently used"** is defined as *last opened*, resolving the open question this
>    document notes in § State Management.
>
> The "no in-use marker" product decision in § 5 was **accepted**, and SPEC-0003's
> picker requirement was amended to match.

## Overview
Replaces the flat `SavedLoadoutsPanel` in jonstump/the-outfitter with grouped loadout lists per ADR-0006 and SPEC-0003: a roster grid of portrait cards (one per list), expand-in-place to reveal that list's loadouts, inline create with a hunter-portrait picker, inline rename, retire confirmation, and five sort orders. Unassigned is a permanent group pinned first.

## About the Design Files
`loadout-lists-panel.html` (delivered as `Loadout Lists Panel.dc.html`) is a **design reference created in HTML** — an interactive prototype showing intended look and behavior, not production code. The task is to **recreate this design in the existing React + Redux client** (`client/src/`) using its established patterns: `global.css` variables/classes, `ItemThumb` for imagery fallback, existing slices/thunks, and the routes/spec work in `docs/openspec/specs/hunter-loadout-lists/`. The server model, endpoints, ownership rules, and error/a11y requirements are already specified there — this handoff covers the visual/UI layer only.

## Fidelity
**High-fidelity.** Colors, type, and spacing intentionally match the app's existing theme (`client/src/styles/global.css`). Recreate the UI using the existing CSS variables and class conventions rather than hardcoding hex values — every color below maps to a `global.css` token where one exists.

## Screens / Views

### 1. Panel header
- Extends the existing `.panel` (`--panel` #1a1510 bg, 1px `--border` #3a2f1e, 20px padding).
- Row (flex, baseline, wrap, 12px gap): panel title "Saved loadouts" (`.panel-title`: IM Fell English SC, 19px, letter-spacing 1.5px, `--gold` #c4a05e) · meta "N lists · M loadouts" (`.panel-meta`, flex:1) · sort `<select>` (app default select styling) · "+ New list" button (`.btn-outline` pattern).
- Below: message banner, `aria-live="polite"`, min-height 20px, olive #9aa06b italic 15px. Failures use `aria-live="assertive"` per spec.
- Note: no "Save current loadout" button here — saving stays in ActionsPanel; a save files into the currently open (selected) list.

### 2. Roster grid (collapsed lists)
- `display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:14px` — collapses to 2-up on phones naturally.
- **List card** (poster style, one per list): `<button>`, height 220px, `position:relative`, background #17130c (`--scroll-track`), **3px solid border in the list's accent color** — the accent frame is the list's distinguishing identity per spec.
  - Portrait area: full-bleed. Prototype uses a striped placeholder (`repeating-linear-gradient(45deg,#221b12 0 8px,#1a1510 8px 16px)`) + monospace 11px #857659 label "hunter portrait". In production render the hunter portrait via the `ItemThumb` extension pattern (`/images/hunters/{slug}.{ext}`, onError extension chain, SPEC-0001 fallback).
  - No-portrait list: solid #17130c with a large monogram (first letter of list name, IM Fell, 52px, #3a2f1e) — this is also the "hunter missing from dataset" degradation.
  - Bottom overlay plate: `linear-gradient(transparent, rgba(19,16,9,.95) 60%)`, padding 36px 12px 12px; list name (IM Fell, 19px, ls 1px, #f0e6c8, line-height 1.1) + count "N loadouts" (13px, `--text-muted` #a3936f, 3px top margin).
  - Portrait alt text: `alt=""` when the list name is visibly adjacent (spec: announce once).
- **Unassigned card**: pinned FIRST in the grid regardless of sort. Same poster shape but 3px **dashed** #3a2f1e border (neutral — never an accent), "∴" glyph centerpiece (IM Fell 44px #2a2216), name "Unassigned".
- **Names-only rollout phase** (deployment step 2, before portrait assets land): identical layout with monogram tiles in place of portraits. The prototype has a `namesOnlyPhase` toggle demonstrating it.

### 3. Expanded list (in place)
- Clicking a card expands it in place: the card becomes `grid-column: 1 / -1` at its sorted grid position; all other cards stay collapsed. Clicking Close (or the card again) collapses it. Expanding sets the list as the **selected list** (client state, `uiSlice` + `localStorage` — never server state).
- Header row (flex, 14px gap, padding 12px 14px, bottom border 1px `--divider` #241d12): 52×68 portrait thumb · name block · badge · Retire · Close.
  - Name: IM Fell 20px #f0e6c8, with an italic "rename" text button (13.5px #857659, hover `--gold-bright`). Renaming swaps in a text input (IM Fell 18px, gold border) — Enter/blur commits, Escape cancels.
  - Sub-line: "N loadouts · {hunter name}" (13.5px `--text-muted`); "no portrait" or "hunter missing from roster" when applicable.
  - Badge: "DEFAULT LIST FOR SAVED LOADOUTS" — 12.5px, ls 1px, 1px `--gold-border` #8a6f42 border, `--gold-bright` #e5c78b text, 4px 10px padding. Also shown on expanded Unassigned (with "not filed into any list" sub-copy).
  - Retire button: outline button, hover shifts to `--red-bright`/`--red-border`. Accessible name must be "Retire list: {name}" per spec.
- Body: column of loadout rows, 6px gap, 12px padding. Empty list: italic `--text-dim` note "No loadouts filed yet. Save one while this list is open."

### 4. Loadout row (thumb-strip style)
- Flex row, 12px gap, wrap; 1px `--border` border; **3px left border in the list's accent** (neutral #2a2216 in Unassigned); background #17130c; padding 10px 12px.
- Weapon thumb strip: up to 2 thumbs, 64×36, `--input-bg` #221b12 bg, 1px `--divider` border, 4px gap — use `ItemThumb` with the weapons category.
- Tool/consumable strip: one 28×28 thumb per tool/consumable (same treatment, 3px gap, wraps, max-width 200px) — `ItemThumb` again. No text count.
- Body (flex:1, min-width 180px): loadout name as a load button (16.5px #f0e6c8, hover `--gold-bright`; dispatches the existing `loadSavedThunk`) over weapon names meta (13px `--text-muted`, " · " separated).
- Right: cost "$742" (14.5px `--gold`) · Share button (`--input-bg` bg, 1px border, 13.5px, hover gold border).
- Loadouts referencing a deleted/unknown `listId` render in Unassigned (degrade, never error).

### 5. Create-list flow (inline in panel)
- "+ New list" opens an inline section between header and grid: 1px `--gold-border` frame, #17130c bg, 16px padding.
- Title "New list — choose a portrait" (IM Fell 17px `--gold-bright`).
- Hunter grid: `repeat(auto-fill,minmax(96px,1fr))`, 10px gap. Tile = button: 96px-tall portrait over name (13.5px), 2px border — #3a2f1e default, `--gold` #c4a05e when picked. Last tile is "No portrait" ("?" monogram, italic label). **No in-use marker** (product decision; reuse is unlimited and unmarked).
- Footer row: "NAME" label (13px ls 1px muted) · text input (placeholder "defaults to the hunter's name"; picking a hunter fills the input with the hunter's name unless the user already typed) · accent preview swatch (18×18, auto-assigned = least-used palette color) · "Create list" (`.btn-primary` red) · Cancel.
- On create: list gets UUID (server-side), chosen `hunterId` (nullable), defaulted name, assigned accent; it expands/selects immediately. Empty name + no hunter → "New list".

### 6. Retire confirmation (modal)
- Overlay `rgba(10,8,4,.7)`, centered dialog: `--panel` bg, 1px `--gold-border`, 22px padding, max-width 400px, `role="dialog" aria-modal="true"`.
- Title "Retire this list?" (IM Fell 20px). Body copy (required by spec to state the outcome): "“{name}” will be removed. Its N loadouts move to Unassigned, not deleted." (empty list: "It holds no loadouts — nothing else changes.")
- Buttons right-aligned: Cancel (outline) · "Retire list" (`.btn-primary`). Escape and backdrop click cancel. Trap focus; return focus to trigger on close; after retiring, move focus to a stable element (panel heading).

## Interactions & Behavior
- Expand/collapse: instant swap (no animation in prototype); expanding marks the list selected and bumps its `lastUsed`.
- Sort menu options and rules (SPEC-0003): List name (default, alphabetical) · Hunter name (lists without a resolvable hunter grouped AFTER all resolved, ordered by list name among themselves) · Creation date · Recently used · Loadouts held (desc, ties by name). Unassigned position is fixed and unaffected. Sort preference is client state only.
- Rename: inline, Enter/blur commit, Escape cancels, empty input = no-op. UUID and filed loadouts unchanged.
- Retire: atomic server-side (delete list row + null `listId` on its loadouts in one write). UI drops the card and grows Unassigned's count; polite confirmation message.
- Move-between-lists: NOT in this prototype (explicit control deferred per user scope; spec requires a keyboard-operable explicit control when built — not drag-and-drop).
- All actions surface success/failure in the message banner.

## State Management
- `loadoutListsSlice` (new): `lists: [{id, name, hunterId, accent, createdAt}]` from `GET /api/loadout-lists`; create/rename/retire thunks against the SPEC-0003 endpoints.
- `savedLoadoutsSlice`: records gain envelope `listId` (nullable); group client-side by `listId`, dangling → Unassigned.
- `uiSlice`: `selectedListId` (mirrors expanded card; persist to `localStorage`), `sortKey`, `creating`, `renamingId`, `confirmRetireId`. None of these are server state.
- `lastUsed` for the recently-used sort is client-observed (design.md leaves its exact meaning open — prototype uses "last expanded").

## Design Tokens
All from `client/src/styles/global.css` — use the variables:
- Backgrounds: `--bg` #131009, `--panel` #1a1510, `--scroll-track`/row bg #17130c, `--input-bg` #221b12
- Borders: `--border` #3a2f1e, `--border-soft` #2a2216, `--divider` #241d12, `--gold-border` #8a6f42
- Text: `--text` #e6d9ba, `--text-bright` #f0e6c8, `--text-muted` #a3936f, `--text-dim` #857659
- Accents: `--gold` #c4a05e, `--gold-bright` #e5c78b, `--red` #7f2b26, `--red-border` #a04338, `--red-bright` #c96b5b, `--olive` #9aa06b
- **New — list accent palette** (muted, distinguishable on `--panel`, assigned least-used-first, duplicates allowed): `#b04a3e`, `#7a8a4e`, `#5a6e96`, `#5e8a8a`, `#8a5e86`, `#a3703e`. Contrast verified — all six clear 3:1 against `--panel`, `--scroll-track`, and `--bg`; see the table in design.md. The list name remains the primary accessible identity because the palette separates by hue, not luminance.
- Type: Alegreya (body), IM Fell English SC (display). Accent frame 3px; row left-accent 3px; poster card height 220px; grid gap 14px; row gap 6px.

## Assets
- Hunter portraits: striped placeholders in the prototype. Production: self-hosted scrape per the pending hunter-data ADR, `/images/hunters/{slug}.{ext}`, lazy-loaded, `ItemThumb`-style extension-chain fallback (SPEC-0001).
- Weapon/tool thumbs: existing `ItemThumb` component and `/images/{category}/` assets.
- No new icons; monogram/glyph fallbacks are plain text.

## Files
- `docs/design/hunter-loadout-lists/loadout-lists-panel.html` — the interactive prototype (open in a browser; includes names-only-phase and thumb-strip toggles). Renamed from the delivered `Loadout Lists Panel.dc.html` on commit.
- Repo references: `docs/adrs/ADR-0006-hunter-loadout-lists.md`, `docs/openspec/specs/hunter-loadout-lists/spec.md` + `design.md`, `client/src/styles/global.css`, `client/src/components/SavedLoadoutsPanel/SavedLoadoutsPanel.jsx` (component being replaced), `client/src/components/ItemThumb/ItemThumb.jsx`.
