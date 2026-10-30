# Guided builder — local implementation status

This is an opt-in prototype at `/static/guided-builder.html`. The classic builder remains available. It is not a complete production implementation of the professor's proposal.


## October 30 audit against the revised builder-flow v2 PDF

Source: `New builder flow_ building a game step by step (1).pdf`, all ten pages.
The new first page adds tutorial step 4.5, an extensible verification pipeline, and
an i18n API that allows additional languages without changing generated game code.

| Requirement | Current local implementation | Remaining |
| --- | --- | --- |
| 1 Understanding | Saved conversation, clarification proposals, explicit approval | Live-model quality and latency verification |
| 2 Identity | Name/description proposal and approval | Live-model verification |
| 3 Logic rules | Readable rules and extracted player/join/leave settings | Live-model verification and automatic routing of later corrections |
| 4 UI rules | Readable responsive/RTL/UI specification | Live-model verification |
| 4.5 Tutorial | Not implemented | Generate, approve, persist and preview a self-contained responsive tutorial iframe |
| 5 Images | Validated SVG proposals and preview | Enforce cover constraints beyond prompting, connect published image artifacts to catalog, propagate visual corrections back to UI rules |
| 6 Schemas/examples | Schema validation, saved examples, four previews per case, exact regression tests | Route corrections into affected specs; live-model verification |
| 7 Build/verify | Three code attempts, example checks, schema-aware random walks, one server review, viewport renders, sampled visual review, final approval | Extensible stage runner, narrow reviewers, wider UI/interaction coverage, review-failure repair, approved-test correction/reapproval, actual cost cap |
| Translation | Eight-language spec translation request; generated client tables requested | Integrate platform i18n API and verify client string coverage; avoid hard-coded language lists |
| Resume/revise | Saved artifacts/history, stale flags, reload recovery | Reapprove only changed artifacts, robust restart recovery, published-game editing flow and admin bulk migration |

The additional invariant generation, coverage-directed walks, third-party testing,
and real-world bug reports on page 1 are examples of future pipeline stages. The
immediate architectural requirement is to make adding stages straightforward; it
does not establish that every example must ship now.

The PDF's randomness section still proposes successfully aborting examples that
use ctx.random. The current implementation instead checks exact results with a
fixed seed. This is an explicit unresolved specification difference, not completed
compliance. SVG-based mockups are allowed by the PDF's image-generation discussion.

No completion percentage is claimed: the final build/review stage is much larger
than the early proposal stages. Stages 1–4 have implemented paths, 5–7 are partial,
and 4.5 is missing. No complete live Muse build has passed yet.

### Repository state and next implementation order

Work is on local `codex/guided-builder-flow`, still uncommitted. Its base is
`10902cb`; upstream main was `89c15f5` at audit time (80 intervening commits).
Existing local iOS edits and previously shipped avatar / duplicate cache fixes
remain in the workspace. Preserve these while isolating the builder patch and
reconciling against current main before further integration testing. No builder
code was pushed. The fully merged `codex/responsive-match-page` branch was deleted.

Next: reconcile with main; add tutorial and integrate current game i18n support;
refactor the worker into explicit stages and complete review/repair and budgets;
finish artifact correction and publishing integration; run offline and live tests.
Durable jobs/storage and deployment load controls are operational hardening beyond
merely being able to close a browser tab, and should be tracked separately.

### Where the Muse key is used

Browser -> authenticated workflow endpoint in builder_api.py -> server-side
ModelApiClient -> Meta API. The browser never needs the key. Proposal calls happen
in propose_step; generation and reviewer calls in run_build; final-approval calls
translate specifications. Schema checks, unit tests and browser rendering are
local computation and do not themselves use a model key.

The client currently chooses a nonempty config api_key first, otherwise
MUSE_SPARK_API_KEY from the server process environment. Its module docstring says
the opposite precedence; the actual constructor is authoritative. Use a private
local configuration with no inline key and an environment variable for testing.
Do not put credentials in source control, draft artifacts, browser storage or chat.
The VM check confirmed a nonempty config key, not its validity, quota, allowed use,
or model override. Acquiring/testing that credential is deferred at the user's request.

## Implemented

- Six saved, explicit approval stages: understanding, identity, logic rules, UI rules, SVG images, and schema-backed visual examples.
- Owner-only draft access, optimistic revision checks, artifact history, and invalidation of later approvals after earlier changes.
- Background generation with a ten-minute deadline, request-size/token reservation bound, and up to three code attempts. Closing the browser does not cancel a running server process.
- Exact example tests, repeated deterministic calls with the same seed, JSON Schema checks, and schema-checked random walks. Randomized games do not silently bypass tests.
- Independent server review and sandboxed client renders across six viewport sizes, LTR/RTL, and four views per example. Sampled AI screenshot comparison.
- Human play/review approval followed by eight-language specification translation and an explicit publish action. Generated client localization is requested in the prompt, not independently guaranteed.
- Publishing rejects changed approved metadata, rules, code, or specifications. `/games/test` also rechecks saved examples for guided games.
- Readable game rules exposed in the portal; summary lists omit these heavier fields.

## Validation and its limits

`tests/test_builder_flow.py` tests approval ordering, stale artifacts, ownership, persistence, schema/image safety, missing model credentials, exact examples, cancellation, and publishing protections. The background-worker test uses a model stub and renderer stub: it does not prove live generation works.

`e2e/guided-builder.spec.ts` checks draft creation/reload, approval gating, small-screen layout, and a simulated provider error. Existing play/avatar browser tests were also run.

A known Count-to-three fixture was rendered by a real browser into 144 views (3 cases × 6 sizes × 2 directions × 4 views), plus 12 approved mockup PNGs. This demonstrates rendering infrastructure, not the quality of an AI-generated game. Browser checks detect JavaScript errors, horizontal overflow, blank output, and small targets; they do not establish full usability or visual equivalence.

The backend suite exposed an existing timing-sensitive test: `test_a_call_can_raise_the_time_limit_for_itself` assumes a finite loop exceeds 100 ms, which is not true on this machine. Its failure is retained rather than reported as passing.

No live model generation was run: the local server has no configured provider key. Never commit credentials or copy keys into chat.

## Setup and manual walkthrough

Install project Python dependencies (including jsonschema), Node dependencies and a Playwright Chromium browser. `PLAYWRIGHT_CHANNEL=chrome` selects an installed Chrome for local rendering. Use the existing server model configuration for provider access.

1. Open the guided builder and sign in; create a new game.
2. Describe a small game. Review and approve each proposal explicitly.
3. Revise an earlier stage and confirm later stages become stale.
4. Approve all six stages and build. Reload the page and inspect status.
5. Inspect rendered screenshots, open the correct draft in the classic emulator, and play.
6. Give final approval, review translation completion, and publish only when intended. Publishing changes the connected server's data.

Use isolated local data for this walkthrough. Screenshots are written to `.builder-artifacts/` (gitignored); `BUILDER_ARTIFACT_DIR` overrides this location.

## Remaining before claiming the full proposal

- A real provider run of every stage, translation quality, client localization, and failure/repair handling.
- Durable worker queue and recovery after server restart; current daemon jobs need cancellation/retry if interrupted.
- Shared durable screenshot storage and deployment browser provisioning.
- Actual provider-usage dollar accounting/enforcement; request reservation is not a $10 guarantee.
- Full screenshot/state/roster coverage, narrow independent reviewer passes, and repair loops for visual/review failures (currently stop for correction).
- Changed-only downstream regeneration and image revisions that propose corresponding UI-rule changes.
- Existing published-game import/refactor UX and admin bulk generation/review of missing specifications.
- Email/SMS completion delivery; only the existing web-push mechanism is used.
- Production load/rate limits, malicious/expensive schema review, and operational monitoring.

Do not deploy this prototype as a finished implementation without resolving the relevant gaps.
