import { describe, expect, it } from "vitest";
import { Provider } from "react-redux";
import { act, render } from "@testing-library/react";
import ActionsPanel from "./ActionsPanel.jsx";
import { createTestStore, loadoutState } from "../../test/testStore.js";
import { uiActions } from "../../store/uiSlice.js";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Covers: SPEC-0001 REQ "Accessibility Requirements" (Dynamic Content Regions)
//
// The regression these guard against: the message node used to be rendered only when
// `ui.message` was non-empty, so the live region and its text entered the DOM in the same
// commit and screen readers routinely announced nothing. Both regions must therefore exist
// before any message arrives, and stay put across updates.

function renderPanel(preloadedUi) {
  const store = createTestStore({
    loadout: loadoutState(),
    ...(preloadedUi ? { ui: preloadedUi } : {}),
  });
  const utils = render(
    <Provider store={store}>
      <ActionsPanel />
    </Provider>
  );
  return { ...utils, store };
}

const politeRegion = (c) => c.querySelector('[aria-live="polite"]');
const assertiveRegion = (c) => c.querySelector('[aria-live="assertive"]');

describe("ActionsPanel status messaging", () => {
  it("mounts both live regions before any message exists", () => {
    const { container } = renderPanel();

    const polite = politeRegion(container);
    const assertive = assertiveRegion(container);

    expect(polite).toBeInTheDocument();
    expect(assertive).toBeInTheDocument();
    expect(polite).toHaveAttribute("role", "status");
    expect(assertive).toHaveAttribute("role", "alert");
    expect(polite).toHaveTextContent("");
    expect(assertive).toHaveTextContent("");
  });

  it("announces a success message politely, leaving the assertive region empty", () => {
    const { container, store } = renderPanel();
    const politeBefore = politeRegion(container);

    act(() => store.dispatch(uiActions.setMessage("Saved “Long Hunter”.")));

    // Same node, not a replacement — a swapped-in region would not be announced.
    expect(politeRegion(container)).toBe(politeBefore);
    expect(politeRegion(container)).toHaveTextContent("Saved “Long Hunter”.");
    expect(assertiveRegion(container)).toHaveTextContent("");
  });

  it("sends failures to the assertive region with the ! marker stripped", () => {
    const { container, store } = renderPanel();

    act(() => store.dispatch(uiActions.setMessage("!Couldn't save “Long Hunter”: network down")));

    const assertive = assertiveRegion(container);
    expect(assertive).toHaveTextContent("Couldn't save “Long Hunter”: network down");
    expect(assertive.textContent).not.toContain("!");
    expect(politeRegion(container)).toHaveTextContent("");
  });

  it("keeps both regions mounted after a message is cleared", () => {
    const { container, store } = renderPanel();
    act(() => store.dispatch(uiActions.setMessage("Share link copied to clipboard.")));
    act(() => store.dispatch(uiActions.setMessage("")));

    expect(politeRegion(container)).toBeInTheDocument();
    expect(assertiveRegion(container)).toBeInTheDocument();
    expect(politeRegion(container)).toHaveTextContent("");
  });

  it("marks the assertive region with the error class for the danger colour", () => {
    const { container } = renderPanel();
    expect(assertiveRegion(container)).toHaveClass("share-message", "error");
    expect(politeRegion(container)).toHaveClass("share-message");
    expect(politeRegion(container)).not.toHaveClass("error");
  });
});
