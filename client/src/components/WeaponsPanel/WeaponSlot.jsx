import { useDispatch, useSelector } from "react-redux";
import { useEffect, useMemo, useRef, useState } from "react";
import { AMMO_LABEL, WEAPONS, weaponThumb } from "../../data/catalog.js";
import { ammoRoundFor, ammoSlotsFor, dualWieldFor } from "../../data/itemStats.js";
import { selectWeaponSlot } from "../../store/selectors.js";
import { loadoutActions } from "../../store/loadoutSlice.js";
import { ammoCostFor, capMax, capUsed } from "../../utils/calc.js";
import ItemThumb from "../ItemThumb/ItemThumb.jsx";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Implements: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback",
// SPEC-0001 REQ "Consistent Visual Presentation"

// Governing: issue #346, SPEC-0010 REQ "Each Ammo Slot Is Individually Labelled and
// Operable". See the ammo-row comment in the component below for why bound (dual-family)
// and unbound (split-reserve) two-slot weapons name their slots differently.
function ammoSlotLabel(weaponName, slots, slotIndex) {
  if (slots.count < 2) return `${weaponName} ammo`;
  if (slots.bound) {
    const family = slots.groups[slotIndex]?.[0]?.family;
    return `${weaponName} — ${AMMO_LABEL[family] ?? `ammo slot ${slotIndex + 1}`}`;
  }
  return `${weaponName} — ammo slot ${slotIndex + 1}`;
}

export default function WeaponSlot({ slot }) {
  const dispatch = useDispatch();
  // selectWeaponSlot is a selector factory; memoize the instance so its
  // createSelector cache survives re-renders (issue #24/#25).
  const w = useSelector(useMemo(() => selectWeaponSlot(slot), [slot]));
  // ALL hooks run before the early return below — an empty slot must not change the
  // hook order React sees (Rules of Hooks), so the live-region state and the whole
  // loadout are selected unconditionally.
  const [announced, setAnnounced] = useState("");
  const l = useSelector((s) => s.loadout);
  // Governing: issue #400, SPEC-0001 WCAG 2.1 AA baseline.
  //
  // The live region is driven by the STORE, never by the click that asked for the
  // change: the old onClick announced from the pre-dispatch state, so a refused
  // dispatch (an over-capacity loadout refusing an un-pair) still told the screen
  // reader the pair was undone — assistive tech reporting the opposite of the truth.
  // This ref/effect pair announces only a CHANGE in the stored flag, so the region
  // can never describe a transition the reducer did not make. `prevPair` starts null
  // so the first render (a loadout that decodes with a pair already set) is silent.
  const prevPair = useRef(null);
  useEffect(() => {
    const paired = w?.d === true;
    const name = w ? WEAPONS[w.i][1] : null;
    if (prevPair.current === null || !name) {
      prevPair.current = paired;
      return;
    }
    if (prevPair.current !== paired) {
      setAnnounced(paired ? `Dual-wielding ${name}.` : `${name} is no longer dual-wielded.`);
      prevPair.current = paired;
    }
  }, [w]);
  // Governing: issue #346, SPEC-0010 REQ "Each Ammo Slot Is Individually Labelled and
  // Operable" ("the change SHALL be announced through a live region"). `ammoCostFor` is
  // null-safe (returns 0 for an empty slot), so this hook can run unconditionally
  // alongside the pair effect above — the Rules-of-Hooks constraint the comment above
  // already explains. Same store-driven-not-click-driven discipline as `prevPair`:
  // `prevAmmoCost` starts null so a loadout that decodes with ammo already selected
  // stays silent on first render.
  const ammoCost = ammoCostFor(w);
  const prevAmmoCost = useRef(null);
  useEffect(() => {
    const name = w ? WEAPONS[w.i][1] : null;
    if (prevAmmoCost.current === null || !name) {
      prevAmmoCost.current = ammoCost;
      return;
    }
    if (prevAmmoCost.current !== ammoCost) {
      setAnnounced(`${name} ammo cost is now $${ammoCost}.`);
      prevAmmoCost.current = ammoCost;
    }
  }, [w, ammoCost]);

  if (!w) {
    return (
      <div className="weapon-slot empty-slot">
        <div className="empty-note">
          {slot === 0 ? "Primary — pick from the armory" : "Secondary — pick from the armory"}
        </div>
      </div>
    );
  }

  const def = WEAPONS[w.i];
  // Governing: ADR-0014, SPEC-0010 REQ "A Weapon Declares Which Rounds It Accepts", issue
  // #344. The weapon's OWN accepted rounds and slot count — never the shared class pool
  // `AMMO[ammoClass]` retired from this component's compatibility/price decisions here.
  const slots = ammoSlotsFor(def[0]);
  const variant = ammoRoundFor(def[0], 0, w.ammo?.[0] ?? null);

  // Governing: ADR-0023, SPEC-0009 REQ "The Pair Affordance Lives on the Weapon Slot".
  //
  // The affordance exists ONLY for a weapon the stored per-weapon attribute marks
  // dual-wieldable — read from itemStats.json, never derived from size/name/ammo. It is
  // one of three states, and the accessible name (aria-label) distinguishes them so a
  // screen reader user can tell available from locked without seeing the tile:
  //   - available (d: false, budget has room)  -> activating marks the pair
  //   - locked   (d: false, budget has no room) -> disabled, stays in the a11y tree
  //   - paired   (d: true)                      -> activating returns to a single
  const pairable = dualWieldFor(def[0]) === true;
  // The whole loadout is needed here for the OTHER slot's occupied size, so it is
  // selected directly rather than threaded through a slot-scoped selector.
  const used = capUsed(l);
  const max = capMax(l);
  // The single is ALREADY counted in `used`, so a pair costs only the MARGINAL extra
  // point: it is affordable when used + 1 <= max. This is the delta that decides the
  // locked vs available state; the reducer's toggle refuses using the shared weaponSize
  // cost, so the two routes cannot disagree about what a pair costs (SPEC-0009).
  const pairFits = used + 1 <= max;
  const isPair = w.d === true;
  const pairLocked = pairable && !isPair && !pairFits;
  const pairState = pairable ? (isPair ? "paired" : pairLocked ? "locked" : "available") : null;
  const pairLabel =
    pairState === "paired"
      ? `Unpair ${def[1]}`
      : pairState === "locked"
        ? `Dual-wield ${def[1]} — not enough budget`
        : `Dual-wield ${def[1]}`;

  return (
    <div className="weapon-slot filled-slot">
      <div className="weapon-slot-row">
        <div className="weapon-slot-main">
          {/* Governing: ADR-0023 ("renders a ghosted second copy WITHIN that weapon's own
              tile: a plus sign when the budget has room for the extra slot, a locked state
              when it does not"), SPEC-0009 REQ "The Pair Affordance Lives on the Weapon
              Slot" ("SHALL render a representation of the second pistol").
              The affordance IS the second photograph of the weapon, sitting beside the
              real one in the tile's image area — not a label describing one. It is wrapped
              in a real <button> so it stays keyboard-operable and named (REQ "Operable and
              Named in Every State"); the button carries the semantics, the image carries
              the meaning. */}
          <div className={`weapon-thumb-pair${pairState ? ` has-pair-${pairState}` : ""}`}>
            <ItemThumb category="weapons" name={def[1]} svgPath={weaponThumb(def)} className="weapon-thumb" />
            {pairState && (
              <button
                type="button"
                className={`pair-toggle ${pairState}`}
                aria-label={pairLabel}
                aria-disabled={pairState === "locked" || undefined}
                onClick={() => {
                  // Governing: issue #401, ADR-0023 ("keyboard-reachable ... in all three
                  // states"). aria-disabled keeps the locked control focusable: a native
                  // disabled button is skipped by Tab, so a keyboard-only user could never
                  // reach the control that says WHY pairing is unavailable. An aria-disabled
                  // button still fires click events, so the locked state returns early — the
                  // reducer guard remains the real enforcement and stays untouched.
                  if (pairState === "locked") return;
                  dispatch(loadoutActions.togglePair(slot));
                }}
              >
                {/* alt="" — the button's aria-label already names the control in all three
                    states, so the second photo is decorative to assistive tech and must not
                    announce the weapon's name a second time. */}
                <ItemThumb
                  category="weapons"
                  name={def[1]}
                  alt=""
                  svgPath={weaponThumb(def)}
                  className="weapon-thumb pair-thumb"
                />
                {pairState === "available" && (
                  <span className="pair-plus" aria-hidden="true">
                    +
                  </span>
                )}
              </button>
            )}
          </div>
          <div>
            <div className="weapon-name">{def[1]}</div>
            <div className="weapon-meta">
              Size {def[2]} · {AMMO_LABEL[def[4]]}
              {variant ? ` · ${variant.name}` : ""}
            </div>
          </div>
        </div>
        <div className="weapon-slot-side">
          <button className="icon-btn" onClick={() => dispatch(loadoutActions.removeWeapon(slot))}>
            ✕
          </button>
          <div className="weapon-cost">${def[3] + ammoCost}</div>
        </div>
      </div>
      {slots.count > 0 && (
        <div className="ammo-row">
          <span className="panel-meta">AMMO</span>
          {/* `.select-sm` — the dense step of the control scale (issue #134). The inline
              `fontSize: 15.5` this replaces was a local patch over the bare element rule, and
              is exactly the kind of per-site size override the scale exists to retire; only
              the WIDTH stays inline, because it is this slot's layout and nobody else's.

              Governing: ADR-0014, SPEC-0010 REQ "A Weapon Declares Which Rounds It Accepts",
              REQ "Each Ammo Slot Is Individually Labelled and Operable", issue #344, issue
              #346. One `<select>` per entry in `slots.groups` — `slots.count` is 0, 1, or 2,
              so this renders exactly one control for a one-slot weapon (never a second,
              disabled one) and two independently-operable controls for a two-slot weapon.
              Each slot's options come from `slots.groups[slotIndex]` — this weapon's OWN
              accepted rounds for THAT slot, never the shared class pool nor the other
              slot's group — and the value IS the round's stable id, not a positional index.

              `aria-label` gives each control a name a screen reader can use to tell the two
              apart without relying on visual order (WCAG 2.1 AA, SPEC-0001): a bound
              (dual-family) weapon names the slot by the round family it holds — the two
              groups are disjoint, so the families themselves are always distinct — and an
              unbound two-slot weapon (split-reserve; both slots share one group and can
              repeat a round) falls back to an ordinal, since there is no family to
              distinguish them by. A one-slot weapon just gets the weapon's own name.

              `minWidth: 0` overrides a `<select>`'s intrinsic default of `min-width: auto`,
              which otherwise refuses to shrink below its content's natural width no matter
              what `flex` says — invisible with one control in the row (there was always
              slack), but on a two-slot weapon (Drilling, Berthier, Haymaker, Romero, ...) the
              second control had nothing forcing it to respect the row's width and spilled
              past the panel edge at narrow/two-column layouts. Reported as a live bug. */}
          {slots.groups.map((group, slotIndex) => (
            <select
              key={slotIndex}
              className="select-sm"
              aria-label={ammoSlotLabel(def[1], slots, slotIndex)}
              // An unresolved id has no matching <option>, which renders the control on
              // "Standard" without correcting the stored value — see ammoRoundFor's
              // contract: an id the slot's list no longer contains reads back as no round
              // chosen.
              value={w.ammo?.[slotIndex] ?? ""}
              onChange={(e) =>
                dispatch(loadoutActions.setAmmo({ slot, ammoSlotIndex: slotIndex, ammoId: e.target.value || null }))
              }
              style={{ flex: 1, minWidth: 0, maxWidth: 260 }}
            >
              <option value="">Standard</option>
              {group.map((round) => (
                <option key={round.id} value={round.id}>
                  {round.name} (+${round.price ?? 0})
                </option>
              ))}
            </select>
          ))}
        </div>
      )}
      {/* Live region: capacity changes from pairing/unpairing (SPEC-0009 "Operable and
          Named in Every State") and ammo cost changes from either ammo control (issue
          #346, SPEC-0010 REQ "Each Ammo Slot Is Individually Labelled and Operable") are
          both announced here — one region, whichever changed last. Rendered permanently —
          inserting a live region together with its content is the way to get silence from
          a screen reader (same pattern as ActionsPanel.jsx). */}
      <div className="sr-only pair-live-region" role="status" aria-live="polite" aria-atomic="true">
        {announced}
      </div>
    </div>
  );
}
