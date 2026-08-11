---
status: accepted
date: 2026-08-07
decision-makers: [jmstump]
supersedes: [ADR-0001]
---

# ADR-0002: Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time, Self-Hosted Scrape

## Context and Problem Statement

ADR-0001 decided to avoid third-party game art entirely and extend the app's hand-drawn schematic SVG silhouettes to Tools, Traits, and Consumables, on the grounds that Hunt: Showdown's art is Crytek's copyrighted IP, this app has no license to it, and huntshowdown.wiki.gg's own Terms of Service likely prohibit bulk scraping.

That decision rested on an incomplete picture. Further research turned up two facts that change the calculus:

1. Crytek maintains a fan content policy that is permissive toward non-commercial fan tools using Hunt: Showdown assets — this app is exactly that kind of tool and has no plans to commercialize (no ads, no paid tiers, no monetization).
2. "Scraping the wiki" is not one monolithic action with one risk profile — a bounded, one-time (or periodic, on-demand) download that self-hosts the results is a materially different act, both ethically and technically, from continuous live scraping or hotlinking at request time.

Given that, how should item imagery actually be sourced, in a way that's both legitimate under Crytek's fan policy and respectful of huntshowdown.wiki.gg as the source?

## Decision Drivers

* Crytek's fan content policy is understood to permit non-commercial fan-tool use of Hunt: Showdown assets; this app has no commercialization plans, so it fits that use case
* huntshowdown.wiki.gg is still a third party whose infrastructure this app doesn't own — whatever sourcing approach is chosen should minimize load on their servers and not depend on hammering their site at runtime
* Real, recognizable weapon/item art is a meaningfully better user experience than schematic silhouettes — this was the biggest acknowledged downside of ADR-0001's approach
* New DLC weapons/items ship on a regular cadence — the sourcing approach needs a repeatable (not one-off-forever) way to pick up new items
* Giving credit where it's due is both the right thing to do and reduces any residual ambiguity about the app's relationship to the source material
* Reliability and performance — the app's rendering path shouldn't depend on a third party being up at the moment a user loads the page

## Considered Options

* One-time (or periodic, on-demand) scrape script that downloads images and self-hosts them as static assets, with attribution
* Live hotlinking directly at huntshowdown.wiki.gg's image URLs on every page load
* Keep the ADR-0001 schematic SVG icon approach (status quo)
* Commission or hand-produce original licensed art

## Decision Outcome

Chosen option: "One-time (or periodic, on-demand) scrape script that self-hosts the images, with attribution," because it delivers the real, recognizable art users want while keeping the app's interaction with huntshowdown.wiki.gg bounded, infrequent, and low-impact — the "ethically done" scraping this ADR is named for. Self-hosting also keeps the app's own reliability independent of the wiki's uptime, and explicit attribution both credits the source and keeps the app's posture honest about where the art comes from.

This supersedes ADR-0001 in full: the in-house schematic SVG icons are retired as the primary sourcing strategy, not layered alongside real art.

### Consequences

* Good, because users get real, recognizable Hunt: Showdown art instead of abstract silhouettes
* Good, because the scrape is a bounded, repeatable script run — not a live dependency the app takes on for every page view
* Good, because self-hosting means the app works and loads fast regardless of the wiki's availability
* Good, because attribution makes the app's relationship to its source material explicit and honest, consistent with operating under Crytek's fan content policy rather than despite it
* Bad, because the app now has a real (if small) maintenance task: re-running the scrape when new DLC items ship, and re-checking image mappings if the wiki reorganizes
* Bad, because self-hosted images add real asset weight to the app (bundle/storage size, image optimization work) that the zero-network-request SVG approach didn't have
* Bad, because this decision is contingent on Crytek's fan content policy remaining as permissive as currently understood — if that policy changes or was misunderstood, this decision needs to be revisited
* Bad, because the app must now actively maintain "ethical" scraping discipline (rate limiting, respecting `robots.txt`, not re-scraping needlessly) as an ongoing engineering practice, not just a one-time decision

### Confirmation

* The scrape MUST run as an offline/dev-time script, not as part of the app's runtime request path or every CI build — it is invoked deliberately (initial catalog population, then re-run only when new items ship)
* The scrape script MUST respect `robots.txt`, rate-limit its requests, and fetch only the specific item images the catalog needs — not mirror the wiki wholesale
* Downloaded images MUST be committed/cached as static assets served from the app's own origin — no runtime `fetch`/`<img src>` pointed at huntshowdown.wiki.gg
* The app's footer MUST carry attribution that disclaims ownership of the game content shown, names Crytek GmbH as the holder of its copyrights and/or trademarks, credits huntshowdown.wiki.gg as the source of the images and data, and links all three — see SPEC "Equipment Iconography" REQ "Attribution" for the binding wording. The footer MUST NOT claim the content is used *under* Crytek's fan content policy: the policy is a permission the project relies on, not a licence it has been granted, and the footer should not represent it as one
* If Crytek's fan content policy terms become unclear, more restrictive, or are found to not cover this app's use case, this decision MUST be revisited via a new ADR rather than silently continued

## Pros and Cons of the Options

### One-time/periodic self-hosted scrape, with attribution

A script fetches item images from huntshowdown.wiki.gg once (or on-demand when the catalog changes), stores them under e.g. `client/public/images/`, and the app serves them from its own origin. The footer credits Crytek and the wiki.

* Good, because it's real, recognizable art
* Good, because it's a bounded, low-impact interaction with the wiki's infrastructure — not a standing dependency
* Good, because self-hosting means offline reliability and no hotlink-blocking risk
* Neutral, because it requires building and maintaining a scrape script, and re-running it as the catalog grows
* Bad, because it adds real asset weight to the app that the SVG approach didn't have

### Live hotlinking at huntshowdown.wiki.gg

Render `<img src="https://huntshowdown.wiki.gg/...">` on every page load, no local copy.

* Good, because zero storage and no scrape script to maintain
* Bad, because it costs the wiki bandwidth on every single visitor, indefinitely — the opposite of the "bounded, respectful" scraping this ADR aims for
* Bad, because most wiki.gg sites block hotlinking via referrer checks, which can break rendering silently
* Bad, because the app's own reliability becomes coupled to a third party's uptime

### Keep the ADR-0001 schematic SVG icon approach

Continue extending the hand-drawn `THUMBS`-style silhouettes to Tools, Traits, and Consumables instead of using real art.

* Good, because zero asset weight, zero third-party dependency, zero attribution obligations
* Bad, because it's a strictly worse user experience than real art, now that real art is available under an understood-permissive policy
* Bad, because it was chosen specifically to avoid a legal/ethical risk that this ADR concludes doesn't actually apply the way ADR-0001 assumed

### Commission or hand-produce original licensed art

Pay an illustrator, or hand-draw, a polished icon/portrait per catalog item.

* Good, because fully owned/licensed art with no dependency on any third party
* Bad, because it's the slowest and most expensive option, and unnecessary now that legitimate real art is available via the wiki
* Bad, because it doesn't scale to "new DLC ships, need art same week" any better than it did in ADR-0001

## More Information

Supersedes ADR-0001 (Source Weapon/Equipment Images as In-House Schematic Icons, Not Scraped Wiki Assets), which is moved to `status: superseded`. The reversal is driven entirely by corrected understanding of Crytek's fan content policy and a more precise framing of "scraping" as a bounded, self-hosting, attributed action rather than a monolithic legal risk — not by any change in the app's own commercialization plans, which remain none. If those plans ever change, this decision's premise (non-commercial fan use) no longer holds and MUST be revisited.
