# Advertisement campaign experiments

Campaigns use the persisted experiment framework in `models.py`, `store.py`, and
`service.py`. Experiment data is included in JSON and Firestore snapshots. The
advertisement campaign pilot contains Student campaigns A, B, and C, each with a
$100 budget.

## Admin workflow

Open **Admin → Statistics** to see campaign results. The dashboard reports
campaign link clicks, attributed signups, match starts, users who started a
match, and 7-day returning users. A returning user is an attributed signup that
starts a match during days 7–14 after signup. Conversion rates use unique users;
match starts count total started matches.

Create campaign links from the campaign form. The key becomes the stable short
URL `/c/<key>`; use lowercase letters, digits, and hyphens. The budget defaults
to $100 and cannot exceed that amount. Record actual spend through
`PATCH /admin/experiments/campaign-links/{variant_id}` with a `spend_usd`
field. The API report includes cost per signup, match-starting user, and
returning user; the dashboard shows traffic, conversion rates, and budget.
Clicks are counted per campaign and day;
multiple clicks by the same visitor are not deduplicated.

Campaign links use first-touch attribution in a browser. The campaign code is
remembered locally until a new account is created. Signups and later match
starts are attributed only when the user has a recorded campaign signup.
Existing accounts that click a campaign link do not become campaign signups.

The related admin APIs, all protected by the master password, are:

- `GET /admin/experiments` — campaign dashboard metrics.
- `POST /admin/experiments/campaign-links` — create a campaign link and set its
  budget (up to $100).
- `PATCH /admin/experiments/campaign-links/{variant_id}` — record actual spend.
- `PATCH /admin/experiments/{experiment_id}` — pause or resume a campaign experiment.
- `DELETE /admin/experiments/{experiment_id}/variants/{variant_id}` — remove a
  campaign variant and its attribution records.

## Metric and data notes

The browser sends the remembered campaign code when creating an account; the
server accepts only active campaign keys. Click totals are stored as per-day
aggregates. User-level conversion events are removed when an account is deleted.
Historical experiment records remain readable in stored snapshots, while
registration, controls and reports operate on campaign experiments.
