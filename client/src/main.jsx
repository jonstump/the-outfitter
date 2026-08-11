import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "./store";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary/ErrorBoundary.jsx";
import "./styles/global.css";

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
