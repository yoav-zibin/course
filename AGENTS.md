# Git workflow

Push completed, tested changes directly to `main`; the user does not want pull
requests. Fetch and integrate current upstream changes and resolve any conflicts
before pushing. Use the existing CI and deployment workflow.

# Tests before pushing

Fetch and integrate current upstream before final checks. Choose local checks
that are likely to catch problems in the changes; focused checks are sufficient
when appropriate, and suites that would not exercise the changes may be skipped.
Running every suite locally is not a pre-push requirement, including native iOS
and Android suites. Use CI for broad validation and address failures when they
appear. Preserve the direct-push workflow above.

# Updating game content

Use `PATCH /games/{game_id}` as the only game-content update API. Include the
game's secret or the configured master password in the JSON field
`game_addition_request_id_and_secret`; account credentials or HTTP Basic alone
do not authorize this endpoint. Send only changed content fields and omit
unchanged fields instead of sending `null`. PATCH returns HTTP 200. Both
`POST /games` and `POST /games/declarative` create new games only (HTTP 201).

Server code, unit tests and mechanical-rule changes need their relevant logic,
schema, example and random-walk checks. Declarative presentation changes need
recorded test-flow evidence for the complete merged payload. Name, description,
textual rules, images and other metadata changes need only their relevant
artifact/translation checks. A task may independently require a broader audit;
do not describe that broader coverage as an API requirement for every patch.
See [the partial-update contract](docs/agent-game-import.md#updating-a-game).

# Scaling coordination

Before changing storage, Portal or admin pages, read
[the backend handoff](docs/handoff-sc5386-backend.md).

The query backend, paginated interfaces and production conversion are already
merged into main through PRs #32, #38 and #39. Production
is running query mode (namespace `production_v3`) with real data. Merge/rebase current main before starting
overlapping work; reuse its API contract instead of implementing storage again.

The shared Admin/Portal top bar is covered by
[PR #40](https://github.com/yoav-zibin/course/pull/40), now merged and deployed on
production. Reuse its shared navigation
initializer and current asset versions when integrating header changes.

PR #43 repairs Python 3.12 startup after the monitoring/translation merges and
adds QueryStore translation memory compatibility. Keep those fixes and the
production-runtime CI import check when integrating current main.

Keep synthetic data confined to the test database. Do not reset production's
runtime configuration to the example defaults or point it at the fake-month
dataset. Preserve the existing test allowance; do not launch paid scale runs or
increase its limits without the user's authorization.

The original 10M-user/1B-match/100K-game capacity target is still unproved. The
handoff separates completed deployment work from remaining integration and
scale-validation tasks.
