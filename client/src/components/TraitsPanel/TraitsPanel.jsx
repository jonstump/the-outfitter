import { useDispatch, useSelector } from "react-redux";
import { TRAITS, traitThumb } from "../../data/catalog.js";
import { RARITY_COLOR, descriptionFor, rarityFor } from "../../data/itemStats.js";
import { loadoutActions } from "../../store/loadoutSlice.js";
import { TRAIT_MAX } from "../../utils/calc.js";
import { selectTraitOverCapacity } from "../../store/selectors.js";
import ItemThumb from "../ItemThumb/ItemThumb.jsx";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape), ADR-0012 (fifteen-trait cap)
// Implements: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback",
// SPEC-0001 REQ "Consistent Visual Presentation"
//
// The panel draws a FIXED fifteen-cell grid, five across, rather than a chip per trait.
//
// Fifteen is the cap ADR-0012 enforces, and the grid is deliberately the same shape the saved
// loadout preview already draws (`.ll-lp-traits`) — SPEC-0003 REQ "Filed Loadouts Preview Their
// Contents" says the preview's "categories SHALL match the builder's grouping and cell counts,
// so a loadout is read the same way in a list as in the panel that produced it". Until now the
// preview had the grid and the builder had chips, so that parity was one-sided. This closes it
// from the builder's end.
//
// The cell count does NOT derive from the trait-point budget. That budget is user-settable and
// off by default, so deriving from it would reflow the grid when a setting changed — the same
// reasoning the preview's CSS already records.

/** Empty cells are drawn, not omitted: the grid's shape is the point, so it never reflows. */
function EmptyCell() {
  return <span className="trait-cell trait-cell-empty" aria-hidden="true" />;
}

function TraitCell({ trait, onRemove }) {
  const [id, name, up] = trait;
  const description = descriptionFor(id);
  // Governing: ADR-0018 (amended by #392), issue #362. This composed string is the
  // surface the ADR names directly: `trait-cell-up` below is aria-hidden, so it is the
  // ONLY place a screen reader learns the trait's cost. Until this fix a Scarce trait
  // (cost 0) was announced as "0 upgrade points" — the exact false claim ADR-0018 exists
  // to correct, since Scarce means "cannot be bought", not "free". A Burn trait keeps its
  // real point cost (Necromancer's is 4 and correct, since Burn does not imply free) and
  // gains a second clause disclosing consumption instead of losing its number.
  //
  // The tooltip is decorative duplication — the button's accessible name carries the same
  // facts, so a screen reader never depends on a hover surface it cannot reach.
  const rarity = rarityFor(id);
  const costPhrase = rarity.scarce
    ? "Scarce — cannot be purchased here"
    : `${up} upgrade point${up === 1 ? "" : "s"}`;
  const burnPhrase = rarity.burn ? ", consumed on use" : "";
  const label = `${name}, ${costPhrase}${burnPhrase}. Activate to remove.`;
  const upColor = rarity.scarce ? RARITY_COLOR.scarce : rarity.burn ? RARITY_COLOR.burn : undefined;
  return (
    <button
      type="button"
      className="trait-cell trait-cell-filled"
      aria-label={label}
      onClick={() => onRemove(id)}
    >
      <ItemThumb category="traits" name={name} alt="" svgPath={traitThumb(trait)} className="trait-cell-thumb" />
      {/* The optional spur-colour half of ADR-0018's treatment. A Scarce trait's icon
          glyph swaps the always-0 number for a dash — "0" on the icon is the same
          visual false claim the label above fixes, even though this span is
          aria-hidden and cannot itself reach a screen reader. */}
      <span className="trait-cell-up" aria-hidden="true" style={upColor ? { color: upColor } : undefined}>
        {rarity.scarce ? "—" : up}
      </span>
      {/* Name, then the scraped description when there is one. The cost is still absent: it is
          already on the icon, and repeating it as "8 UP" said the same thing twice in one hover.
          The unit survives in the accessible name above, where a bare "8" would read as nothing.

          Both lines are `aria-hidden` because the tip is decorative duplication — but the
          description is NOT duplicated in the accessible name, and that is deliberate. `aria-label`
          is announced whole, so appending prose would make every trait removal read out a paragraph
          before saying "Activate to remove". A screen reader user gets the description on the picker
          row instead, where it is the row's own text rather than a hover surface.

          Rendered as {text}, never as markup: the value is untrusted wiki output, which SPEC-0003
          states for the hunter descriptions and applies identically here. */}
      <span className="trait-cell-tip" aria-hidden="true">
        <span className="trait-cell-tip-name">{name}</span>
        {description ? <span className="trait-cell-tip-desc">{description}</span> : null}
      </span>
    </button>
  );
}

export default function TraitsPanel() {
  const dispatch = useDispatch();
  const traits = useSelector((s) => s.loadout.traits);
  const overCap = useSelector(selectTraitOverCapacity);
  const remove = (id) => dispatch(loadoutActions.removeTrait(id));

  const resolved = traits.map((id) => TRAITS.find((t) => t[0] === id)).filter(Boolean);
  const cells = Array.from({ length: TRAIT_MAX }, (_, i) => resolved[i] ?? null);
  // Governing: ADR-0024 ("loadable, not legal"). A decoded loadout can legitimately hold
  // more than `TRAIT_MAX` traits (a save made under a looser historical rule, or a crafted
  // payload, loads rather than being silently clamped). The fixed fifteen-cell grid renders
  // the first fifteen; the overage — when it exists — is disclosed by the warning below
  // rather than hidden by a label that silently caps the count at fifteen. The group label
  // names the true held count, never the grid's cell count, so an over-cap loadout reads
  // honestly as "16 of 15" rather than "15 of 15".
  const heldLabel = resolved.length;
  // One message, two channels: the visible warning and the live region below both
  // read it, so the sighted and announced surfaces cannot drift apart. Empty string
  // when the grid is legal — the live region is mounted either way (see the comment
  // on `equip-overcap-announcer` in EquipmentPanel.jsx for why: inserting a live region
  // together with its content is silent to assistive tech, so it must already be in the
  // tree before the first violation).
  const overCapMessage = !overCap
    ? ""
    : `Over capacity — ${overCap.held} of ${overCap.max} traits. Remove one to save.`;

  return (
    <div className="panel">
      <div className="panel-title">Traits</div>
      {resolved.length === 0 && (
        <div className="empty-note" style={{ marginTop: 8 }}>
          None taken — pick from the ledger.
        </div>
      )}
      {/* `role="group"` rather than a list: every filled cell is a button, and wrapping each in
          a listitem put a bare span between the grid and its cell — which made filled and empty
          cells size differently, since only one of them was the grid item. Both are direct
          children here, so one rule sizes both. */}
      <div className="trait-grid" role="group" aria-label={`Traits, ${heldLabel} of ${TRAIT_MAX}`}>
        {cells.map((trait, slot) =>
          trait ? (
            <TraitCell key={trait[0]} trait={trait} onRemove={remove} />
          ) : (
            <EmptyCell key={`empty-${slot}`} />
          )
        )}
      </div>
      {/* Governing: ADR-0024 ("loadable, not legal"), ADR-0012 (fifteen-trait cap). A decoded
          loadout can now hold more than fifteen traits (the decoder no longer clamps), so this
          warning is what makes the overage visible rather than silently wrong — the same
          two-channel structure the equipment panel uses (PR #416, `equipOverCapacity`). */}
      {overCap && <div className="over-capacity-warning">{overCapMessage}</div>}
      <div
        data-testid="trait-overcap-announcer"
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {overCapMessage}
      </div>
    </div>
  );
}
