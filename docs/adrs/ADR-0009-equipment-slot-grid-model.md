---
status: accepted
date: 2026-08-10
decision-makers: Jon Stump
governs: [SPEC-0006]
related: [ADR-0006, ADR-0012]
---

# ADR-0009: Model Equipment Slots as a Fixed, Sparse Eight-Cell Grid

## Context and Problem Statement

The Equipment panel renders eight cells. It does not have eight slots.

`client/src/store/loadoutSlice.js` keeps equipment in `state.equip`, a **dense
packed array** of `{ t, i }` entries. `EquipmentPanel.jsx` renders
`Array.from({ length: 8 })` and hands each index to `EquipmentSlot`, which reads
`state.equip[index]`. The array index *is* the cell position, and because the
array is packed, every item is pinned to the front of the grid in the order it
happened to be added. `removeEquip` is a `splice`, so unequipping the first item
slides all six behind it one cell to the left.

The consequence is that a player cannot express the thing they actually care
about. Hunt: Showdown binds equipment to number keys, so "First Aid Kit on 1,
knife on 4, dynamite on 8" is muscle memory, not decoration. Today, carrying
three items means occupying cells 1–3 — there is no way to reach cell 8, and no
way to move anything once placed except by removing everything after it and
re-adding in a different order.

Three related properties of the current model compound this:

1. **`blocked` is a count, not a set of positions.** `slotMax()` returns
   `8 - blocked`, and `EquipmentSlot` decides a cell is blocked by testing
   `index >= slotMax`. Blocking therefore always eats cells from the *tail*. A
   player whose hunter lacks a middle slot cannot say so.
2. **Duplicate consumables are already legal but render as unrelated tiles.**
   `addEquip` caps consumables at four *per category* (`CONS[i][3]` — `Shot`,
   `Throwable`, …), not per item, so two Vitality Shots is a valid loadout and
   consumes two of eight cells. The grid shows two identical tiles with no
   indication they are the same thing. Duplicate *tools* are separately
   forbidden by `addEquip` and always have been.
3. **The panel's column count is a function of its width.** `.equip-grid` is
   `grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))`, so the eight
   cells wrap into however many columns fit — four at one size, three or two at
   another. Two places in the codebase already describe the panel as two rows of
   four (`LoadoutListsPanel.jsx:102` and the `.ll-lp-equip` comment in
   `global.css`, both justifying the preview's *fixed* four-column grid as
   "mirroring the builder's own `.equip-grid`"), and both are wrong about it.

The question: **what is the state shape for equipment such that a cell position
is a user-controlled property of the loadout, and repeated consumables read as
one stack rather than as coincidence?**

Three existing facts constrain the answer:

* **The wire format is versioned and has a working migration path.**
  `loadoutCodec.js` declares `FORMAT_VERSION = 1`, dispatches decoding through a
  `DECODERS` table, and already carries a frozen legacy table for the
  pre-versioning encoding (issue #68). A format change is a known, exercised
  operation here rather than a novel risk.
* **The server validates the payload but does not interpret it.**
  `server/src/routes/loadouts.js` stores `data` as an opaque blob; the only
  server-side knowledge of equipment is `isValidData`, which asserts `data.e` is
  an array of at most 8 `[t, id]` pairs with no holes, and `data.b` is a number
  in `0..8`. That validator exists to keep unresolvable references out of the
  data file (issue #19) and is a genuine boundary control, not incidental
  strictness.
* **`slotMax` is consumed in six places.** `calc.js`, `selectors.js`,
  `loadoutSlice.js` (twice), `thunks.js`, `randomize.js`, and `Picker.jsx` all
  read it, and `Picker.jsx` independently re-derives the "is there room" test as
  `loadout.equip.length < sMax`. Any change to what a slot *is* has to land in
  all of them or the panel and the picker will disagree about capacity.

## Decision Drivers

* **Cell position must be a stored property of the loadout, not a rendering
  artifact.** If the position is not in the payload, it does not survive a save,
  a share link, or a reload — which is the entire point.
* **A stored cell position is only worth storing if it names a stable place.**
  The want is muscle memory, and muscle memory is spatial before it is ordinal.
  A payload that faithfully records "cell 8" buys nothing if cell 8 is in a
  different corner of the panel after a window resize.
* **No silent remapping of existing saved loadouts.** ADR-0002-era catalog
  reordering and issue #68's legacy-decoder bug are the repo's two worst data
  incidents, both caused by position being load-bearing without being declared.
  A change that makes *more* things positional has to pay for that with an
  explicit, tested migration.
* **One representation, not two.** A model that stores both an item list and a
  position map has two sources of truth to keep synchronized, and a class of bug
  where they disagree.
* **The server validator must get stricter, never looser.** Whatever shape the
  wire format takes, `isValidData` must still reject unresolvable ids, still
  bound the payload, and must not start accepting arbitrary structure in the
  name of accommodating a new version.
* **Stacking is what the player sees, not necessarily what the app stores.** The
  requirement is a legible tile with a quantity badge and honest accounting of
  the cells consumed. Whether a stack is one record with a count or several
  records that happen to be adjacent is an implementation choice, and the
  simpler one should win.
* **Drag-and-drop is not the only way to move an item.** Whatever model is
  chosen must be operable without a pointer at all, because WCAG 2.1 AA requires
  it and because the grid is the app's densest interaction surface.

## Considered Options

* **Fixed sparse eight-cell array** — `equip` becomes length 8 with `null` for
  empty cells; index is the cell; wire format bumps to v2.
* **Dense array with reorder-only drag** — keep the packed array, add a `move`
  reducer that repositions within the sequence. No wire format change.
* **Dense array plus a parallel position map** — keep `equip` packed and add
  `positions: number[]` alongside it.
* **Explicit quantity field on entries** — `{ t, i, q }`, where a stack is one
  entry reserving `q` cells.

## Decision Outcome

Chosen option: **"Fixed sparse eight-cell array"**, with stacking derived from
adjacency rather than stored, and `blocked` promoted from a count to a set of
cell indices.

`state.equip` becomes an array of exactly 8 elements, each `null` or
`{ t, i }`. The array index is the cell, permanently and for every array length,
which means the invariant that is currently true by accident — *index is
position* — becomes true by construction. Nothing has to slide when an item is
removed, because removal writes `null` rather than splicing.

This is the only option that makes cell position storable without introducing a
second structure. The dense alternatives cannot express "three items, one of
them in cell 8" at all; they can only reorder a run that always starts at cell 1,
which is a different feature from the one being asked for.

### The grid is a fixed two-by-four, transposed rather than reflowed

*(Added 2026-08-12. See Amendments.)*

The panel draws **eight cells as two ranks of four**, always, with cells 1–4 the
first rank and 5–8 the second. `repeat(auto-fill, …)` is replaced with a pinned
track count.

Which axis the ranks run along follows the space available. Where the panel is
wide the ranks are **rows** — four columns by two rows, cell 1 top-left, cell 5
directly below it. Where the panel is narrow the grid **transposes**: the ranks
become **columns** — two columns by four rows, cells 1–4 running down the first
column and 5–8 down the second. There is no third arrangement, and the grid never
picks a track count from whatever happened to fit.

**Transposition is not reflow, and the distinction is the whole reason it is
allowed.** A transpose is a rotation of the grid: every cell keeps exactly the
neighbours it had, and the rank break stays between cells 4 and 5. Only the axis
those relationships are drawn along changes. A reflow to a different track count
— eight cells as four rows of two — would instead make cell 5 a neighbour of
cell 6 and no longer of cell 1, which is a different arrangement of the same
payload and is what this decision forbids.

The pinned track count is the same thing the traits panel already does for the
same reason — a fixed fifteen cells, five across, with the count pinned rather
than derived, because a grid that reflowed when a setting changed would defeat
the point of drawing a grid at all (ADR-0012 governs the fifteen; `.trait-grid`
and `.ll-lp-traits` both pin the five). The traits grid does not transpose, and
does not need to: its cells are square icons that shrink cleanly, where an
equipment tile carries an image, a name, a category, and a cost.

**The threshold is the panel's width, not the viewport's.** The equipment panel
sits in `.left-column` (`flex: 1 1 400px; min-width: 320px`) beside a wider
right column, so the two are not proportional to each other. Below roughly a
716px viewport the columns stack and the panel becomes nearly viewport-wide; just
above it, at around 760px, both columns sit at their 320px minimums and the panel
is at its narrowest of any width the app supports — about 286px of grid, or 64px
per cell across four. A viewport-keyed breakpoint would transpose on the phone,
where the stacked panel is 620px of grid and four-across is comfortable, and stay
landscape on the tablet, where it is not. The orientation is therefore a function
of the panel's own width.

Three things this ADR decides depend on the ranks being fixed:

1. **"Cell 8" has to name a place, not just an index.** The requirement is
   "First Aid Kit on 1, knife on 4, dynamite on 8". Under auto-fill, cell 5 sits
   directly below cell 1 at one width, beside cell 4 at another, and beside
   cell 3 at a third, so an arrangement the player deliberately built reads as a
   different arrangement after a resize, while the payload is byte-identical.
   Storing the position solves persistence and does nothing for recognition. Two
   ranks of four survive a transpose because the ranks are what the player learns:
   "the second row" and "the second column" are the same four items, and which
   one a given device shows is stable for that device.
2. **Arrow-key navigation is undefinable without a known track count.** This
   decision requires a keyboard route to every pointer gesture, and that route is
   arrow keys moving a placement target among cells. "Down from cell 2" is cell 6
   only if there are four columns — at three columns it is cell 5, at eight
   columns it is nothing, and after a transpose it is cell 3. What makes that
   tractable is that there are exactly two arrangements and the app declares which
   one it is in, rather than the sensor asking the layout what it did. The move
   operation is identical in both; only which delta the vertical arrow carries
   changes, and both the stylesheet and the sensor take that from one declared
   threshold.
3. **Adjacency is the whole of the stacking model, and a transpose preserves it
   exactly.** A stack is a run of consecutive cells, so a `×2` anchored at cell 4
   straddles the rank break. Under transposition that break is still between 4
   and 5, the run is still contiguous, and a `×2` on cells 1 and 2 is drawn
   side by side in one orientation and one above the other in the other — two
   drawings of the same adjacency. Under a genuine reflow the run's contiguity
   depends on the width, which would leave the badge as the only reliable signal
   of something the layout is supposed to be showing.

The cost is that the tile has to survive both orientations and a wide range of
widths. Four cells across a 286px grid is 64px per cell at the tightest
two-column width, against the 140px floor `auto-fill` uses today, so the tile's
current composition — image, name, category, cost, in a 92px-tall box — does not
carry over unchanged. Transposition is what keeps that from being the *only*
answer: the same panel two cells across gives roughly 138px per cell, so the
narrow case gets a tile of about the width the wide case has today. What
ultimately gives inside the tile is an implementation question this decision
deliberately leaves open; it fixes the grid's geometry, not the tile's
composition.

### Blocked cells become positions, not a count

`blocked: number` becomes `blocked: number[]` — the indices of cells the hunter
does not have. `slotMax()` becomes `8 - blocked.length`, so every existing caller
keeps the same arithmetic meaning, but `EquipmentSlot` stops inferring
blockedness from `index >= slotMax` and reads membership directly.

This is not an incidental cleanup. Under free placement, `index >= slotMax` is
simply wrong: an item legitimately sitting in cell 8 with four cells empty in
front of it would render as blocked. The tail-count model and free placement
cannot coexist, so the two changes are one change.

Migration is exact rather than approximate: a v1 record with `b: 3` rendered
cells 5, 6, and 7 as blocked, so it decodes to `b: [5, 6, 7]`. No information is
invented and none is lost.

### Stacking is derived from adjacency, not stored

A stack is **not** a record. `equip` still holds one entry per occupied cell, and
the quantity badge is computed by a pure view function over maximal runs of
consecutive cells holding the same `(t, i)`.

This was chosen over an explicit `q` field for four reasons:

1. **The wire format stays a straight positional array.** Adding `q` would mean
   entries reserve cells they do not appear in, so the array index would no
   longer be the cell for every entry — reintroducing exactly the implicit
   coupling this ADR exists to remove.
2. **The cell accounting is free.** "Two Vitality Shots consume two of eight
   cells" needs no separate reservation logic, no reconciliation, and no way to
   drift; the cells are occupied because entries are in them.
3. **The consumables-only rule needs no special case.** `addEquip` already
   forbids two of the same tool, so a run of length ≥ 2 can only ever be
   consumables. The view function does not test the category — the requirement
   falls out of a rule that is already enforced and already tested.
4. **The existing category cap keeps working untouched.** `catCount()` counts
   entries; four Shots is four entries whether or not any of them are adjacent.

The cost is that two copies of the same consumable in non-adjacent cells render
as two tiles rather than one stack. That is accepted, and it is arguably correct
under free placement: the player put them in those cells deliberately.

### The server validator is the load-bearing coupling

`isValidData` currently rejects a payload whose `e` contains `null`, and rejects
a `b` that is not a number. A v2 payload is therefore a **400** against today's
server. The client change cannot ship alone, and this is the single sequencing
constraint in the whole decision.

The validator must accept both versions permanently, not transitionally. The
server performs no migration — records written before v2 stay v1 in the data
file until the loadout is next saved, and a user who never re-saves an old
loadout keeps a v1 record indefinitely. Version dispatch lives entirely in the
client decoder, which is where it already lives.

Every guard the validator applies today survives: ids still resolve against the
catalog, `e` is still bounded at 8, `tr` at 40, and `n` at 200 characters. v2
adds guards rather than removing them — `e` must be exactly 8 long, and `b` must
be unique integers in `0..7` — because a sparse array with a wrong length is
precisely the shape that would render items in the wrong cells.

### Consequences

* Good, because cell position becomes an explicit, versioned, validated field
  instead of an emergent property of array packing. The class of bug where a
  removal silently relocates five other items disappears, because nothing moves
  that the user did not move.
* Good, because `removeEquip` writing `null` in place is a smaller and more
  obviously correct operation than a `splice` whose blast radius is every entry
  behind it.
* Good, because the quantity badge cannot disagree with the cell count. There is
  no stored quantity to be wrong.
* Good, because the migration is total and lossless in both directions of
  meaning: every v1 record has exactly one faithful v2 reading, and the frozen
  legacy tables (`LEGACY_*_IDS`) are untouched — the pre-versioning path decodes
  to v1 semantics and then through the same v1→v2 lift.
* Bad, because every consumer of `state.equip` must now tolerate holes.
  `catCount`, `totalCost`, `toData`, `randomize`, `selectEquipCount`, and
  `Picker.jsx`'s capacity test all iterate or measure the array and all are
  wrong the moment it is sparse. This is six files' worth of mechanical change
  with no compiler to find the misses, which makes the test suite the only
  guard — and it is the reason the spec states the capacity rule once as
  "a free unblocked cell exists" rather than restating `length < slotMax`.
* Bad, because it costs a coordinated client and server change. Nothing about
  the client half is useful until `isValidData` accepts v2, and a client that
  ships first turns every save into a 400.
* Bad, because SPEC-0003's not-yet-implemented "Filed Loadouts Preview Their
  Contents" reads the equipment payload in slot order and sheds "later slots
  before earlier ones". Under a sparse array it must skip holes rather than
  index blindly. That requirement is unimplemented, so this ADR creates no
  regression — but it does add a constraint to work already specified elsewhere,
  and SPEC-0003 needs a one-line amendment rather than silent divergence.
* Bad, because a stack that is split across non-adjacent cells is invisible as a
  stack. A player with Vitality Shots in cells 1 and 6 sees two tiles and no
  badge. This is a real legibility gap accepted in exchange for not storing a
  reservation.
* Good, because pinning the ranks closes a parity gap that was already asserted
  in two comments and honoured in neither direction: the saved-loadout preview
  draws a fixed four-column grid justified as mirroring the builder, and the
  builder has never been that shape. With a 140px floor, `auto-fill` yields four
  columns only above roughly a 1434px viewport; it is three through most of the
  desktop range and two around 1024px. SPEC-0003 asks for that parity and it has
  simply never held.
* Bad, because the panel now has two arrangements where it had one, and every
  rendering and interaction requirement has to be true of both. The transpose is
  cheap in CSS and cheap in the sensor, but it doubles what a reviewer has to
  check, and an assertion written against only the wide orientation will pass
  while the narrow one is broken.
* Bad, because on a narrow panel the builder and the saved-loadout preview are no
  longer the same drawing — the builder transposes and the preview does not, so
  they differ by a rotation. The preview keeps its four-across shape because its
  cells are 48px-floored thumbnails that fit at any width, and because it lives
  in a card that can be narrow at *any* viewport, so a threshold that rotated it
  would rotate some cards and not others in the same list. The ranks still match,
  which is what SPEC-0003's parity requirement is about, but the two are no
  longer superimposable on a phone.
* Bad, because the tile's current composition does not survive four-across. This
  was already true before the grid was pinned — `auto-fill` was hiding it by
  quietly dropping to three or two columns — so the decision surfaces an existing
  cost rather than creating one, but it surfaces it as work that must be done.
* Neutral, because the eight-cell grid was already the rendered reality. This
  decision does not change what the panel looks like when full; it changes what
  the panel can represent when it is not.
* Neutral, because the geometry is a rendering constraint and stays out of the
  payload. Wire format v2 encodes cells, not rows and columns, so nothing about
  the fixed grid reaches the codec, the validator, or the migration.
* Neutral, because drag-and-drop is an interaction affordance layered on the
  move operation, not the operation itself. The reducer takes "move the contents
  of cell A to cell B"; pointer drag, keyboard grab-and-place, and any future
  touch gesture are three callers of one thing.

## Pros and Cons of the Options

### Dense array with reorder-only drag

* Good, because it requires no wire format change, no server change, and no
  migration — a `move` reducer over the existing packed array is a contained,
  low-risk edit.
* Good, because every existing consumer of `state.equip` keeps working unmodified.
* Bad, because it does not deliver the requirement. "Players have a preference
  where their tools go in the eight slots" is a statement about absolute cells,
  and a packed array can only express relative order within a run that always
  begins at cell 1.
* Bad, because it leaves `blocked` as a tail count, so a hunter missing a
  non-final slot remains unrepresentable.
* Bad, because it makes the eight-cell grid permanently misleading: it looks like
  eight addressable positions and behaves like a queue.

### Dense array plus a parallel position map

* Good, because the item list keeps its current shape, so `catCount`,
  `totalCost`, and `randomize` need no change at all.
* Good, because it can express free placement, unlike reorder-only.
* Bad, because it has two sources of truth that must agree — an entry with no
  position, a position with no entry, or two entries claiming one cell are all
  representable states, and all are corrupt.
* Bad, because every mutation has to update both structures atomically, and
  every decoder has to validate their mutual consistency. The sparse array makes
  all three corrupt states unrepresentable by construction.
* Bad, because it still bumps the wire format, so it pays the migration and
  server-validator cost without buying the simplification.

### Explicit quantity field on entries

* Good, because a stack is a single record, which makes "increment the stack" a
  one-field edit and makes non-adjacent duplicates impossible by construction.
* Good, because the badge value is read directly rather than computed.
* Bad, because an entry reserving `q` cells breaks index-is-position for every
  entry after it, which is the coupling this ADR exists to eliminate.
* Bad, because reservation needs collision rules — what happens when the cells a
  growing stack would claim are occupied, what happens when a stack is dragged
  onto a region that only partly fits — and each rule is a new failure mode.
* Bad, because the stored quantity and the occupied-cell count can disagree,
  which is a corrupt state that the derived model cannot reach.

## More Information

* Current implementation: `client/src/store/loadoutSlice.js`,
  `client/src/utils/calc.js`, `client/src/utils/loadoutCodec.js`,
  `client/src/components/EquipmentPanel/`.
* Server-side validator: `server/src/routes/loadouts.js` (`isValidData`).
* SPEC-0006 carries the testable form of this decision, including the migration
  scenarios, the drag and keyboard interaction requirements, and the accessibility
  obligations that follow from making the grid a manipulable surface.
* Prior art in this repo for a versioned format change: the v1 introduction and
  its frozen legacy tables, `client/src/utils/loadoutCodec.js` (issues #26, #68).
* Prior art for a fixed-geometry grid: `TraitsPanel.jsx` and `.trait-grid`, which
  draw ADR-0012's fifteen cells at a pinned five across, and `.ll-lp-equip` /
  `.ll-lp-traits`, which do the same in the saved-loadout preview.

## Amendments

Recorded rather than silently rewritten, so the addition is auditable and the
original scope of the decision stays legible.

### 2026-08-12 — the grid's geometry is fixed at two ranks of four

**Added:** the sub-decision "The grid is a fixed two-by-four, transposed rather
than reflowed", its four consequences, and the decision driver "a stored cell
position is only worth storing if it names a stable place".

**Original:** this ADR decided the equipment *model* — eight cells, index is
position, `null` is empty — and said nothing about how those eight cells are laid
out. `.equip-grid` reflows its column count with the panel's width
(`repeat(auto-fill, minmax(140px, 1fr))`), and nothing here forbade it.

**Why:** the omission was invisible while `state.equip` was packed, because a
packed array has no addressable cells for the layout to be a claim about. Free
placement makes the layout load-bearing in three places at once — the muscle
memory the decision exists to serve is spatial, the required keyboard route needs
a column count to define "the cell below this one", and the derived stacking
model renders adjacency that a reflowing grid breaks and reforms at different
widths. Leaving geometry unspecified would have handed all three to whoever
wrote the CSS.

**Why transposition rather than a single fixed axis:** an earlier draft of this
amendment pinned the grid at four columns at every width, full stop. That was
rejected on measurement. The panel is not viewport-width — it sits in a flex
column beside a wider one — and its narrowest state is not the phone but the
tablet, at around a 760px viewport, where both columns are at their 320px
minimums and four cells across come to roughly 64px each. Below 716px the
columns stack and the panel more than doubles. A single fixed axis would have
made the tightest case the one with no relief, and the relief that exists —
letting the tile shrink — runs out well before 64px. Transposition was accepted
because it is not a reflow: it preserves every cell's neighbours and the rank
break, so it buys the width back without reintroducing the instability the fixed
grid exists to remove.

**Blast radius:** SPEC-0006 gains the requirement "The Grid Renders as Two Ranks
of Four" and its keyboard requirement now defines arrow-key movement against a
declared orientation instead of leaving "move among cells" to the
implementation; the design document gains a corresponding decision, the
container-query mechanism, and a tile-composition risk. Nothing else moves. The
state shape, wire format v2, the migration, and the server validator are
untouched, because geometry is a rendering constraint and the payload has never
encoded it — which is also why this is an amendment rather than a new ADR.
