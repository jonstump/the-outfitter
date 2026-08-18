import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "./store";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary/ErrorBoundary.jsx";
import "./styles/global.css";

// Governing: SPEC-0003 "Security Headers" (found via `/sdd:audit` 2026-08-17). Swaps
// index.html's deferred Google Fonts stylesheet from `media="print"` to `media="all"`
// once it loads — moved here from an inline `onload="..."` attribute, which a strict
// Content-Security-Policy blocks (inline event handlers are a `script-src` concern; this
// app's CSP carries no `unsafe-inline` for scripts). See index.html's comment for why the
// stylesheet is deferred in the first place.
//
// `.sheet` covers the race an event listener alone would miss: fonts.googleapis.com is
// typically fast, and this module script can start running AFTER the link already
// finished loading (module scripts are deferred by the HTML spec; a `<link>` in <head> is
// not). A stylesheet that has already loaded exposes a non-null `.sheet`; the `load` event
// that already fired is not something `addEventListener` can retroactively observe.
const deferredFonts = document.getElementById("deferred-fonts");
if (deferredFonts) {
  if (deferredFonts.sheet) {
    deferredFonts.media = "all";
  } else {
    deferredFonts.addEventListener("load", () => {
      deferredFonts.media = "all";
    });
  }
}

// The boundary sits INSIDE the Provider (it offers to discard persisted state, so the store
// must exist to be rendered around) and outside App, so that a throw anywhere in the tree —
// not just in the panel that threw for issue #201 — degrades to a recoverable screen instead
// of an empty <div id="root">.
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Provider store={store}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </Provider>
  </React.StrictMode>
);
