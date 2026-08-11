import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { loadoutActions } from "./store/loadoutSlice.js";
import { fetchLists } from "./store/loadoutListsSlice.js";
import { fetchFavorites } from "./store/hunterFavoritesSlice.js";
import { fetchSaved } from "./store/savedLoadoutsSlice.js";
import { readHashLoadout, readStoredLoadout } from "./utils/loadoutCodec.js";
import Header from "./components/Header/Header.jsx";
import WeaponsPanel from "./components/WeaponsPanel/WeaponsPanel.jsx";
import EquipmentPanel from "./components/EquipmentPanel/EquipmentPanel.jsx";
import TraitsPanel from "./components/TraitsPanel/TraitsPanel.jsx";
import ActionsPanel from "./components/ActionsPanel/ActionsPanel.jsx";
import LoadoutListsPanel from "./components/LoadoutListsPanel/LoadoutListsPanel.jsx";
import Picker from "./components/Picker/Picker.jsx";

export default function App() {
  const dispatch = useDispatch();

  useEffect(() => {
    const hydrated = readHashLoadout() || readStoredLoadout();
    if (hydrated) dispatch(loadoutActions.setLoadout(hydrated));
    dispatch(fetchSaved());
    dispatch(fetchLists());
    // Favorites are fetched on boot, not on picker-open: this is what makes them survive a
    // reload (SPEC-0003 REQ "Favorite Hunters"), and it is a single small request that must
    // already have landed by the time the picker sorts by it.
    dispatch(fetchFavorites());
  }, [dispatch]);

  return (
    <div className="app-shell">
      <Header />
      <main className="app-main">
        <section className="left-column">
          <WeaponsPanel />
          <EquipmentPanel />
          <TraitsPanel />
          <ActionsPanel />
        </section>
        <section className="right-column">
          <Picker />
        </section>
        {/* Full-width row beneath both columns: the roster is a grid of cards, so it wants
            the whole page rather than a 400px column. .app-main already wraps, so a
            flex-basis of 100% drops this onto its own line. */}
        <section className="loadouts-row">
          <LoadoutListsPanel />
        </section>
      </main>
      <footer className="app-footer">
        {/* Governing: ADR-0002; Implements: SPEC-0001 REQ "Attribution" */}
        <p>
          Fan-made planner. Sizes, prices and rules are community-compiled approximations of the Update 2.8 loadout
          system (5-point weapon capacity, 6 with Quartermaster; 8 mixed equipment slots, max 4 of each consumable).
          Not affiliated with Crytek.
        </p>
        <p>
          Hunt: Showdown assets © Crytek GmbH, used under Crytek's fan content policy; data via huntshowdown.wiki.gg.
        </p>
      </footer>
    </div>
  );
}
