#!/usr/bin/env python3
"""Hourly, read-only production checks. Python stdlib only; no application imports.

Only aggregated numbers and route templates leave the VM. Credentials and alert
recipients live in root-owned configuration, never in source control.
"""

from __future__ import annotations

import argparse
import collections
import contextlib
import datetime as dt
from email.message import EmailMessage
import fcntl
import json
import math
import os
from pathlib import Path
import re
import smtplib
import socket
import ssl
import subprocess
import time
import urllib.request

UTC = dt.timezone.utc
GIB = 1024 ** 3
BACKGROUND_ROUTES = ("/game-test", "/admin", "/health")


def timestamp(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def command(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True, timeout=25).stdout


def disk_reading(stats):
    capacity = (stats.f_blocks - stats.f_bfree + stats.f_bavail) * stats.f_frsize
    free = stats.f_bavail * stats.f_frsize
    return {"capacity": capacity, "free": free, "used_percent": 100 * (1 - free / capacity),
            # FAT/EFI and some virtual filesystems do not expose inode accounting.
            "inodes_free_percent": 100 * stats.f_favail / stats.f_files if stats.f_files else None}


def log_stats(log_file, start, now):
    """Stream rotated logs, cap memory, discard bodies/client IDs immediately."""
    routes = collections.defaultdict(lambda: {"requests": 0, "errors": 0, "slow": 0,
                                              "latencies": collections.Counter()})
    metrics, alerts = [], collections.Counter()
    earliest, latest = now, 0
    files = list(Path(log_file).parent.glob(Path(log_file).name + "*"))
    for path in files:
        # Old rotations cannot contain any entries in this window.
        if not path.is_file() or path.stat().st_mtime < start:
            continue
        with path.open(errors="replace") as stream:
            for line in stream:
                try:
                    entry = json.loads(line)
                    when = timestamp(entry["timestamp"])
                    if not start <= when <= now + 5:
                        continue
                    earliest, latest = min(earliest, when), max(latest, when)
                    if entry.get("event") == "metrics":
                        metrics.append({**{k: v for k, v in entry.items()
                                          if isinstance(v, (int, float))}, "time": when})
                    if entry.get("alert"):
                        alerts[(entry.get("event", "unknown"), entry["alert"])] += 1
                    message = entry.get("message", "")
                    if not message.startswith("API_CALL "):
                        continue
                    call = json.loads(message[9:])
                    # Never use the raw path: unmatched paths can contain user data.
                    route = call.get("route")
                    if not route or not call.get("handler"):
                        continue
                    key = f"{call.get('method', 'GET')} {route}"
                    if len(routes) >= 1000 and key not in routes:
                        key = "OTHER"
                    row = routes[key]
                    row["requests"] += 1
                    row["errors"] += int(call["status"] >= 500)
                    duration = max(0, min(600_000, round(call["duration_ms"] / 10) * 10))
                    row["latencies"][duration] += 1
                    row["slow"] += int(duration >= 500)
                except (ValueError, KeyError, TypeError):
                    continue  # A partial final line is normal during rotation.
    output = {}
    for key, row in routes.items():
        target, seen, p95 = math.ceil(row["requests"] * .95), 0, 0
        for duration, count in sorted(row.pop("latencies").items()):
            seen += count
            if seen >= target:
                p95 = duration
                break
        output[key] = {**row, "p95_ms": p95}
    return {"routes": output, "metrics": sorted(metrics, key=lambda m: m["time"]),
            "alerts": {f"{event}:{tier}": n for (event, tier), n in alerts.items()},
            "earliest": earliest, "latest": latest}


def cpu_history(start, now):
    samples, warnings = [], []
    dates = {dt.datetime.fromtimestamp(t, UTC).date() for t in (start, now)}
    for date in sorted(dates):
        path = Path(f"/var/log/sysstat/sa{date.day:02}")
        try:
            hosts = json.loads(command("sadf", "-j", str(path), "--", "-u"))["sysstat"]["hosts"]
            for host in hosts:
                for row in host.get("statistics", []):
                    stamp = row["timestamp"]
                    when = timestamp(f"{stamp['date']}T{stamp['time']}+00:00")
                    if not start <= when <= now:
                        continue
                    cpu = next(c for c in row["cpu-load"] if c["cpu"] == "all")
                    samples.append({"time": when, "busy": 100 - cpu["idle"],
                                    "iowait": cpu["iowait"], "steal": cpu["steal"]})
        except (OSError, subprocess.SubprocessError, ValueError, KeyError, StopIteration):
            warnings.append(f"CPU history unavailable for {date}")
    return samples, warnings


def probe(url, health=False):
    results = []
    for attempt in range(3):
        started = time.monotonic()
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Superfan/1.0"})
            with urllib.request.urlopen(request, timeout=10) as response:
                body = response.read(4096)
                ok = response.status == 200
                if health:
                    data = json.loads(body)
                    ok = ok and data.get("status") == "ok" and data.get("storage") == "ok"
                results.append({"ok": ok, "seconds": round(time.monotonic() - started, 3)})
        except (OSError, ValueError):
            results.append({"ok": False, "seconds": round(time.monotonic() - started, 3)})
        if results[-1]["ok"]:
            break
        if attempt < 2:
            time.sleep(2)
    return results


def collect(config, previous, now):
    # On delayed/missed runs, inspect up to two hours; flag a larger blind interval.
    start = min(now - 3600, max(now - 7200, previous.get("time", now - 3600)))
    mem = {line.split(":")[0]: int(line.split()[1]) * 1024
           for line in Path("/proc/meminfo").read_text().splitlines() if len(line.split()) >= 2}
    unit = dict(line.split("=", 1) for line in command(
        "systemctl", "show", "game-platform", "-p", "ActiveState", "-p", "SubState",
        "-p", "MainPID", "-p", "NRestarts", "-p", "ExecMainStartTimestampMonotonic").splitlines())
    disks, devices = {}, set()
    for mount in config.get("mounts", ["/", "/boot", "/boot/efi"]):
        device, stats = os.stat(mount).st_dev, os.statvfs(mount)
        if device in devices:
            continue
        devices.add(device)
        # Use f_bavail: space reserved for root is not application headroom.
        disks[mount] = disk_reading(stats)
    fd_percent = 0
    if int(unit["MainPID"]):
        proc = Path("/proc") / unit["MainPID"]
        soft_limit = re.search(r"Max open files\s+(\d+)", (proc / "limits").read_text())
        if soft_limit:
            fd_percent = 100 * len(list((proc / "fd").iterdir())) / int(soft_limit[1])
    cpus, issues = cpu_history(start, now)
    try:
        kernel = command("journalctl", "-k", "--since", f"@{int(start)}", "--no-pager", "-o", "cat")
        oom = len(re.findall(r"(?:Out of memory: Killed process|oom-kill:)", kernel))
    except (OSError, subprocess.SubprocessError):
        oom = 0
        issues.append("Kernel OOM history unavailable")
    base = config["base_url"].rstrip("/")
    return {"time": now, "window_start": start, "unit": unit, "disks": disks,
            "memory_total": mem["MemTotal"], "memory_available": mem["MemAvailable"],
            "load_per_cpu": os.getloadavg()[1] / (os.cpu_count() or 1), "fd_percent": fd_percent,
            "cpu": cpus, "oom": oom, "collection_issues": issues,
            "probes": {"public_health": probe(base + "/health", True),
                       "local_health": probe(config["local_health_url"], True),
                       "portal": probe(base + "/portal")},
            "logs": log_stats(config["log_file"], start, now)}


def evaluate(snap, history):
    findings = {}

    def add(key, critical, detail):
        findings[key] = {"severity": "critical" if critical else "warning", "detail": detail}

    if snap["unit"]["ActiveState"] != "active" or snap["unit"]["SubState"] != "running":
        add("service", True, "Production service is not running. Check systemctl status game-platform.")
    previous = history[-1] if history else {}
    old_unit = previous.get("unit", {})
    if old_unit and (snap["unit"]["ExecMainStartTimestampMonotonic"] != old_unit.get("ExecMainStartTimestampMonotonic")
                     or snap["unit"]["NRestarts"] != old_unit.get("NRestarts")):
        add("restart", False, "Production restarted since the last check; inspect its journal and deployment history.")
    if previous and snap["time"] - previous["time"] > 5400:
        add("missed_run", False, "Monitoring gap exceeded 90 minutes; inspect superfan.timer and its journal.")
    for name, attempts in snap["probes"].items():
        if not any(a["ok"] for a in attempts):
            add(name, True, f"{name} failed three attempts; users may be unable to load the site or save data.")
        elif len(attempts) > 1 or attempts[-1]["seconds"] >= 1:
            add(name, False, f"{name} recovered on retry or took {attempts[-1]['seconds']:.2f}s; inspect proxy and database.")
    available = 100 * snap["memory_available"] / snap["memory_total"]
    if available < 25:
        add("memory", available < 10, f"Only {available:.1f}% RAM available ({snap['memory_available'] / GIB:.2f} GiB); inspect processes before OOM.")
    for mount, disk in snap["disks"].items():
        if disk["used_percent"] >= 75:
            add("disk:" + mount, disk["used_percent"] >= 90,
                f"{mount} is {disk['used_percent']:.1f}% full, {disk['free'] / GIB:.2f} GiB free; inspect logs/backups.")
        # An absolute guard applies to the large data filesystem only, not small boot partitions.
        if mount == "/" and disk["free"] < 5 * GIB:
            add("disk:" + mount, disk["free"] < 2 * GIB, f"Root has only {disk['free'] / GIB:.2f} GiB free.")
        if disk["inodes_free_percent"] is not None and disk["inodes_free_percent"] < 20:
            add("inodes:" + mount, disk["inodes_free_percent"] < 5,
                f"{mount} has only {disk['inodes_free_percent']:.1f}% inodes free; new files may fail.")
        points = [(h["time"], h["disks"][mount]["free"]) for h in history[-6:]
                  if mount in h.get("disks", {}) and h["disks"][mount]["capacity"] == disk["capacity"]]
        points.append((snap["time"], disk["free"]))
        # Require two growing hourly intervals, not a single burst or deletion.
        if len(points) >= 3 and points[-1][0] - points[0][0] >= 5400:
            rates = [(a[1] - b[1]) / (b[0] - a[0]) for a, b in zip(points, points[1:]) if b[0] > a[0]]
            if rates and min(rates[-2:]) > 0:
                rate = min(sum(rates) / len(rates), min(rates[-2:]))
                hours = (disk["free"] - disk["capacity"] * .1) / rate / 3600
                if 0 < hours < 24:
                    add("disk_growth:" + mount, hours < 6,
                        f"{mount} reaches 90% full in about {hours:.1f}h at sustained growth; inspect logs/backups now.")
    cpu = snap["cpu"]
    # Two adjacent ten-minute sysstat intervals, rather than an instantaneous spike.
    for metric, warn, critical in [("busy", 70, 90), ("iowait", 10, 25), ("steal", 5, 15)]:
        sustained = [min(a[metric], b[metric]) for a, b in zip(cpu, cpu[1:])
                     if 300 <= b["time"] - a["time"] <= 900]
        worst = max(sustained, default=0)
        if worst >= warn:
            add("cpu:" + metric, worst >= critical,
                f"Sustained CPU {metric} reached {worst:.1f}% across adjacent history samples; inspect top and app latency.")
    if snap["load_per_cpu"] >= .8:
        add("load", snap["load_per_cpu"] >= 1.5, f"Five-minute load per vCPU is {snap['load_per_cpu']:.2f}; requests may queue.")
    if snap["fd_percent"] >= 70:
        add("file_descriptors", snap["fd_percent"] >= 90, f"Production uses {snap['fd_percent']:.1f}% of its open-file limit.")
    if snap["oom"]:
        add("oom", True, f"Kernel recorded {snap['oom']} OOM events; inspect journalctl -k for killed processes.")
    logs = snap["logs"]
    if snap["time"] - logs["latest"] > 180 or not logs["metrics"] or snap["time"] - logs["metrics"][-1]["time"] > 180:
        add("telemetry", False, "Application minute stats are missing/stale; monitoring cannot assess live request health.")
    elif logs["earliest"] - snap["window_start"] > 300:
        add("log_retention", False, "Rotated logs no longer cover the requested interval; increase retention or reduce log volume.")
    for issue in snap["collection_issues"]:
        add("collector:" + issue, False, issue + "; monitoring coverage is incomplete.")
    if not cpu or snap["time"] - cpu[-1]["time"] > 1200:
        add("cpu_history", False, "CPU history is missing/stale; check sysstat-collect.timer.")
    for route, row in logs["routes"].items():
        count, errors = row["requests"], row["errors"]
        path = route.split(" ", 1)[-1]
        background = path.startswith(BACKGROUND_ROUTES) or route.startswith("POST /games")
        # Test/import operations may intentionally run for seconds. Their errors still count.
        if count >= 20 and row["p95_ms"] >= 500 and not background:
            add("latency:" + route, row["p95_ms"] >= 1000,
                f"{route}: p95 {row['p95_ms']}ms across {count} calls (early warning 500ms, critical 1s); inspect API_CALL and store stats.")
        if errors >= 3 and errors / count >= .01:
            add("errors:" + route, errors / count >= .05,
                f"{route}: {errors}/{count} calls failed with 5xx ({100 * errors / count:.1f}%).")
    total = sum(r["requests"] for r in logs["routes"].values())
    errors = sum(r["errors"] for r in logs["routes"].values())
    if errors >= 3 and total and errors / total >= .01:
        add("errors:all", errors / total >= .05, f"API 5xx: {errors}/{total} calls failed.")
    for key, warn, critical in [("event_loop_lag_ms", 200, 500), ("store_p95_ms", 150, 300),
                                 ("max_in_flight", 20, 60)]:
        minutes = [m[key] for m in logs["metrics"] if m.get(key) is not None and m[key] >= warn]
        if len(minutes) >= 3:
            add(key, sum(v >= critical for v in minutes) >= 3,
                f"{key} exceeded {warn} in {len(minutes)} minute windows (peak {max(minutes)}); inspect application stats.")
    for event, count in logs["alerts"].items():
        if event.endswith(":major") or event.startswith(("data_save_failed:", "unexpected_exception:")):
            add("app:" + event, event.endswith(":major"), f"Application logged {count} {event} alerts; inspect structured logs.")
    return findings


def notification_due(findings, notified, now):
    changed = {key: value for key, value in findings.items()
               if key not in notified or notified[key]["severity"] != value["severity"]
               or now - notified[key]["time"] >= (3600 if value["severity"] == "critical" else 21600)}
    recovered = sorted(set(notified) - set(findings))
    return changed, recovered


def send_email(config, subject, body):
    app = json.loads(Path(config["app_config"]).read_text())
    smtp = app["auth"]["email"]
    if smtp.get("provider") != "smtp" or not config.get("recipients"):
        raise ValueError("SMTP and alert recipients must be configured")
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = smtp["smtp_from_address"] or smtp["smtp_username"]
    message["To"] = ", ".join(config["recipients"])
    message.set_content(body)
    with smtplib.SMTP(smtp["smtp_host"], smtp.get("smtp_port", 587), timeout=20) as server:
        server.ehlo()
        if smtp.get("smtp_use_tls", True):
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
        if smtp.get("smtp_username"):
            server.login(smtp["smtp_username"], smtp["smtp_password"])
        refused = server.send_message(message)
        if refused:
            raise RuntimeError("SMTP refused one or more recipients")


def atomic_json(path, value):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, indent=2) + "\n")
    temp.chmod(0o600)
    temp.replace(path)


def run(args, config, state_dir):
    if args.send_test:
        send_email(config, "[Superfan TEST] buildplay.fun monitoring is active",
                   "This is the requested Superfan test alert, not a production incident.\n\n"
                   "Hourly checks cover public/local health, Portal, CPU/load/I/O, available RAM, disk space/inodes/growth, "
                   "service restarts, OOM kills, file limits, live API latency/5xx, event-loop lag and database latency.\n\n"
                   "Warnings repeat after 6 hours, critical findings hourly; changes and recoveries notify on the next check. "
                   "Times are UTC. The monitor never restarts production or deletes data.\n\n"
                   "A monitor on this VM cannot send email while the VM or its network is down. "
                   "An external uptime check is needed for that failure mode.\n")
        print(json.dumps({"event": "superfan_test", "email_accepted_by_smtp": True}))
        return
    state_path = state_dir / "state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    now = time.time()
    history = state.get("history", [])
    snap = collect(config, history[-1] if history else {}, now)
    findings = evaluate(snap, history)
    # Do not persist the full per-request or per-minute data.
    latest_metrics = snap["logs"]["metrics"][-1] if snap["logs"]["metrics"] else {}
    summary = {"event": "superfan_check", "timestamp": dt.datetime.fromtimestamp(now, UTC).isoformat(),
               "findings": findings, "memory_available_gib": round(snap["memory_available"] / GIB, 2),
               "cpu_mean_percent": round(sum(c["busy"] for c in snap["cpu"]) / max(1, len(snap["cpu"])), 1),
               "disks": snap["disks"], "latest_app_stats": latest_metrics,
               "routes": snap["logs"]["routes"], "probes": snap["probes"]}
    if args.dry_run:
        print(json.dumps(summary, indent=2))
        return
    notified = state.get("notified", {})
    failure_path = state_dir / "failure.json"
    if failure_path.exists():
        notified["monitoring_failed"] = {"severity": "critical", "time": now}
    changed, recovered = notification_due(findings, notified, now)
    if changed or recovered:
        level = "CRITICAL" if any(v["severity"] == "critical" for v in findings.values()) else "WARNING" if findings else "RECOVERED"
        body = [f"Superfan: {config['base_url']} on {socket.gethostname()}", summary["timestamp"], ""]
        body.extend(f"{value['severity'].upper()}: {value['detail']}" for value in findings.values())
        body.extend(f"RECOVERED: {key}" for key in recovered)
        body.extend(["", f"RAM available: {summary['memory_available_gib']} GiB; hourly mean CPU: {summary['cpu_mean_percent']}%.",
                     "Inspect: sudo journalctl -u superfan -n 20; sudo journalctl -u game-platform --since '1 hour ago'",
                     "Latest report: /var/lib/superfan/latest.json", "No production changes were made by this check."])
        send_email(config, f"[Superfan {level}] buildplay.fun: {len(findings)} active, {len(recovered)} recovered", "\n".join(body))
        # Only acknowledge notification after the SMTP server accepts it.
        for key in recovered:
            notified.pop(key, None)
        for key, value in changed.items():
            notified[key] = {"severity": value["severity"], "time": now}
    compact = {key: snap[key] for key in ("time", "disks", "unit", "memory_available", "memory_total")}
    atomic_json(state_path, {"history": (history + [compact])[-48:], "notified": notified})
    atomic_json(state_dir / "latest.json", summary)
    failure_path.unlink(missing_ok=True)
    print(json.dumps({"event": "superfan_check", "findings": findings, "email_sent": bool(changed or recovered)}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("/etc/superfan/config.json"))
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--send-test", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    config = json.loads(args.config.read_text())
    state_dir = Path(config.get("state_dir", "/var/lib/superfan"))
    state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (state_dir / "lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            run(args, config, state_dir)
        except Exception as error:
            # No exception text: SMTP errors and URLs can contain sensitive data.
            print(json.dumps({"event": "superfan_failed", "error_type": type(error).__name__}), flush=True)
            if not args.dry_run and not args.send_test:
                with contextlib.suppress(Exception):
                    failure_path = state_dir / "failure.json"
                    failure = json.loads(failure_path.read_text()) if failure_path.exists() else {}
                    if time.time() - failure.get("notified_at", 0) >= 3600:
                        send_email(config, "[Superfan CRITICAL] buildplay.fun monitoring failed",
                                   f"Hourly monitoring could not complete ({type(error).__name__}). "
                                   "Monitoring coverage is impaired. Inspect sudo journalctl -u superfan and its configuration.")
                        atomic_json(failure_path, {"notified_at": time.time()})
            raise SystemExit(1) from None


if __name__ == "__main__":
    main()
