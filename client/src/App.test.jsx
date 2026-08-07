import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Provider } from "react-redux";
import { render } from "@testing-library/react";
import App from "./App.jsx";
import { createTestStore } from "./test/testStore.js";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Covers: SPEC-0001 REQ "Attribution"
//
// App mounts and, via useEffect, dispatches fetchSaved() -> GET /api/loadouts. There's no backend
// in this test environment, so global fetch is stubbed to resolve with an empty list — the point
// of this test is the footer's attribution copy, not the saved-loadouts network flow (which has
// its own coverage elsewhere/is out of scope for issue #9).
describe("App footer attribution", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the exact Crytek/wiki.gg attribution string", () => {
    const store = createTestStore();
    const { getByText } = render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    expect(
      getByText(
        "Hunt: Showdown assets © Crytek GmbH, used under Crytek's fan content policy; data via huntshowdown.wiki.gg."
      )
    ).toBeInTheDocument();
  });

  it("renders the attribution inside the app footer", () => {
    const store = createTestStore();
    const { container } = render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    const footer = container.querySelector("footer.app-footer");
    expect(footer).toBeInTheDocument();
    expect(footer.textContent).toContain(
      "Hunt: Showdown assets © Crytek GmbH, used under Crytek's fan content policy; data via huntshowdown.wiki.gg."
    );
  });
});
