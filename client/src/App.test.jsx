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

  // The attribution is asserted element by element rather than as one exact sentence: the copy is
  // split across links now, so a single string match would break on wording the requirement doesn't
  // pin down. What the requirement does pin down is who is named, who is linked, and where.
  it("names Crytek as rights holder and the wiki as the data source, inside the app footer", () => {
    const store = createTestStore();
    const { container } = render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    const footer = container.querySelector("footer.app-footer");
    expect(footer).toBeInTheDocument();
    expect(footer.textContent).toContain("This site claims no ownership of any game content used here");
    expect(footer.textContent).toContain("Crytek GmbH");
    expect(footer.textContent).toContain("sourced from");
    expect(footer.textContent).toContain("huntshowdown.wiki.gg");
  });

  it("links Hunt: Showdown, Crytek and the wiki from the footer", () => {
    const store = createTestStore();
    const { container } = render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    const footer = container.querySelector("footer.app-footer");
    const hrefs = [...footer.querySelectorAll("a")].map((a) => a.getAttribute("href"));

    expect(hrefs).toContain("https://www.huntshowdown.com");
    expect(hrefs).toContain("https://www.crytek.com");
    expect(hrefs).toContain("https://huntshowdown.wiki.gg");
  });

  it("disclaims affiliation with Crytek without invoking a fan content policy", () => {
    const store = createTestStore();
    const { container } = render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    const footer = container.querySelector("footer.app-footer");
    expect(footer.textContent).toContain("not affiliated with, endorsed by, or sponsored by Crytek");
    expect(footer.textContent).not.toContain("fan content policy");
  });
});
