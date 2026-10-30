"""Generate reproducible, explicitly synthetic traffic and resource estimates.

This is a workload model, not an HTTP load test or a source of Google Cloud telemetry.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

TARGET = {
    "users": 10_000_000,
    "matches": 1_000_000_000,
    "games": 100_000,
}

ROUTES = {
    "auth_profile": 0.18,
    "game_catalog": 0.15,
    "match_history": 0.12,
    "match_details": 0.12,
    "open_quick_match": 0.13,
    "match_create_join": 0.08,
    "match_moves": 0.17,
    "invites_social": 0.03,
    "health_checks": 0.02,
}

# Approximate Firestore document operations per request in a hypothetical
# request-time persistence design. Not the current snapshot store's operation count.
DB_OPS_PER_REQUEST = {
    "auth_profile": (1.2, 0.025),
    "game_catalog": (8.0, 0.0),
    "match_history": (25.0, 0.0),
    "match_details": (1.5, 0.0),
    "open_quick_match": (12.0, 0.15),
    "match_create_join": (3.0, 1.0),
    "match_moves": (2.5, 1.1),
    "invites_social": (2.0, 0.2),
    "health_checks": (0.0, 0.0),
}

DAILY_USERS_SHARE_OF_MAU = 0.20
MONTHLY_ACTIVE_USERS_SHARE = 0.20
REQUESTS_PER_DAILY_ACTIVE_USER = 40
MONTHLY_MATCH_STARTS_SHARE_OF_INVENTORY = 0.01
MONTHLY_DAYS = 30

CPU_SECONDS_PER_REQUEST = 0.025
MEAN_REQUEST_SECONDS = 0.18
CPU_CORES_PER_INSTANCE = 4
TARGET_CPU_UTILIZATION = 0.65
MIN_INSTANCES = 2
BASE_RSS_GIB_PER_INSTANCE = 4.0
MEMORY_PER_INFLIGHT_REQUEST_GIB = 0.002
REQUEST_BYTES_IN = 2_000
RESPONSE_BYTES_OUT = 18_000

DATASET_BYTES_PER_USER = 2_560
DATASET_BYTES_PER_MATCH_WITH_MOVES = 4_096
DATASET_BYTES_PER_GAME = 20_480
PYTHON_OBJECT_MEMORY_MULTIPLIER = 3.5


def _allocate(total: int, weights: list[float]) -> list[int]:
    """Allocate an integer total proportionally, preserving the exact total."""
    weight_sum = sum(weights)
    if not weights or weight_sum <= 0:
        raise ValueError("weights must have a positive sum")
    exact = [total * weight / weight_sum for weight in weights]
    allocated = [math.floor(value) for value in exact]
    remainder = total - sum(allocated)
    order = sorted(range(len(weights)), key=lambda index: exact[index] % 1, reverse=True)
    for index in order[:remainder]:
        allocated[index] += 1
    return allocated


def _workload_weights(hours: list[datetime], rng: random.Random) -> list[float]:
    weights = []
    for hour in hours:
        hour_of_day = hour.hour + 0.5
        # Peak at 20:00 UTC, quietest around 08:00 UTC, before weekday effects.
        daily_shape = 1.0 + 0.75 * math.cos(
            2 * math.pi * (hour_of_day - 20) / 24
        )
        weekday_shape = 0.82 if hour.weekday() >= 5 else 1.0
        noise = rng.uniform(0.90, 1.10)
        weights.append(daily_shape * weekday_shape * noise)
    return weights


def _safe_round(value: float, places: int = 3) -> float:
    return round(value, places)


def generate(
    *,
    start: datetime,
    days: int = MONTHLY_DAYS,
    seed: int = 20261030,
    mau_share: float = MONTHLY_ACTIVE_USERS_SHARE,
    dau_share_of_mau: float = DAILY_USERS_SHARE_OF_MAU,
    requests_per_dau: int = REQUESTS_PER_DAILY_ACTIVE_USER,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Create hourly synthetic records and a summary for a fixed-size dataset."""
    if start.tzinfo is None:
        raise ValueError("start must be timezone-aware")
    if days <= 0 or requests_per_dau <= 0:
        raise ValueError("days and requests_per_dau must be positive")
    if not 0 <= mau_share <= 1 or not 0 <= dau_share_of_mau <= 1:
        raise ValueError("activity shares must be between 0 and 1")
    start = start.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    hours = [start + timedelta(hours=index) for index in range(days * 24)]
    rng = random.Random(seed)
    weights = _workload_weights(hours, rng)

    mau = round(TARGET["users"] * mau_share)
    dau = round(mau * dau_share_of_mau)
    monthly_requests = dau * requests_per_dau * days
    daily_weights = [
        (0.82 if (start + timedelta(days=index)).weekday() >= 5 else 1.0)
        * rng.uniform(0.95, 1.05)
        for index in range(days)
    ]
    daily_totals = _allocate(monthly_requests, daily_weights)
    hourly_requests: list[int] = []
    for day_index in range(days):
        begin = day_index * 24
        daily_weights = weights[begin : begin + 24]
        hourly_requests.extend(
            _allocate(daily_totals[day_index], daily_weights)
        )

    route_names = list(ROUTES)
    rows: list[dict[str, Any]] = []
    monthly_db_reads = 0
    monthly_db_writes = 0
    monthly_requests_by_route = {name: 0 for name in route_names}
    for index, hour in enumerate(hours):
        requests = hourly_requests[index]
        rps = requests / 3600
        route_counts = _allocate(
            requests, [ROUTES[name] for name in route_names]
        )
        route_requests = dict(zip(route_names, route_counts, strict=True))
        db_reads = round(
            sum(
                route_requests[name] * DB_OPS_PER_REQUEST[name][0]
                for name in route_names
            )
        )
        db_writes = round(
            sum(
                route_requests[name] * DB_OPS_PER_REQUEST[name][1]
                for name in route_names
            )
        )
        monthly_db_reads += db_reads
        monthly_db_writes += db_writes
        for name, count in route_requests.items():
            monthly_requests_by_route[name] += count

        cpu_cores_demanded = rps * CPU_SECONDS_PER_REQUEST
        instances = max(
            MIN_INSTANCES,
            math.ceil(
                cpu_cores_demanded
                / (CPU_CORES_PER_INSTANCE * TARGET_CPU_UTILIZATION)
            ),
        )
        provisioned_cores = instances * CPU_CORES_PER_INSTANCE
        cpu_percent = min(100.0, cpu_cores_demanded / provisioned_cores * 100)
        in_flight = rps * MEAN_REQUEST_SECONDS
        rss_per_instance = (
            BASE_RSS_GIB_PER_INSTANCE
            + (in_flight / instances) * MEMORY_PER_INFLIGHT_REQUEST_GIB
        )
        network_in_mbps = rps * REQUEST_BYTES_IN * 8 / 1_000_000
        network_out_mbps = rps * RESPONSE_BYTES_OUT * 8 / 1_000_000
        latency_noise = rng.uniform(0.95, 1.05)

        row: dict[str, Any] = {
            "timestamp_utc": hour.isoformat(),
            "dataset_users": TARGET["users"],
            "dataset_matches": TARGET["matches"],
            "dataset_games": TARGET["games"],
            "monthly_active_users_assumed": mau,
            "daily_active_users_assumed": dau,
            "http_requests": requests,
            "requests_per_second_avg": _safe_round(rps, 4),
            **{f"requests_{name}": count for name, count in route_requests.items()},
            "match_starts_assumed": round(requests * ROUTES["match_create_join"] * 0.26),
            "firestore_document_reads_estimated": db_reads,
            "firestore_document_writes_estimated": db_writes,
            "api_instances_modeled": instances,
            "api_vcpu_provisioned_modeled": provisioned_cores,
            "api_cpu_utilization_percent_modeled": _safe_round(cpu_percent, 2),
            "api_rss_gib_per_instance_modeled": _safe_round(rss_per_instance, 3),
            "api_fleet_rss_gib_modeled": _safe_round(
                rss_per_instance * instances, 2
            ),
            "network_ingress_mbps_estimated": _safe_round(network_in_mbps, 3),
            "network_egress_mbps_estimated": _safe_round(network_out_mbps, 3),
            "latency_p50_ms_modeled": _safe_round(
                (45 + cpu_percent * 0.25) * latency_noise, 2
            ),
            "latency_p95_ms_modeled": _safe_round(
                (110 + cpu_percent * 0.8) * latency_noise, 2
            ),
            "latency_p99_ms_modeled": _safe_round(
                (200 + cpu_percent * 2.0) * latency_noise, 2
            ),
            "data_provenance": "synthetic_model_not_live_telemetry",
        }
        rows.append(row)

    dataset_bytes = (
        TARGET["users"] * DATASET_BYTES_PER_USER
        + TARGET["matches"] * DATASET_BYTES_PER_MATCH_WITH_MOVES
        + TARGET["games"] * DATASET_BYTES_PER_GAME
    )
    serialized_dataset_gib = dataset_bytes / 1024**3
    summary = {
        "provenance": "Synthetic model only; not measured from GCE or a live benchmark.",
        "period_start_utc": start.isoformat(),
        "period_end_utc_exclusive": (start + timedelta(days=days)).isoformat(),
        "hours": len(rows),
        "dataset_inventory": TARGET,
        "activity_assumptions": {
            "monthly_active_users_share": mau_share,
            "monthly_active_users": mau,
            "daily_active_users_share_of_mau": dau_share_of_mau,
            "daily_active_users": dau,
            "requests_per_daily_active_user_per_day": requests_per_dau,
            "monthly_http_requests": monthly_requests,
            "monthly_match_starts_assumed": sum(
                row["match_starts_assumed"] for row in rows
            ),
            "match_starts_as_share_of_inventory": (
                MONTHLY_MATCH_STARTS_SHARE_OF_INVENTORY
            ),
            "route_mix": ROUTES,
            "hourly_shape": "diurnal UTC peak near 20:00, lower weekends, seeded jitter",
        },
        "resource_model_assumptions": {
            "cpu_seconds_per_request": CPU_SECONDS_PER_REQUEST,
            "mean_request_seconds_for_concurrency": MEAN_REQUEST_SECONDS,
            "vcpu_per_instance": CPU_CORES_PER_INSTANCE,
            "autoscaling_cpu_target_percent": TARGET_CPU_UTILIZATION * 100,
            "minimum_api_instances": MIN_INSTANCES,
            "base_rss_gib_per_instance": BASE_RSS_GIB_PER_INSTANCE,
            "request_bytes_in": REQUEST_BYTES_IN,
            "response_bytes_out": RESPONSE_BYTES_OUT,
            "firestore_ops_per_route_request": {
                name: {"reads": values[0], "writes": values[1]}
                for name, values in DB_OPS_PER_REQUEST.items()
            },
        },
        "monthly_summary": {
            "http_requests_by_route": monthly_requests_by_route,
            "http_requests_total": sum(row["http_requests"] for row in rows),
            "average_requests_per_second": _safe_round(
                monthly_requests / (days * 24 * 3600), 3
            ),
            "peak_hour_requests_per_second": max(
                row["requests_per_second_avg"] for row in rows
            ),
            "estimated_firestore_document_reads": monthly_db_reads,
            "estimated_firestore_document_writes": monthly_db_writes,
            "estimated_network_ingress_gib": _safe_round(
                monthly_requests * REQUEST_BYTES_IN / 1024**3, 2
            ),
            "estimated_network_egress_gib": _safe_round(
                monthly_requests * RESPONSE_BYTES_OUT / 1024**3, 2
            ),
            "average_api_instances_modeled": _safe_round(
                sum(row["api_instances_modeled"] for row in rows) / len(rows), 2
            ),
            "peak_api_instances_modeled": max(
                row["api_instances_modeled"] for row in rows
            ),
            "peak_api_cpu_utilization_percent_modeled": max(
                row["api_cpu_utilization_percent_modeled"] for row in rows
            ),
            "peak_network_egress_mbps_estimated": max(
                row["network_egress_mbps_estimated"] for row in rows
            ),
            "max_modeled_latency_p95_ms": max(
                row["latency_p95_ms_modeled"] for row in rows
            ),
            "max_modeled_latency_p99_ms": max(
                row["latency_p99_ms_modeled"] for row in rows
            ),
        },
        "memory_warning": {
            "serialized_full_dataset_gib_rough_estimate": _safe_round(
                serialized_dataset_gib, 1
            ),
            "python_in_memory_gib_rough_estimate_at_multiplier": _safe_round(
                serialized_dataset_gib * PYTHON_OBJECT_MEMORY_MULTIPLIER, 1
            ),
            "assumed_bytes_per_record": {
                "user": DATASET_BYTES_PER_USER,
                "match_including_moves": DATASET_BYTES_PER_MATCH_WITH_MOVES,
                "game": DATASET_BYTES_PER_GAME,
            },
            "python_overhead_multiplier": PYTHON_OBJECT_MEMORY_MULTIPLIER,
            "warning": (
                "Rough invented sizing assumptions only. This snapshot-based server "
                "cannot safely load the target inventory into one VM; this estimate "
                "is not a capacity claim."
            ),
        },
        "caveats": [
            "All traffic, latency, Firestore operation, CPU, memory, and network values are synthetic estimates.",
            "No GCE monitoring metrics were read and no HTTP load test was run.",
            "Resource fields model a hypothetical request-time persistence API fleet, not the current snapshot-based server.",
            "Firestore operation counts use assumed per-route averages and exclude index, retry, and background operations.",
            "This model does not establish that the current deployment can serve the target dataset or workload.",
        ],
    }
    return rows, summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default="2026-09-30T16:00:00+00:00")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--seed", type=int, default=20261030)
    parser.add_argument("--csv", type=Path, default=Path("reports/scaling-traffic-30d.csv"))
    parser.add_argument(
        "--summary",
        type=Path,
        default=Path("reports/scaling-traffic-30d-summary.json"),
    )
    args = parser.parse_args()
    start = datetime.fromisoformat(args.start)
    rows, summary = generate(start=start, days=args.days, seed=args.seed)
    args.csv.parent.mkdir(parents=True, exist_ok=True)
    args.summary.parent.mkdir(parents=True, exist_ok=True)
    with args.csv.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    args.summary.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {len(rows)} synthetic hourly records to {args.csv} "
        f"and summary to {args.summary}"
    )
    print(json.dumps(summary["monthly_summary"], indent=2))


if __name__ == "__main__":
    main()
