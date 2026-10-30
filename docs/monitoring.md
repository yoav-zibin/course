# Monitoring, alerts and logs

Goal: when something goes wrong, someone who needs to know is told, and the logs hold enough to
find out why, for a person or an agent, without asking the user to repeat what they did.

- **Minor** problems send an **email**. Look at them today.
- **Major** problems send the email **and** a text message and/or a PagerDuty page (PagerDuty can
  also call a phone, if the person on call sets that in their PagerDuty notification rules). Act now.

```
server  ->  JSON log file  ->  Ops Agent  ->  Cloud Logging  ->  log-match alert policies ->  email (minor)
(observability.py)                                                                          ->  email + text/PagerDuty (major)
                                           VM metrics (memory, CPU, disk)  ->  metric policies   (same split)
                                           Uptime check of /health         ->  policy             (major)
```

The server decides what is a problem and writes it to its log with an `alert` field, so the
rules live in code that is tested (`tests/test_monitoring.py`). Google Cloud only turns those
lines, the VM's metrics and an uptime check into notifications.

## What raises an alert

Thresholds are in `config.json` under `"monitoring"` (defaults in `config.example.json`).
The same alert is written at most once per `alert_cooldown_seconds` (5 minutes).

| Event | Tier | Meaning | Look at |
|---|---|---|---|
| `signup_surge` | minor | 30+ accounts created in a minute | `top_clients`: one address means a bot |
| `signup_flood` | major | 120+ accounts in a minute | same; consider blocking the address |
| `server_busy` | minor | 30+ requests being handled at once | `likely_cause`, `top_clients_by_requests`; `/admin/monitoring` |
| `server_overloaded` | major | 80+ requests at once | `likely_cause`; `oldest`: what is stuck |
| `latency_high` | minor | 95% of requests in the last minute took 1 s or more | `likely_cause`, `event_loop_lag_ms`, `thread_groups` |
| `latency_critical` | major | 95% took 5 s or more | same, then the VM's CPU and memory |
| `error_rate_high` | minor | 5%+ of a minute's requests failed with 5xx | `likely_cause` (a path?), then its `http_5xx` lines |
| `error_rate_critical` | major | 25%+ failed | the server is broken: logs, then restart |
| `event_loop_blocked` | minor, or major from 5 s | the server's asyncio loop took 500 ms+ (5 s+ for major) to run a tiny task: something blocks it, and every request waits (the CPU can be idle) | `blocking_frame`, `event_loop_stack`: the line that blocks |
| `store_slow` | minor | 95% of a minute's database calls took 300 ms or more (5+ calls) | `store_slowest`: which calls |
| `client_error_spike` | minor | 30+ error reports from browsers in a minute (`POST /client-errors`) | `top_kinds`, `top_pages`, `top_messages` |
| `request_very_slow` | minor | one request took 5 s or more | `method`, `path`, `query`, `body`: repeat it |
| `request_stuck` | minor | a request has run 30 s and not finished | `thread_stacks`: what each thread is doing |
| `http_5xx` | minor | a request was answered with a 5xx | the request's arguments and `request_id` |
| `unexpected_exception` | minor | a bug: an exception nobody handled | `stack_trace` and the arguments |
| `memory_high` | minor | the server process uses 70%+ of the machine's memory | `rss_mb` |
| `memory_critical` | major | 90%+ | restart soon; find the leak |
| `data_save_failed` | minor for the first two failures, major from the third in a row | changes cannot be saved and pile up in memory | `destination`, the exception; disk full? |
| `illegal_move_spike` | minor | 100+ rejected moves in a minute | `illegal_move` lines: a game's interface, or abuse |
| `game_function_timeout` | minor | a game's server code ran past its 100 ms limit | `inputs`, `seed`, `ctx`: replay it |
| `game_function_memory` | minor | a game's server code used more than 64 MB | same |
| `game_function_error` | minor | a game's server code threw, or returned something invalid | same |
| `computer_illegal_move` | minor | a computer opponent chose a move its own game rejects | same: the game has a bug |
| `ai_generation_timeout` | minor | the game-building agent took over two minutes | `last_message`: what was asked |
| `translation_budget_exceeded` | minor | the day's character budget for Google Translate is spent: new game texts stay in their original language until tomorrow | `characters_today`, `daily_character_limit` (config `translation`) |
| `translation_failed` | minor, once per cooldown | Google Translate is failing or refusing (a bad key, a quota, an outage): games show their own texts | `error` |
| `alert_test` | minor or major | a test alert (`POST /admin/alerts/test`) | nobody needs to act |

From Google Cloud (not the server):

| Alert | Tier | Meaning |
|---|---|---|
| uptime check failing | major | `https://HOST/health` fails: the server is down, unreachable, or cannot save (it answers 503 then) |
| memory used above 75% | minor | the VM, from the Ops Agent |
| memory used above 90% | major | |
| CPU above 85% for 10 minutes | minor | the VM, from Compute Engine |
| CPU above 95% for 10 minutes | major | |
| disk used above 80% | minor | |
| disk used above 92% | major | |

Logged, but not alerts by themselves: `client_error` (one error a browser reported: `kind`, `error_message`, `page`, `user_agent`, `client`),
`request_slow` (a request over 1 s, with its arguments),
`illegal_move` (a player's rejected move: `move`, `reason`, `player_id`, `match_id`),
`game_function_slow` (a game function using half its time limit; `inputs`), `metrics` (one summary
line a minute: requests, status classes, p50/p95/max latency, in-flight, memory, CPU, `event_loop_lag_ms`, `store_*`, counts),
`translation_done` and `translation_rejected` (a translation that lost a `{placeholder}`), `data_save_recovered`, `server_started`, `server_stopping`.

## What the alerts say about the cause

"Slow" is not enough to act on, so the busy, overloaded, latency and error-rate alerts (and
`event_loop_blocked`, `store_slow`) say what is probably wrong. Start with `likely_cause`, a sentence
chosen by simple rules over the fields beside it:

| Field | What it holds |
|---|---|
| `likely_cause` | the rules that matched, in this order: the event loop was blocked (names the line); database calls ran on the event loop; database calls are slow; one client sent more than half of the requests (needs 10+); most 5xx are on one path (error rates only); memory is above the warn threshold (with its growth over 10 minutes); the process uses a whole CPU core; or, for latency / busy / overloaded with CPU below 50% and nothing else found, *"requests are waiting on I/O or a blocked event loop"* (look at `event_loop_lag_ms` and `thread_groups`). With no match: "no single cause found". |
| `top_clients_by_requests`, `top_clients_by_time` | the 5 clients (addresses) with the most requests, and the most total time, in the last minute: `{client, requests, total_ms, errors_5xx}`. Requests still running count for the time so far. |
| `top_paths_by_requests`, `top_paths_by_time` | the same for endpoints, ids replaced by `{id}`: `POST /matches/{id}/moves`. |
| `thread_groups` | where the threads are, grouped by innermost call: `{frame, threads, example_stack}`. "12 threads in `socket.py:708 recv_into`" means 12 requests wait on the network (a database or another service). |
| `process_cpu_percent`, `machine_cpu_percent`, `cpu_count` | CPU of the server process (100 = one core) and of the whole VM. Slow with both low means waiting, not computing. |
| `event_loop_lag_ms` | the worst time in the last minute a tiny task waited to run on the asyncio loop. Normally under 10. Over 500 means something blocks the loop (see `event_loop_blocked`). |
| `store_calls`, `store_total_ms`, `store_p95_ms`, `store_max_ms`, `store_slowest`, `store_calls_on_event_loop`, `store_ms_on_event_loop` | database calls (every call on the store, wrapped in `main.py`). A call made on the loop's own thread blocks every request: it should be 0. |

**The incident these were added for** (2026-10-30: requests took 6 to 26 s with an idle CPU): `latency_high` would
say *requests are waiting on I/O or a blocked event loop*, and `event_loop_blocked` would have logged
`blocking_frame: "api.py:1840 _choose_locale"` (the `async` middleware reading Firestore on the loop) and
`store_calls_on_event_loop` > 0.

**Browser errors.** Pages report script errors, unhandled promise rejections and "device storage is
full" (the offline cache) to the public `POST /client-errors`
(`static/common.js`, `reportClientError(kind, message)`). The body is small JSON, at most 4 KB:
`{"kind": "script_error", "message": "...", "page": "/static/portal.html", "user_agent": "..."}`
(`kind` is lower-case snake_case: `script_error`, `unhandled_rejection`, `storage_full`). The server logs a
`client_error` event (no alert). Each client may send 10 a minute (`429` after); passwords, tokens and
codes are cut out of the text, and only the page's path is kept, not its query. Filter with
`jsonPayload.event="client_error"`.

## Thresholds added for this

In `config.json` under `"monitoring"` (defaults in `config.example.json`):

| Key | Default | Meaning |
|---|---|---|
| `event_loop_blocked_ms` | 500 | `event_loop_blocked` (minor) when the loop takes this long to run a tiny task |
| `event_loop_blocked_critical_ms` | 5000 | the same alert, major |
| `store_slow_p95_ms` | 300 | `store_slow` when the 95th percentile of a minute's database calls reaches this |
| `client_errors_per_client_per_minute` | 10 | browser reports kept per client per minute; the rest get 429 |
| `client_error_spike_per_minute` | 30 | `client_error_spike` when this many reports arrive in a minute |

## What is in a log line

One JSON object per line: `severity`, `message`, `timestamp`, `logger`, `event`, `alert` (when it is
one), `request_id`, and the event's own fields. `request_id` is also returned to the caller as the
`X-Request-Id` header (and in the body of a 500), so a user's report can be matched to the log, and
every line written while a request was handled carries it.

To repeat a problem the line has:

- **A request** (`request_very_slow`, `request_stuck`, `http_5xx`, `unexpected_exception`): `method`,
  `path`, `query`, the JSON `body` (up to `max_logged_body_bytes`), `user_id`, `client` (the address),
  `user_agent`, `accept_language`, `duration_ms`, and for exceptions the `stack_trace`.
- **A game function** (`game_function_*`, `illegal_move`, `computer_illegal_move`): `game_id`,
  `game_version`, `function`, `match_id`, `move_count`, `seed`, `ctx` (the players and pot) and
  `inputs` (the state, the player and the move: exactly the arguments). The server's game code is
  deterministic given those, so the call can be repeated.

**Never logged:** passwords, tokens, API keys, cookies and verification codes (replaced by
`<redacted>`). A game's source code is replaced by its length and a hash. See `observability.redact`.

## Set it up

1. **The server's config.** In `config.json` on the VM:

   ```json
   "monitoring": {"log_format": "json", "log_file": "/var/log/game-platform/server.log"}
   ```

   then `sudo systemctl restart game-platform`. The file appears (rotated at 50 MB, 5 kept).
   Everything else keeps its default; see `config.example.json` for the thresholds.

2. **The Ops Agent on the VM** (it ships the file to Cloud Logging and sends the VM's metrics).
   Install it as Google describes (Compute Engine > VM instances > Observability, or
   `curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh && sudo bash add-google-cloud-ops-agent-repo.sh --also-install`), then:

   ```bash
   sudo cp ops/monitoring/ops-agent-config.yaml /etc/google-cloud-ops-agent/config.yaml
   sudo systemctl restart google-cloud-ops-agent
   ```

   In Logs Explorer, `log_id("game_platform")` should now show the server's lines, with
   `jsonPayload.event` and so on. If it is empty, check `sudo systemctl status google-cloud-ops-agent"*"`
   and that the file exists and is being written. The VM's service account needs the Logging
   Writer and Monitoring Metric Writer roles (the default Compute Engine one has them if its access
   scopes allow Cloud Platform).

3. **The alerts.** From Cloud Shell, signed in to the project, as someone who may edit Monitoring:

   ```bash
   cd ops/monitoring
   PROJECT_ID=my-project ALERT_EMAIL=me@example.com ./setup.sh
   ```

   `ALERT_EMAIL` can be several addresses separated by commas; each gets an email channel and all of them
   get every alert. It creates the email channels, an uptime check of `https://buildplay.fun/health`, and the policies
   in the tables above. It skips what exists, so running it again is safe. To page for major alerts,
   add either or both of `PAGERDUTY_KEY=...` and `SMS_NUMBER=+1555...`, or create the channels in the
   console (Monitoring > Alerting > Edit notification channels: SMS or PagerDuty; Cloud Monitoring itself
   cannot place phone calls, so for a call use PagerDuty) and pass their names in `MAJOR_EXTRA_CHANNELS=projects/P/notificationChannels/ID`.
   Without one, major alerts only send the email, and the script warns you.

   To see what it will create first: `python3 policies.py --help`, or run it with fake channel names
   and read `policies/*.json`.

## Who gets the alerts, and handing over

Nothing about who is alerted is in the repository: the addresses and numbers are notification
**channels** in the Google Cloud project, and each alert policy lists the channels it uses. So you
can start with your own details and hand over later without a code change or a deploy.

To hand over to the admins, in the console (Monitoring > Alerting > Edit notification channels; the
wording differs a little between versions), do one of:

1. **Edit the channel**: change its email address or phone number. Every policy that uses it follows.
2. **Add the admins' channels** (Add new: Email, SMS or PagerDuty) and tick them in each policy
   (Alerting > the policy > Edit > Notifications); remove yours when you are done. Texts need the number
   verified first.
3. **Start over with new addresses**: delete the policies named "Game platform ..." (Alerting > Policies, or
   `gcloud monitoring policies list --filter='displayName:"Game platform"' --format='value(name)' | xargs -n1 gcloud monitoring policies delete --quiet`),
   then run `setup.sh` again with the admins in `ALERT_EMAIL`. It makes a channel for each new address and
   recreates the policies with them. Re-running without deleting the policies does not move them to a new
   address: it skips policies that exist.

The easiest handover is to use a **group address** as `ALERT_EMAIL` from the start (for example
`platform-alerts@yourdomain`): you then change the group's members and never touch Google Cloud. For
the major tier, **PagerDuty** works the same way: your phone now, an on-call schedule of the admins later.
Phone calls come through PagerDuty too (Cloud Monitoring itself cannot call).

## Check that the alerts work

Do this once after setup, and whenever you change thresholds. Tell the people who get the pages first.

1. **A test alert** (needs the master password; nothing real happens):

   ```bash
   python3 tools/alert_drill/alert_drill.py test-alert --target https://buildplay.fun --tier minor --password MASTER
   python3 tools/alert_drill/alert_drill.py test-alert --target https://buildplay.fun --tier major --password MASTER
   ```

   The minor one should email within a few minutes; the major one should email and page. In Logs
   Explorer: `jsonPayload.event="alert_test"`. If the log line is there but nothing arrives, the
   problem is the policy or the channel (Monitoring > Alerting > the policy > its notification channels).

2. **The uptime alert.** On the VM, `sudo systemctl stop game-platform`; within about 5 minutes a
   page should arrive. Start it again, and the incident closes by itself.

3. **A sign-up ramp**, which makes the situation instead of faking the log line:

   ```bash
   python3 tools/alert_drill/alert_drill.py ramp --target http://127.0.0.1:8000
   python3 tools/alert_drill/alert_drill.py cleanup --target http://127.0.0.1:8000 --password MASTER
   ```

   The default stages are 10, then 45, then 150 sign-ups a minute: quiet, then a surge (`signup_surge`:
   email), then a flood (`signup_flood`: page). Against the real server add `--allow-remote`, and only
   with its owners' OK: it pages people.

4. **Fake users** (`tools/fake_users`) are the realistic load: browsers that sign up, play and leave.
   Point them at a server you may stress and raise `users_per_hour` and `max_users` on their control page.
   They make `server_busy`, rising latency, CPU and memory alerts. They cannot reach the *sign-up* thresholds
   on one VM: at 90 fake users each staying a few minutes, about 10 new accounts arrive a minute, under the
   default 30. For a drill with fake users, lower the target's thresholds in its config
   (e.g. `"signup_surge_per_minute": 5, "signup_flood_per_minute": 12`) and restart it, and put
   them back afterwards. The alert drill's ramp is the exact way to cross the real thresholds.

## Investigate a problem

- A user reports something: ask for the time and what they did, or the `request_id` from a failed
  response (`X-Request-Id`). `./investigate.sh request ID` prints every line of that request.
- An alert arrived: its log line has the details. `./investigate.sh alerts`, `errors`, `slow`, `game`,
  `illegal`, `signups`, or `match MATCH_ID` (in `ops/monitoring/`) print the matching lines as JSON.
- A summary to start from: `./investigate.sh digest`, or on any log file or `gcloud logging read` output:

  ```bash
  python3 tools/log_digest.py /var/log/game-platform/server.log
  python3 tools/log_digest.py server.log --request-id 3f9c2a1b7d4e8a60
  ```

- **Giving it to an agent:** hand it the digest (`--json`) and the matching lines, and say what you
  want, for example: *"This is the game platform's structured log (docs/monitoring.md explains the
  fields). Find why POST /matches/m1/moves failed at 14:02 and write a failing test that repeats it
  from the logged `inputs` and `seed`."* Everything an agent needs is in the lines: the arguments, the
  request id, and the stack trace.
- **Repeating a game function failure:** take `inputs` (`[state, player_id, move]`), `seed` and `ctx` from the
  line and call the game's function with them in the game tester (`game_testing.py`) or the emulator.

## Honest limits

- The Google Cloud files (`ops-agent-config.yaml`, `policies.py`, `setup.sh`) were written from Google's
  documentation and their structure is tested, but they have **not been run against a live project**. Run
  the checks above after `setup.sh`; if a `gcloud` command or a policy is rejected, its message says why.
  Not confirmed in the documentation I could read: the PagerDuty channel's type and key label, whether an SMS
  channel needs verifying in the console, and the memory and disk metric names (check them in Metrics Explorer:
  `agent.googleapis.com/memory/percent_used`, `agent.googleapis.com/disk/percent_used`, label `state="used"`).
- The thresholds are starting points. Tune them after a week of real `metrics` lines.
- The game-function logging was tested with a stand-in for the QuickJS runner; the first real timeout is the
  real test of it.
- Only one VM is watched, and the log file lives on that VM: if the disk is lost, so are the logs that were
  not yet shipped. Cloud Logging keeps the shipped ones.
