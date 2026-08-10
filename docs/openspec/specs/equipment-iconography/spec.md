---
status: implemented
date: 2026-08-07
implements: [ADR-0002]
---

# SPEC-0001: Equipment Iconography

## Overview

This capability formalizes the requirements for sourcing and rendering per-item imagery across all four catalog categories in The Outfitter's loadout builder — Weapons, Tools, Traits, and Consumables. It realizes ADR-0002 (which supersedes ADR-0001): item imagery is now primarily sourced by a bounded, ethically-run scrape of huntshowdown.wiki.gg, downloaded once (or re-run periodically as the catalog changes) and self-hosted as static assets — not fetched live at runtime, not hotlinked. The app's existing in-house SVG silhouettes (`THUMBS` + `weaponThumb()` in `client/src/data/catalog.js`, today rendering only Weapons) are retained, but their role changes: they become the fallback tier for any item that doesn't yet have a scraped image, across *all four* categories — including Weapons, whose SVG-only treatment is no longer preserved as a permanent end state now that ADR-0001 is superseded.

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

The system SHALL render an image for items in every catalog category — Weapons, Tools, Traits, and Consumables — everywhere that category's items appear in the UI (equipment slots, weapon slots, trait chips, and picker rows). For each item, the system SHALL render the scraped/self-hosted image when one exists, and SHALL fall back to the item's in-house SVG icon (per-item if defined, else per-category/group) when no scraped image is available yet.

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

- **WHEN** any item image (scraped or SVG fallback) is rendered in a weapon slot, equipment slot, trait chip, or picker row
- **THEN** it MUST be presented within the same fixed-size, bordered container used across those call sites, with `object-fit: contain` (or equivalent) applied to scraped photos so they don't distort or overflow

### Requirement: Attribution

The application SHALL display attribution crediting Crytek and huntshowdown.wiki.gg as the source of scraped imagery.

#### Scenario: Attribution is visible in the footer

- **WHEN** any page of the application is rendered
- **THEN** the footer MUST include the text: "Hunt: Showdown assets © Crytek GmbH, used under Crytek's fan content policy; data via huntshowdown.wiki.gg."

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

Page structure elements MUST include ARIA landmark roles:
- `role="banner"` on the site header
- `role="navigation"` on navigation regions
- `role="main"` on the primary content area
- `role="contentinfo"` on the site footer

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
