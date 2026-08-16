import React from "react";
import { clearStoredLoadout } from "../../utils/loadoutCodec.js";

/**
 * Governing: issue #201.
 *
 * The last line of defense for a build the app cannot render.
 *
 * Issue #201 was a crafted share link whose weapon carried an ammo index past the end of
 * that weapon's variant list. The decoder now rejects it, so that specific route is closed —
 * but the reason it was worth more than a tab crash is structural, and outlives the one bad
 * field: the in-progress build is persisted to localStorage during the same dispatch that
 * decodes it, BEFORE React renders it. Anything that throws while rendering persisted state
 * therefore throws again on the next visit, with no hash to remove and nothing on screen to
 * click. The only recovery was clearing site data, which also destroys the user's build.
 *
 * A boundary turns that permanent blank page into a screen with a way out. It is deliberately
 * not a retry: re-rendering the same state fails the same way, so the offer is to discard the
 * build that cannot be drawn. Saved loadouts are server-side and untouched — what is dropped
 * is the current build and the fragment that may have supplied it.
 *
 * A class component because that is the only thing React gives us: there is no hook form of
 * componentDidCatch, and nothing in this file is expected to grow beyond it.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    // Logged, not shown. The message is a stack from a minified bundle — it tells the user
    // nothing they can act on, and the console is where anyone who can act on it looks.
    console.error("Backwater Outfitters failed to render:", error, info?.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="app-shell">
        <main className="app-main">
          <section className="panel" role="alert">
            <div className="panel-header">
              <h2 className="panel-title">This build could not be loaded</h2>
            </div>
            <p className="empty-note">
              Something in the current build stopped the planner from drawing it — most often a
              share link that was edited by hand. Discarding it starts you over with an empty
              loadout. Your saved loadouts and lists are not affected.
            </p>
            <button
              className="btn-primary"
              type="button"
              onClick={() => {
                clearStoredLoadout();
                location.reload();
              }}
            >
              Discard this build and reload
            </button>
          </section>
        </main>
      </div>
    );
  }
}
