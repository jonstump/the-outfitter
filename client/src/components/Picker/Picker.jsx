import { useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  AMMO_LABEL,
  CONS,
  CONS_GROUPS,
  CONS_TYPE_COLOR,
  TOOLS,
  TOOL_GROUPS,
  TRAITS,
  TRAIT_GROUPS,
  WEAPONS,
  WEAPON_GROUPS,
  consThumb,
  toolThumb,
  traitThumb,
  weaponThumb,
} from "../../data/catalog.js";
import { descriptionFor } from "../../data/itemStats.js";
import { capMax, consAllowed, consCategoryCount, hasFreeCell, upTotal } from "../../utils/calc.js";
import { loadoutActions } from "../../store/loadoutSlice.js";
import { uiActions } from "../../store/uiSlice.js";
import { addTraitIfAllowed } from "../../store/thunks.js";
import PickerRow from "./PickerRow.jsx";

const TABS = ["Weapons", "Tools", "Consumables", "Traits"];
const GROUP_SETS = { Weapons: WEAPON_GROUPS, Tools: TOOL_GROUPS, Consumables: CONS_GROUPS, Traits: TRAIT_GROUPS };
// Governing: issue #361
export const AMMO_FILTERS = {
  Compact: ["compact"],
  Medium: ["medium"],
  Long: ["long"],
  "Special Long": ["slong"],
  Shotgun: ["shotgun"],
  // "special" is included here so the "Other" chip stays exhaustive over every
  // ammoClass value the catalog carries (see the exhaustiveness test in
  // Picker.test.jsx) — without it, every special-class weapon vanished from the
  // Weapons tab whenever any ammo filter chip was active.
  Other: ["none", "bow", "xbow", "hxbow", "special"],
};

function buildRows(tab, ui, loadout, dispatch) {
  const q = ui.search.trim().toLowerCase();
  const match = (n) => !q || n.toLowerCase().includes(q);
  const gOK = (g) => !ui.group || g === ui.group;
  const aOK = (cls) => !ui.ammoF || AMMO_FILTERS[ui.ammoF].includes(cls);

  const max = capMax(loadout);
  // Capacity is the single shared predicate (SPEC-0006 REQ "Capacity Rules Are Stated
  // Once and Preserved"): the same "free, unblocked cell exists" check the reducer
  // enforces, so an item the picker shows as available can never be refused.
  const room = hasFreeCell(loadout);
  const upSpent = upTotal(loadout);

  if (tab === "Weapons") {
    return WEAPONS.map((w, i) => ({ w, i }))
      .filter((x) => match(x.w[1]) && gOK(x.w[5]) && aOK(x.w[4]) && (!ui.sizeFilter || x.w[2] === ui.sizeFilter))
      .map((x) => {
        const free = loadout.weapons[0] && loadout.weapons[1] ? -1 : loadout.weapons[0] ? 1 : 0;
        const other = free === -1 ? 999 : loadout.weapons[1 - free] ? WEAPONS[loadout.weapons[1 - free].i][2] : 0;
        const fits = free !== -1 && x.w[2] + other <= max;
        return {
          key: x.i,
          name: x.w[1],
          meta: AMMO_LABEL[x.w[4]],
          badge: "Size " + x.w[2],
          badgeColor: "#c4a05e",
          category: "weapons",
          thumb: weaponThumb(x.w),
          costStr: "$" + x.w[3],
          enabled: fits,
          onAdd: () => fits && dispatch(loadoutActions.addWeapon(x.i)),
        };
      });
  }
  if (tab === "Tools") {
    return TOOLS.map((t, i) => ({ t, i }))
      .filter((x) => match(x.t[1]) && gOK(x.t[3]))
      .map((x) => {
        // Governing: ADR-0009 (index is the cell, `null` is an empty cell), SPEC-0006 REQ
        // "Equipment Occupies a Fixed Eight-Cell Grid". `equip` is a fixed eight-cell
        // SPARSE array, so the duplicate-tool check must skip empty cells — reading
        // `e.t` off a `null` entry outside `room`'s short-circuit crashes the row map
        // (#295). A tool is already equipped only if a NON-EMPTY cell holds it.
        const ok = room && !loadout.equip.some((e) => e && e.t === "T" && e.i === x.i);
        return {
          key: x.i,
          name: x.t[1],
          meta: x.t[3] + " tool · one per loadout",
          badge: "TOOL",
          badgeColor: "#8a6f42",
          category: "tools",
          thumb: toolThumb(x.t),
          costStr: "$" + x.t[2],
          enabled: ok,
          onAdd: () => ok && dispatch(loadoutActions.addEquip({ t: "T", i: x.i })),
        };
      });
  }
  if (tab === "Consumables") {
    return CONS.map((c, i) => ({ c, i }))
      .filter((x) => match(x.c[1]) && gOK(x.c[4]))
      .map((x) => {
        // Governing: ADR-0015 (four per type, not four per specific item), SPEC-0006 REQ
        // "Capacity Rules Are Stated Once and Preserved". The count shown and the gate
        // applied both come from the per-CAP-CATEGORY rule: four Vitality Shots read as
        // 4/4 Shot and disable EVERY Shot, Stamina Shot included.
        const cnt = consCategoryCount(loadout, x.i);
        const ok = room && consAllowed(loadout, x.i);
        return {
          key: x.i,
          name: x.c[1],
          meta: x.c[4] + " · " + x.c[3] + " · " + cnt + "/4 of type",
          badge: x.c[3].toUpperCase(),
          // Governing: #155. Shared with EquipmentSlot via catalog.js rather than duplicated here —
          // the two-branch copies would both have rendered `Placeable` as `Throwable`.
          badgeColor: CONS_TYPE_COLOR[x.c[3]] ?? CONS_TYPE_COLOR.Throwable,
          category: "consumables",
          thumb: consThumb(x.c),
          costStr: "$" + x.c[2],
          enabled: ok,
          onAdd: () => ok && dispatch(loadoutActions.addEquip({ t: "C", i: x.i })),
        };
      });
  }
  return TRAITS.map((t, i) => ({ t, i }))
    .filter((x) => match(x.t[1]) && gOK(x.t[3]))
    .map((x) => {
      const ok = !loadout.traits.includes(x.t[0]) && !(ui.upBudgetOn && upSpent + x.t[2] > ui.upBudget);
      return {
        key: x.i,
        name: x.t[1],
        // The scraped description, falling back to the group label. Until #228 this row showed
        // `x.t[3] + " trait"` for every trait but Quartermaster, so "Combat trait" and "Medical trait"
        // read as descriptions while being the `group` field with a word appended — and
        // Quartermaster's real prose was hand-written here, which also meant it went stale: the wiki
        // says "Gain +1 Weapon Capacity", not "Raises weapon capacity to 6".
        //
        // The fallback stays because `descriptionFor` is specified to return null (a catalog row can
        // predate the dataset), and a row with no meta at all reads as a rendering fault.
        meta: descriptionFor(x.t[0]) ?? x.t[3] + " trait",
        // "pts", not "UP" — the app names this unit "Trait points" in the header, and the
        // badge is the only cost signal on a trait row (traits have no dollar cost, so
        // `costStr` is empty), so unlike the header stat and the trait-cell hover the number
        // can't simply lose its unit here. Singular at 1 so the cheapest traits don't read
        // "1 pts".
        badge: x.t[2] + (x.t[2] === 1 ? " pt" : " pts"),
        badgeColor: "#c4a05e",
        category: "traits",
        thumb: traitThumb(x.t),
        costStr: "",
        enabled: ok,
        onAdd: () => dispatch(addTraitIfAllowed(x.i)),
      };
    });
}

export default function Picker() {
  const dispatch = useDispatch();
  const loadout = useSelector((s) => s.loadout);
  const tab = useSelector((s) => s.ui.tab);
  // UP-budget flags stay in Redux (#23) and are read by buildRows's Traits-tab
  // affordability gate — they must be re-included here or the gate silently
  // disables (upBudgetOn becomes undefined).
  const upBudgetOn = useSelector((s) => s.ui.upBudgetOn);
  const upBudget = useSelector((s) => s.ui.upBudget);

  // Governing: #23 — search/size/group/ammo filters are transient UI state owned
  // by this panel alone; keeping them here (instead of the global store) means a
  // keystroke in the search box doesn't route through Redux and the filters reset
  // naturally when the tab changes.
  const [search, setSearch] = useState("");
  const [sizeFilter, setSizeFilter] = useState(0);
  const [group, setGroup] = useState("");
  const [ammoF, setAmmoF] = useState("");

  const ui = { tab, search, sizeFilter, group, ammoF, upBudgetOn, upBudget };
  // Governing: #25 — buildRows re-filters/remaps the entire active catalog array
  // (up to ~40 weapon rows) and would otherwise run on every single render,
  // including renders triggered by changes that don't affect the row list. Keyed
  // on the exact ui/loadout fields it reads (local filter state + Redux-backed
  // up-budget flags); dispatch is stable.
  const rows = useMemo(
    () => buildRows(tab, ui, loadout, dispatch),
    [tab, search, sizeFilter, group, ammoF, upBudgetOn, upBudget, loadout, dispatch]
  );
  // Governing: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback" —
  // picker rows show imagery (scraped photo or SVG fallback) on all four tabs, not just Weapons.
  const showThumb = true;
  // Weapon art is a wide silhouette; tools, consumables, and traits are roughly square.
  const thumbVariant = tab === "Weapons" ? "wide" : "square";

  return (
    <>
      <div className="picker-tabs">
        {TABS.map((label) => (
          <button
            key={label}
            className={`picker-tab${tab === label ? " active" : ""}`}
            onClick={() => {
              dispatch(uiActions.setTab(label));
              setSearch("");
              setGroup("");
              setAmmoF("");
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="picker-search-row">
        <input
          className="text-input picker-search-input"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {tab === "Weapons" && (
          <span className="picker-size-chips">
            <span className="picker-filter-label">SIZE</span>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={`size-chip${sizeFilter === n ? " active" : ""}`}
                onClick={() => setSizeFilter(n)}
              >
                {n === 0 ? "All" : n}
              </button>
            ))}
          </span>
        )}
      </div>

      <div className="picker-filter-row">
        <span className="picker-filter-label">FILTER</span>
        {[""].concat(GROUP_SETS[tab]).map((g) => (
          <button
            key={g || "all"}
            className={`chip${group === g ? " active" : ""}`}
            onClick={() => setGroup(g)}
          >
            {g || "All"}
          </button>
        ))}
      </div>

      {tab === "Weapons" && (
        <div className="picker-filter-row">
          <span className="picker-filter-label">AMMO</span>
          {[""].concat(Object.keys(AMMO_FILTERS)).map((a) => (
            <button
              key={a || "all"}
              className={`chip${ammoF === a ? " active" : ""}`}
              onClick={() => setAmmoF(a)}
            >
              {a || "All"}
            </button>
          ))}
        </div>
      )}

      <div className="picker-list">
        {rows.map((row) => (
          <PickerRow key={row.key} row={row} showThumb={showThumb} thumbVariant={thumbVariant} />
        ))}
        {rows.length === 0 && <div className="picker-empty">Nothing matches.</div>}
      </div>
    </>
  );
}
