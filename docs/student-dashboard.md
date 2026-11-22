# Course leaderboard

Open `/admin#students` for the course leaderboard. It is one wide, horizontally
scrollable table on desktop and mobile, with one row per course member. Headers
stay visible while scrolling vertically, and names stay visible while scrolling
horizontally. Each row shows contact and account details, activity and recruitment
metrics, report counts and scores, and examples of reports with the highest and
lowest scores in its columns.
Long account lists and report examples scroll inside their cells to keep rows
compact; these cells can also receive keyboard focus.

The links column opens `/bug-reports?student=<roster-id>`, where all report
summaries can be filtered by student, status, assessment, text and date. The
report detail panels retain the existing evidence and review controls. Linked
student URLs highlight and focus the matching leaderboard row.

The leaderboard page requires Google sign-in with an email explicitly pinned
in the VM's private `admin_google_emails` configuration. This fixed allowlist is
independent of the roster's display/contact refresh. The data API accepts the
same Google session; unattended automation retains its existing API credential.
Roster names and emails are fetched on the server from the course spreadsheet;
they are not embedded in public static assets or checked into the repository.
Only the roster columns are requested. An unavailable roster produces an
explicit error rather than an empty leaderboard. The report page can still show
reports when roster attribution is unavailable.

Account attribution follows the instructor's requested rule: an exact roster
email match, or a whole first/last-name token in the account display name,
ignoring case and accents. The account columns show each match reason. A name
match is a heuristic and can include unrelated people with the same name.
Merged account IDs are retained for inspection, while metric totals use their
surviving account. Accounts are attributed for reporting only; the dashboard
does not merge or modify them.

Match totals count unique started matches, split into `computer`,
`pass_and_play` and `multiplayer`. Waiting matches are reported separately.
Other players are distinct human accounts in multiplayer matches, with the
student's own accounts excluded and merged accounts counted once.

Recruitment follows recorded `invited_by_user_id` links. Direct recruitment is
one level; transitive recruitment includes every descendant, excludes the
student's own accounts and handles cycles without counting anyone twice.
Recruit match totals count each match once even when several recruits share it.
Different students' referral trees can overlap, so their totals are not additive.

Report totals distinguish manual submissions from automatic client-error
reports. Averages include assessed manual and automatic scores from 0 through
10. Unassessed reports are counted separately. Highest and lowest examples include the existing review
rationale and resolution; the dashboard does not assign scores automatically.
The data response contains report summaries, without screenshots, diagnostics
or account passwords. Aggregates are cached briefly and show their generation
time; report review changes appear after the cache refreshes.

All metrics describe the records currently retained on the platform. Deleted
records and device saves that have not yet synced cannot contribute to totals.
