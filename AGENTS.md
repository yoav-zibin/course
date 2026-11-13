# Git workflow

Push completed, tested changes directly to `main`; the user does not want pull
requests. Fetch and integrate current upstream changes and resolve any conflicts
before pushing. Use the existing CI and deployment workflow.

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
