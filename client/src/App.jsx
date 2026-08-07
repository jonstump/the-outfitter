import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { loadoutActions } from "./store/loadoutSlice.js";
import { fetchSaved } from "./store/savedLoadoutsSlice.js";
import { readHashLoadout, readStoredLoadout } from "./utils/loadoutCodec.js";
import Header from "./components/Header/Header.jsx";
import WeaponsPanel from "./components/WeaponsPanel/WeaponsPanel.jsx";
import EquipmentPanel from "./components/EquipmentPanel/EquipmentPanel.jsx";
import TraitsPanel from "./components/TraitsPanel/TraitsPanel.jsx";
import ActionsPanel from "./components/ActionsPanel/ActionsPanel.jsx";
import SavedLoadoutsPanel from "./components/SavedLoadoutsPanel/SavedLoadoutsPanel.jsx";
import Picker from "./components/Picker/Picker.jsx";

export default function App() {
  const dispatch = useDispatch();

  useEffect(() => {
    const hydrated = readHashLoadout() || readStoredLoadout();
    if (hydrated) dispatch(loadoutActions.setLoadout(hydrated));
    dispatch(fetchSaved());
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
          <SavedLoadoutsPanel />
        </section>
        <section className="right-column">
          <Picker />
        </section>
      </main>
      <footer className="app-footer">
        Fan-made planner. Sizes, prices and rules are community-compiled approximations of the Update 2.8 loadout
        system (5-point weapon capacity, 6 with Quartermaster; 8 mixed equipment slots, max 4 per consumable type).
        Weapon images are schematic silhouettes, not game assets. Not affiliated with Crytek.
      </footer>
    </div>
  );
}
