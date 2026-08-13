## Architecture Context

This project uses the [SDD plugin](https://github.com/joestump/claude-plugin-sdd) for architecture governance.

- Architecture Decision Records are in `docs/adrs/`
- Specifications are in `docs/openspec/specs/`

### qmd Dependency

Starting with SDD plugin v5.0.0, [qmd](https://github.com/tobi/qmd) is a hard dependency — `/sdd:init` enforces qmd presence at setup, and every qmd-aware consumer skill (`/sdd:prime`, `/sdd:check`, `/sdd:audit`, `/sdd:discover`, `/sdd:adr`, `/sdd:spec`, `/sdd:plan`, `/sdd:work`, `/sdd:review`) MAY assume qmd is installed and MUST NOT include conditional fallback paths. If a skill needs to handle "qmd installed but this repo not yet indexed", it routes to `/sdd:index` rather than silently degrading. This invariant lets every skill be designed for hybrid retrieval rather than around its absence.

### SDD Skills

| Skill | Purpose |
|-------|---------|
| `/sdd:adr` | Create a new Architecture Decision Record (ADR) using MADR format |
| `/sdd:spec` | Create a specification with requirements, scenarios, and design rationale |
| `/sdd:list` | List all architecture decisions and specs with their status |
| `/sdd:status` | Change the status of an ADR or spec (e.g., proposed to accepted, draft to… |
| `/sdd:docs` | Generate a documentation site from your ADRs and specs |
| `/sdd:init` | Set up CLAUDE.md with SDD plugin references for architecture-aware sessions |
| `/sdd:prime` | Load ADR and spec context into the session for architecture-aware responses |
| `/sdd:check` | Quick-check code against ADRs and specs for drift |
| `/sdd:audit` | Comprehensive audit of design artifact alignment across the project |
| `/sdd:discover` | Discover implicit architectural decisions and spec-worthy subsystems in an… |
| `/sdd:plan` | Break an existing spec into trackable issues in your issue tracker |
| `/sdd:organize` | Retroactively group existing issues into tracker-native projects |
| `/sdd:enrich` | Retroactively add branch naming and PR convention sections to existing issue… |
| `/sdd:work` | Pick up tracker issues and implement them in parallel using git worktrees |
| `/sdd:review` | Review and merge PRs produced by /sdd:work using reviewer-responder agent pairs |
| `/sdd:graph` | Build and query the SDD artifact graph |
| `/sdd:index` | Index a repository's ADRs, OpenSpec specs, and source code into qmd collections… |
| `/sdd:report-friction` | File a feedback issue against the SDD plugin (joestump/claude-plugin-sdd) when… |
| `/sdd:respond` | Respond to review feedback on a PR — gather review comments, requested changes,… |
| `/sdd:search` | Unified semantic exploration skill combining qmd hybrid retrieval with cgg call… |

Run `/sdd:prime [topic]` at the start of a session to load relevant ADRs and specs into context.

### Governing Comments

When implementing code governed by ADRs or specs, leave comments referencing the governing artifacts:

```
// Governing: ADR-0001 (chose JWT over sessions), SPEC-0003 REQ "Token Validation"
```

These comments help future sessions (and `/sdd:check`) trace implementation back to decisions.

### Workflow

1. **Decide**: `/sdd:adr` — record the architectural decision
2. **Specify**: `/sdd:spec` — formalize requirements with RFC 2119 language
3. **Plan**: `/sdd:plan` — break the spec into trackable issues in your tracker
4. **Enrich**: `/sdd:organize` and `/sdd:enrich` — add projects and branch conventions
5. **Build**: `/sdd:work` — pick up issues and implement in parallel using git worktrees
6. **Review**: `/sdd:review` — review and merge PRs with spec-aware code review
7. **Validate**: `/sdd:check` and `/sdd:audit` to catch drift

### Session Coordination

When orchestrating multiple SDD plugin skills in a single session (e.g., running `/sdd:work` on several issues), use `TeamCreate` to coordinate agents. Do not spawn ad-hoc background agents for work that requires coordination — `SendMessage` only works within a Team, and isolated agents cannot see sibling file claims or type creations.

### SDD Configuration

#### Tracker

- **Type**: github
- **Owner**: jonstump
- **Repo**: the-outfitter

#### Coding Models

Tickets are implemented by the models below — not by Opus. `/sdd:plan` and `/sdd:enrich` MUST size stories and write issue bodies for the *weakest* implementer in this list, not the strongest.

| Model | Identifier | Context | Role |
|-------|-----------|---------|------|
| Claude Sonnet 5 | `claude-sonnet-5` | 1M | Default for most stories |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K | Mechanical and well-scoped stories |
| DeepSeek V4 Flash 0731 | `deepseek-v4-flash-0731` | 1M | Non-Anthropic; runs outside Claude Code. Output cap 384K |

**Context is 1M; 384K is the output cap.** The serving provider's published spec lists a 1.0M context window, and the separately reported `max_tokens: 384000` is the per-response output ceiling — two different limits, both true, which is why an earlier revision of this row briefly recorded 384K as the window. The identifier remains self-reported rather than taken from a published reference; the context figure is not.

Neither number changes the sizing guidance below, because both exceed Haiku's 200K.

What this changes about planning:

- **Issue bodies must stand alone.** A non-Anthropic implementer runs outside Claude Code, so its agent sees none of this: not this file, not the SDD skills, not the qmd index, not the ADRs unless the issue quotes them. Name every file by path, state the governing ADR/spec constraint inline rather than by reference alone, and give the exact test command. `/sdd:plan`'s "extend `X` in `path/to/file`" framing is the floor here, not a nicety.
- **Size to the low end.** Prefer the ~150–300 line PR target over 200–500 even for greenfield stories, and split rather than stretch. The 3–4-stories-per-spec grouping may need to become 5–6.
- **Haiku's 200K window is the binding ceiling — now confirmed, not assumed.** Sonnet and DeepSeek both carry 1M windows, so Haiku 4.5 has the smallest of the three by a factor of five, and sizing to it sizes to all of them. A story whose working set is `spec.md` + `design.md` + `catalog.js` + a test file can exceed 200K on its own. Keep each story's file list short enough that the issue body fits alongside it.
- **Assume nothing is inferred.** Do not rely on the implementer noticing a load-bearing comment, a sibling test, or a wire-format invariant. If a constraint matters, it goes in the issue body.

No SDD skill reads this section yet — `/sdd:work` dispatches to `general-purpose` with no model override, and `/sdd:plan` has no model input. This is guidance for whoever runs those skills. If the skills should honour it directly, that is a plugin change (`/sdd:report-friction`).

#### Projects

- **Default Mode**: per-epic
- **Views**: All Work (table), Board (board), Roadmap (roadmap)
- **Iteration Weeks**: 2

Cached project IDs (reused by `/sdd:plan` and `/sdd:organize` instead of creating duplicates):

| Spec | Project | Number | ID |
|------|---------|--------|-----|
| SPEC-0002 | SPEC-0002: Developer Environment Consistency | 1 | `PVT_kwHOA4k1ys4Bf4Mk` |
| SPEC-0003 | SPEC-0003: Hunter Loadout Lists | 2 | `PVT_kwHOA4k1ys4Bf478` |
| SPEC-0004 | SPEC-0004: Hunter Roster Dataset | 3 | `PVT_kwHOA4k1ys4Bf5nO` |
| SPEC-0007 | SPEC-0007: Equipment Catalog Dataset | 4 | `PVT_kwHOA4k1ys4Bf_8Z` |
| SPEC-0006 | SPEC-0006: Equipment Slot Arrangement | 6 | `PVT_kwHOA4k1ys4BgOAX` |
| SPEC-0008 | SPEC-0008: Loadout Randomization | 5 | `PVT_kwHOA4k1ys4BgEvL` |
