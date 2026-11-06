# Guided builder requirements audit

Reviewed November 4, 2026 against `New builder flow_ building a game step by step (1).pdf`, including its tutorial, extensibility and i18n additions. This is a source review, not a claim that a live Muse build has completed.

## Completion update — November 4, 2026

The four explicit gaps identified in this audit have now been implemented locally:

- Final approval prepares and validates every client string in every registered language; publication checks completeness and the versioned string API serves the saved tables.
- Interactive tutorials declare dynamic strings and rerender on a locale message. The portal supplies translated strings and RTL direction; switching language does not reset tutorial progress. Legacy interactive tutorials require regeneration and approval.
- An emulator-feedback action routes to the earliest affected artifact (or a regression example), leaving it unapproved and invalidating dependent artifacts.
- Conversation approvals link to expandable artifact cards, and revisions show before/after content including test images.

Validation: 38 focused Python tests including a real Chrome build, eight desktop/mobile UI checks, and 176 JavaScript tests passed with simulated AI responses. Live Muse generation quality remains unverified. The advanced extension examples remain future work.

The original findings below are retained as the audit baseline, not the current status of those four gaps.

## Core workflow (audit baseline)

| Requirement | Status | Evidence and limits |
| --- | --- | --- |
| Understand, name, logic, UI, images and test examples, each with approval | Implemented | `builder_flow.py` enforces order and approvals; `builder_jobs.py` supplies step-specific prompts. |
| Tutorial at step 4.5 | Implemented | Required between UI and images; generated self-contained HTML runs in a sandboxed iframe. |
| Tutorial works on phone, tablet and laptop | Checks implemented; generated quality needs review | Renderer checks six sizes for blank content, horizontal overflow and JS errors. It does not exercise every tutorial interaction or assess teaching quality. |
| Persistent drafts, conversation and artifact history | Implemented | Saved in draft workflow with revision checks; reopening and invalidation are tested. |
| Recheck later artifacts; reapprove only changed content | Implemented | Refresh preserves approvals for identical artifacts and stops for changed proposals. |
| Review pictures rather than JSON | Implemented | Tests are presented as descriptions and four images per case. |
| Cover and 3–5 supporting images | Implemented | Safe SVG mockups; cover requires text-free 16:9 viewBox. This is not a separate raster image model. |
| Schemas and 3–10 examples with required state categories | Implemented | Artifact validation plus runtime `ContractLogic` and example verification. |
| Runtime state/view/move validation and publish/testing gates | Implemented paths | `builder_validation.py`, service runtime wrapper and server-code gate. |
| Build server first, then client | Implemented | `builder_jobs.run_build`. |
| Separate server reviewers | Implemented | Rules, privacy, computers, settlement; separate model requests, not different model providers. |
| Determinism | Automated checks implemented | Repeated identical calls and seeded walks; finite testing is not proof for every state. The computers reviewer also mentions seeded randomness, but there is no standalone determinism reviewer role. |
| Random walks and malformed-move fuzzing | Implemented | Existing tester integrated with schemas. These are not coverage-directed walks or schema-generated fuzz inputs. |
| Client screenshots and visual review | Implemented with sampling | Six sizes, LTR/RTL, test views and sampled player/spectator states. AI review samples four approved/actual view pairs per case, not every screenshot. |
| Illegal client moves and layout checks | Partial behavioral coverage | Checks overflow, selected clipped text and small controls; probes one enabled button per view. Does not exhaust drag, canvas or keyboard interactions. |
| Bounded repair, progress, notifications, tab may close | Implemented | Up to three build attempts, ten-minute deadline, per-draft cost reservations; web push and configured email/SMS. Jobs use process threads, not a durable distributed queue. |
| Correct faulty examples with human review | Implemented | Build pauses for approval of revised tests. |
| Before/after change presentation and artifact cards in chat | Partial | History is stored, but chat renders text; no dedicated visual before/after comparison or full artifact cards. |
| Emulator feedback automatically reopens the earliest affected artifact | Partial | Manual reopen works; automatic correction routing is limited to images/tests. No general post-emulator feedback router. |
| Existing games and administrative artifact generation | Implemented with limits | Private proposals and ownership protection. Migration still uses a large single tests request rather than the newer resumable illustration flow; needs live-provider verification. |
| Final approval and publication | Implemented with deliberate extra action | Final approval enables a separate Publish button rather than automatically publishing. |
| Translate all client strings at final approval | Not complete | Final approval translates identity, rules, UI description and extracted tutorial text. Game client strings use the existing on-demand translation API instead of an all-languages publication gate. |

## Added requirements

The wording “easily refactor and add more steps later. E.g.” describes extensibility with possible future stages. It does not clearly require every example to be built now. Confirm that interpretation with the professor if grading depends on it; do not report the examples below as delivered features.

| Extension | Current state |
| --- | --- |
| Add verification checks and reviewers | `CHECKS` and `REVIEW_BRIEFS` are registries; a test covers adding a check. Generation, rendering and translation orchestration still live in imperative code, so extensibility is partial rather than a general stage/plugin system. |
| Generate extra unit tests | Approved examples and sampled positions exist; no separate agent-driven extra-test stage. |
| Generate stronger state/view/move invariants | General platform checks (such as payouts) exist; no agent-generated game-specific invariant stage. |
| Schema-conforming fuzz generation | Not implemented; current fuzz inputs are a fixed malformed-value set. |
| Coverage-directed random walks | Not implemented; random seeded walks and failure replay exist. |
| Antithesis integration | Not implemented. |
| Real-game failures and user bug reports | No dedicated ingestion-to-regression-test-to-repair workflow. Manual corrections remain possible. |
| Game i18n API allowing more languages without editing game logic | Present: string tables, `t`, `applyLocale`, locale/direction in messages and versioned string API. Guided builds lint their integration. Uses the existing platform API rather than a new parallel API. |

## Remaining i18n limitations

- Final approval does not prepare every client's translated string table in all supported languages before publishing.
- Tutorial extraction excludes script contents. Portal translation replaces initial DOM text once; dynamically generated tutorial feedback can remain in the original language. Tutorial locale/direction is not applied there.
- The existing `applyLocale` helper retains the previous string table when a locale changes without a `strings` object. Its English-reset test also supplies an empty table, so it does not establish that a locale-only switch resets correctly.
- The guided builder shell itself contains English labels. Prompts request the selected language, but label translation and generated translation quality are separate concerns.

## Validation evidence and next priorities

The preceding audit run completed 35 focused tests, including a real Chrome build with simulated model responses and at least 198 screenshots. Earlier runs recorded 176 JavaScript tests and four guided-builder browser UI tests passing. The broad Python run recorded 677 passed, 54 skipped and one timing-sensitive game-logic failure. These results are not a completed live Muse test or a review of every generated game.

Recommended completion order:

1. Complete final client-string translation and dynamic tutorial localization; test switching languages and RTL.
2. Add general emulator-feedback routing and the missing artifact/change-review presentation.
3. Make build-stage extension explicit and documented; clarify which advanced examples the professor expects now.
4. Bring migration onto the smaller resumable proposal path.
5. Finish one live Muse run through build, emulator, translation and local publication. Review tutorial interactions and game quality on real devices.

This audit does not authorize or perform a push, deployment or paid provider call.
