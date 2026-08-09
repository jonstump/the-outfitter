import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  AMMO_LABEL,
  CONS,
  CONS_GROUPS,
  QM,
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
import { capMax, catCount, slotMax, upTotal } from "../../utils/calc.js";
import { loadoutActions } from "../../store/loadoutSlice.js";
import { uiActions } from "../../store/uiSlice.js";
import { addTraitIfAllowed } from "../../store/thunks.js";
import PickerRow from "./PickerRow.jsx";

const TABS = ["Weapons", "Tools", "Consumables", "Traits"];
const GROUP_SETS = { Weapons: WEAPON_GROUPS, Tools: TOOL_GROUPS, Consumables: CONS_GROUPS, Traits: TRAIT_GROUPS };
const AMMO_FILTERS = {
  Compact: ["compact"],
  Medium: ["medium"],
  Long: ["long"],
  "Special Long": ["slong"],
  Shotgun: ["shotgun"],
  Other: ["none", "bow", "xbow", "hxbow"],
};

function buildRows(tab, ui, loadout, dispatch) {
  const q = ui.search.trim().toLowerCase();
  const match = (n) => !q || n.toLowerCase().includes(q);
  const gOK = (g) => !ui.group || g === ui.group;
  const aOK = (cls) => !ui.ammoF || AMMO_FILTERS[ui.ammoF].includes(cls);

  const max = capMax(loadout);
  const sMax = slotMax(loadout);
  const upSpent = upTotal(loadout);

  if (tab === "Weapons") {
    return WEAPONS.map((w, i) => ({ w, i }))
      .filter((x) => match(x.w[0]) && gOK(x.w[4]) && aOK(x.w[3]) && (!ui.sizeFilter || x.w[1] === ui.sizeFilter))
      .map((x) => {
        const free = loadout.weapons[0] && loadout.weapons[1] ? -1 : loadout.weapons[0] ? 1 : 0;
        const other = free === -1 ? 999 : loadout.weapons[1 - free] ? WEAPONS[loadout.weapons[1 - free].i][1] : 0;
        const fits = free !== -1 && x.w[1] + other <= max;
        return {
          key: x.i,
          name: x.w[0],
          meta: AMMO_LABEL[x.w[3]],
          badge: "Size " + x.w[1],
          badgeColor: "#b08d4f",
          category: "weapons",
          thumb: weaponThumb(x.w),
          costStr: "$" + x.w[2],
          enabled: fits,
          onAdd: () => fits && dispatch(loadoutActions.addWeapon(x.i)),
        };
      });
  }
  if (tab === "Tools") {
    return TOOLS.map((t, i) => ({ t, i }))
      .filter((x) => match(x.t[0]) && gOK(x.t[2]))
      .map((x) => {
        const ok = loadout.equip.length < sMax && !loadout.equip.some((e) => e.t === "T" && e.i === x.i);
        return {
          key: x.i,
          name: x.t[0],
          meta: x.t[2] + " tool · one per loadout",
          badge: "TOOL",
          badgeColor: "#8a6f42",
          category: "tools",
          thumb: toolThumb(x.t),
          costStr: "$" + x.t[1],
          enabled: ok,
          onAdd: () => ok && dispatch(loadoutActions.addEquip({ t: "T", i: x.i })),
        };
      });
  }
  if (tab === "Consumables") {
    return CONS.map((c, i) => ({ c, i }))
      .filter((x) => match(x.c[0]) && gOK(x.c[3]))
      .map((x) => {
        const cnt = catCount(loadout, x.c[2]);
        const ok = loadout.equip.length < sMax && cnt < 4;
        return {
          key: x.i,
          name: x.c[0],
          meta: x.c[3] + " · " + x.c[2] + " · " + cnt + "/4 of type equipped",
          badge: x.c[2].toUpperCase(),
          badgeColor: x.c[2] === "Shot" ? "#7a8a5c" : "#a5674a",
          category: "consumables",
          thumb: consThumb(x.c),
          costStr: "$" + x.c[1],
          enabled: ok,
          onAdd: () => ok && dispatch(loadoutActions.addEquip({ t: "C", i: x.i })),
        };
      });
  }
  return TRAITS.map((t, i) => ({ t, i }))
    .filter((x) => match(x.t[0]) && gOK(x.t[2]))
    .map((x) => {
      const ok = !loadout.traits.includes(x.i) && !(ui.upBudgetOn && upSpent + x.t[1] > ui.upBudget);
      return {
        key: x.i,
        name: x.t[0],
        meta: x.i === QM ? "Raises weapon capacity to 6" : x.t[2] + " trait",
        badge: x.t[1] + " UP",
        badgeColor: "#b08d4f",
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

  // Governing: #23 — search/size/group/ammo filters are transient UI state owned
  // by this panel alone; keeping them here (instead of the global store) means a
  // keystroke in the search box doesn't route through Redux and the filters reset
  // naturally when the tab changes.
  const [search, setSearch] = useState("");
  const [sizeFilter, setSizeFilter] = useState(0);
  const [group, setGroup] = useState("");
  const [ammoF, setAmmoF] = useState("");

  const ui = { tab, search, sizeFilter, group, ammoF };
  const rows = buildRows(tab, ui, loadout, dispatch);
  // Governing: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback" —
  // picker rows show imagery (scraped photo or SVG fallback) on all four tabs, not just Weapons.
  const showThumb = true;

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
          <PickerRow key={row.key} row={row} showThumb={showThumb} />
        ))}
        {rows.length === 0 && <div className="picker-empty">Nothing matches.</div>}
      </div>
    </>
  );
}
