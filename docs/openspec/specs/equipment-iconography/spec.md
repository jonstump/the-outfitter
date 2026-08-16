---
status: implemented
date: 2026-08-07
implements: [ADR-0002]
---

# SPEC-0001: Equipment Iconography

## Overview

This capability formalizes the requirements for sourcing and rendering per-item imagery across all four catalog categories in Backwater Outfitters' loadout builder — Weapons, Tools, Traits, and Consumables. It realizes ADR-0002 (which supersedes ADR-0001): item imagery is now primarily sourced by a bounded, ethically-run scrape of huntshowdown.wiki.gg, downloaded once (or re-run periodically as the catalog changes) and self-hosted as static assets — not fetched live at runtime, not hotlinked. The app's existing in-house SVG silhouettes (`THUMBS` + `weaponThumb()` in `client/src/data/catalog.js`, today rendering only Weapons) are retained, but their role changes: they become the fallback tier for any item that doesn't yet have a scraped image, across *all four* categories — including Weapons, whose SVG-only treatment is no longer preserved as a permanent end state now that ADR-0001 is superseded.

**Implementation status.** `status: implemented` describes the **imagery capability only** — the scrape,
the self-hosted assets, the SVG fallback chain, the fixed-aspect containers and the attribution. It does
**not** cover the "Accessibility Requirements" section below, which this spec marks MANDATORY and which
the app does not yet meet. That gap is epic #81, with stories #91 (accessible names, form labels,
heading structure), #92 (widget state, disabled affordances, status announcements) and #93 (text
contrast and focus visibility). Read `implemented` as "the imagery is delivered", never as "this whole
document is satisfied".

## Requirements

### Requirement: Ethical, Self-Hosted Image Sourcing

The system SHALL source item imagery via a bounded, offline scrape of huntshowdown.wiki.gg that respects `robots.txt`, rate-limits its requests, and fetches only the specific images the catalog needs. Downloaded images SHALL be self-hosted as static assets served from the app's own origin. The system SHALL NOT fetch or render images live from huntshowdown.wiki.gg at runtime (no hotlinking), and SHALL NOT run the scrape as part of the app's request path or every CI build.

#### Scenario: Scrape runs offline, not at runtime or in CI

- **WHEN** the application serves a page to a user, or CI runs a build
- **THEN** no HTTP request to huntshowdown.wiki.gg MUST occur as part of that request or build; image fetching only happens via a deliberately-invoked, standalone scrape script

#### Scenario: Scraped images are self-hosted

- **WHEN** an item's image has been scraped
- **THEN** it MUST be stored as a static asset served from the application's own origin, not referenced via a live `<img src="https://huntshowdown.wiki.gg/...">` URL

#### Scenario: Scrape script respects the source site

- **WHEN** the scrape script runs
- **THEN** it MUST honor `robots.txt`, rate-limit its requests, and fetch only images for catalog items — not mirror the wiki wholesale

### Requirement: Image Coverage Across All Catalog Categories, with Fallback

*(amended 2026-08-11 in #227 — "trait chip" is now "trait cell", here and in "Consistent Visual Presentation" below. The traits panel draws a fixed fifteen-cell grid rather than a wrapping row of chips, so the element this requirement enumerated no longer exists under that name. A rename only: the call site, the fallback chain, and the container treatment it asks for are all unchanged, and the tests pinning them survived the rewrite. Recorded rather than silently renamed because an enumerated call-site list is only useful if it names things that exist.)*

The system SHALL render an image for items in every catalog category — Weapons, Tools, Traits, and Consumables — everywhere that category's items appear in the UI (equipment slots, weapon slots, trait cells, and picker rows). For each item, the system SHALL render the scraped/self-hosted image when one exists, and SHALL fall back to the item's in-house SVG icon (per-item if defined, else per-category/group) when no scraped image is available yet.

#### Scenario: Item with a scraped image renders it

- **WHEN** a catalog item (any category, including Weapons) has a self-hosted scraped image available
- **THEN** the system MUST render that image, not the SVG fallback

#### Scenario: Item without a scraped image falls back to the existing SVG icon

- **WHEN** a catalog item has no scraped image available yet
- **THEN** the system MUST render its in-house SVG icon (per-item if one exists, else the per-category/group fallback) rather than omitting imagery, rendering a broken-image indicator, or throwing a rendering error

#### Scenario: Weapons are no longer permanently SVG-only

- **WHEN** a Weapon has a scraped image available
- **THEN** it MUST render that scraped image in place of its `weaponThumb()`-resolved SVG icon; the SVG icon remains available strictly as this item's fallback, not as a permanent end state

### Requirement: Consistent Visual Presentation

Item imagery — whether a scraped photo or an SVG fallback — SHALL be presented within a consistent, fixed-aspect container matching the app's existing slot/row chrome, so photographic images and vector fallbacks read as one coherent system rather than visually clashing.

#### Scenario: Scraped images and SVG fallbacks share the same container treatment

- **WHEN** any item image (scraped or SVG fallback) is rendered in a weapon slot, equipment slot, trait cell, or picker row
- **THEN** it MUST be presented within the same fixed-size, bordered container used across those call sites, with `object-fit: contain` (or equivalent) applied to scraped photos so they don't distort or overflow

### Requirement: Attribution

The application SHALL display attribution crediting Crytek as the rights holder of the game content shown and huntshowdown.wiki.gg as the source of the scraped imagery and data.

#### Scenario: Attribution is visible in the footer

- **WHEN** any page of the application is rendered
- **THEN** the footer MUST state that the site claims no ownership of the game content used, MUST name Crytek GmbH as the holder of the copyrights and/or trademarks in that content, and MUST credit huntshowdown.wiki.gg as the source of the item images, stats and descriptions
- **AND** the footer MUST link Hunt: Showdown (`https://www.huntshowdown.com`), Crytek GmbH (`https://www.crytek.com`), and huntshowdown.wiki.gg (`https://huntshowdown.wiki.gg`)
- **AND** the footer MUST disclaim affiliation with, endorsement by, and sponsorship by Crytek, and MUST NOT assert that the content is used under Crytek's fan content policy

### Requirement: Error Handling Standards

All error-producing operations in the scrape tooling MUST follow structured error handling:

- Errors MUST be wrapped with contextual information at each layer boundary (e.g., "failed to fetch image for Nagant M1895: HTTP 404 at {url}")
- Sentinel errors MUST be defined for domain-specific failure modes the scrape script needs to distinguish programmatically (e.g., "item page not found" vs. "image asset not found on an existing page" vs. "network/rate-limit failure")
- Silent error swallowing MUST NOT occur — every fetch failure MUST be either surfaced in the scrape script's output, logged with sufficient context (item name, URL, failure reason), or explicitly handled with a documented fallback
- Structured logging MUST be used for scrape reporting (e.g., a per-run summary of succeeded/failed/skipped items), not unstructured string interpolation only

#### Scenario: A scrape failure for one item doesn't fail the whole run

- **WHEN** the scrape script fails to fetch or locate an image for a specific catalog item
- **THEN** it MUST log the failure with the item name and reason, continue processing the remaining items, and leave that item on its SVG fallback rather than crashing the entire scrape run

## Accessibility Requirements

This spec involves user-facing UI. The following accessibility requirements are MANDATORY per WCAG 2.1 AA.

### WCAG 2.1 AA Compliance

All UI components produced by this spec MUST meet WCAG 2.1 Level AA conformance as the minimum accessibility target.

### ARIA Landmarks

Page structure elements MUST expose the standard landmarks — `banner` on the site header,
`navigation` on any navigation region, `main` on the primary content area, and `contentinfo` on the
site footer.

**An implicit landmark satisfies this requirement.** *(Revised 2026-08-15.)* This previously required
the explicit `role="…"` attribute in every case. That wording was wrong: `<header>`, `<nav>`, `<main>`
and `<footer>` carry those roles natively, and adding a redundant `role` to an HTML5 sectioning element
is discouraged practice rather than better accessibility. What matters is that the landmark reaches
assistive technology, not which mechanism puts it there.

The app satisfies three of the four this way today — `<header className="app-header">`
(`Header.jsx`), `<main className="app-main">` (`App.jsx`, with a second in `ErrorBoundary.jsx` on a
mutually exclusive render, so no duplicate landmark), and `<footer className="app-footer">`
(`App.jsx`). There is no navigation region, so `navigation` does not apply; it becomes required if one
is ever introduced.

An explicit `role` remains correct where no semantic element fits — a landmark on a `<div>`, for
instance.

### Icon-Only Controls

All icon-only controls (buttons, links) that have no visible text label MUST include an `aria-label` attribute describing the control's purpose. As with the prior revision of this spec, every item image introduced by this capability is paired with a visible text label (item name) in its containing element, so no new icon-only control is introduced.

### Image Alternative Text

Because this revision introduces real photographic imagery (not purely decorative SVG silhouettes), item images MUST carry appropriate `alt` text identifying the item by name (e.g., `alt="Nagant M1895"`), rather than empty/decorative `alt=""`, so screen reader users get equivalent information to sighted users who recognize the weapon/item visually.

### Dynamic Content Regions

Content that changes without a page load MUST use `aria-live` regions. In this application that means the regions React re-renders in place — the picker's result rows as a filter or category changes, the equipment and trait panels as slots fill, and the share/save message banner:
- `aria-live="polite"` for non-urgent updates
- `aria-live="assertive"` for critical status changes

### Keyboard Navigation

All interactive elements MUST be operable via keyboard:
- Logical tab order following visual layout
- Enter/Space to activate buttons and controls
- Escape to dismiss popups, dropdowns, and dialogs
- Arrow keys for navigation within composite widgets (tabs, menus, tree views)

### Focus Management

Modals and dialogs MUST implement focus management:
- Focus MUST be trapped within the modal when open (Tab/Shift+Tab cycles within the modal)
- Focus MUST move to the modal's first focusable element on open
- Focus MUST return to the triggering element when the modal is closed
