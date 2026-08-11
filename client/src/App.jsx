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
import RandomizerPanel from "./components/RandomizerPanel/RandomizerPanel.jsx";
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
          {/* Traits and the randomizer share a row rather than stacking. Three reasons: it
              takes a panel's worth of height out of the page, it gives the randomizer room to
              grow into (SPEC-0008 replaces it with archetype-driven generation), and it
              narrows the traits grid — whose art is 64px native and was being upscaled at
              full column width.

              Only the randomizer moved. Budget, save and share stayed in ActionsPanel below,
              at full width: four control groups in a 280px column wrapped every one of them. */}
          <div className="build-row">
            <TraitsPanel />
            <RandomizerPanel />
          </div>
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
        </p>
        <p>
          This is a fan page for{" "}
          <a href="https://www.huntshowdown.com" target="_blank" rel="noreferrer">
            Hunt: Showdown
          </a>{" "}
          whose only purpose is to help players build better loadouts. It is not affiliated with, endorsed by, or
          sponsored by Crytek.
        </p>
        <p>
          This site claims no ownership of any game content used here. Copyrights and/or trademarks of the images,
          names and statistics shown belong to{" "}
          <a href="https://www.crytek.com" target="_blank" rel="noreferrer">
            Crytek GmbH
          </a>
          . Item images, stats and descriptions are sourced from{" "}
          <a href="https://huntshowdown.wiki.gg" target="_blank" rel="noreferrer">
            huntshowdown.wiki.gg
          </a>
          .
        </p>
      </footer>
    </div>
  );
}
