# Superfan production monitoring

Superfan checks the production VM and buildplay.fun at the top of every hour in
UTC. A persistent systemd timer catches up after a reboot. It reads existing
application JSON logs and sysstat CPU history, probes public and local `/health`
(including storage status), and checks that `/portal` loads. It never modifies
production data, restarts the web server, or runs synthetic users.

| Signal | Early warning | Critical |
|---|---|---|
| CPU busy | 70% across adjacent ten-minute samples | 90% |
| CPU I/O wait / steal | 10% / 5%, sustained | 25% / 15% |
| Five-minute load per vCPU | 0.8 | 1.5 |
| Available RAM, including reclaimable cache | below 25% | below 10% |
| Disk usage | 75%, or root below 5 GiB free | 90%, or root below 2 GiB free |
| Disk growth forecast | reaches 90% within 24h | within 6h |
| Free inodes | below 20% | below 5% |
| Application open-file limit | 70% | 90% |
| Live API route p95, at least 20 requests/hour | 500ms | 1s |
| API 5xx, at least 3 errors, per route or total | 1% | 5% |
| Event-loop lag, at least 3 minute windows/hour | 200ms | 500ms |
| Database p95, at least 3 minute windows/hour | 150ms | 300ms |
| Concurrent requests, at least 3 minute windows/hour | 20 | 60 |
| Health or Portal failure | retry recovery / probe takes 1s | all three attempts fail |
| Production service | restart since last check | stopped |
| Kernel OOM kills | — | any recorded during interval |
| Application alert logs | save failure or unhandled exception | any major alert |
| Monitoring coverage | stale/missing stats or CPU history, log retention gap, missed hourly run | collector fails |

Forecasts require at least two growing hourly intervals; initial forecasts become
available after the third check. Snapshots are kept for 48 checks. Test/admin/
health operations and POST game imports have separate latency expectations, so
their long durations do not trigger the live-route p95 alert; their 5xx errors
still count. One-off slow operations are retained in the application log.

Emails go only to recipients in `/etc/superfan/config.json`, using the existing
production SMTP configuration in `/opt/game-platform/config.json`. No credentials
or real recipients are committed. New findings, severity changes and recoveries
notify on the next check. Unchanged warnings repeat every 6 hours; critical
findings repeat hourly. Failed SMTP delivery does not acknowledge an alert and
systemd retries failed checks. Quiet successful checks only update the local
report and journal. Reports contain aggregate numbers and route templates,
without request bodies, raw user paths, IP addresses, passwords or tokens.

Install from this repository (requires root and existing `sysstat` collection):

```bash
sudo install -d -m 755 /usr/local/lib/superfan
sudo install -d -m 700 /etc/superfan /var/lib/superfan
sudo install -m 644 ops/monitoring/superfan.py /usr/local/lib/superfan/superfan.py
sudo install -m 600 ops/monitoring/superfan-config.example.json /etc/superfan/config.json
# Edit recipients and paths in /etc/superfan/config.json before enabling.
sudo install -m 644 ops/monitoring/superfan.service ops/monitoring/superfan.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo python3 /usr/local/lib/superfan/superfan.py --dry-run
sudo systemctl enable --now superfan.timer
sudo systemctl start superfan.service
sudo python3 /usr/local/lib/superfan/superfan.py --send-test
```

Operations:

```bash
sudo systemctl list-timers superfan.timer
sudo journalctl -u superfan.service --since '1 day ago'
sudo cat /var/lib/superfan/latest.json
sudo python3 /usr/local/lib/superfan/superfan.py --dry-run
# Disable without changing production:
sudo systemctl disable --now superfan.timer
sudo systemctl stop superfan.service
```

Hourly checking can take up to an hour to detect an incident. This VM cannot send
alerts while the host/network or SMTP is down. Keep external uptime monitoring
and faster existing Cloud Monitoring alerts alongside Superfan. Production VM
credentials may have only `monitoring.write` scope, which cannot inspect or manage
Cloud Monitoring policies; do not interpret an installed Ops Agent as proof that
external alert policies or recipients are configured. An SMTP acceptance confirms
submission to the mail server, not inbox delivery.
