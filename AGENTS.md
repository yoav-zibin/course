# Scaling coordination

Before changing storage, Portal, Builder or admin pages, read
[the backend handoff](docs/handoff-sc5386-backend.md).

The query backend, paginated interfaces and production conversion are already
merged into main through PRs #32, #38 and #39 (main includes `5a03a78`). Production
is running query mode with real data. Merge/rebase current main before starting
overlapping work; reuse its API contract instead of implementing storage again.

The shared Admin/Portal/Builder top bar is covered by
[PR #40](https://github.com/yoav-zibin/course/pull/40). Reuse its shared navigation
initializer and current asset versions when integrating header changes.

Keep synthetic data confined to the test database. Do not reset production's
runtime configuration to the example defaults or point it at the fake-month
dataset. Preserve the existing test allowance; do not launch paid scale runs or
increase its limits without the user's authorization.

The original 10M-user/1B-match/100K-game capacity target is still unproved. The
handoff separates completed deployment work from remaining integration and
scale-validation tasks.
