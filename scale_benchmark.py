"""Run a staged, concurrent HTTP benchmark against a deployed game-platform API.

The request mix is supplied in JSON so the same workload can be used against a
single VM and a load balancer. See benchmark.requests.example.json.
"""

from __future__ import annotations

import argparse
import http.client
import json
import math
import random
import ssl
import statistics
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlsplit


@dataclass(frozen=True)
class RequestSpec:
    method: str
    path: str
    weight: int = 1
    headers: dict[str, str] | None = None
    json: Any = None


def _parse_requests(path: Path, allow_write: bool) -> list[RequestSpec]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list) or not raw:
        raise ValueError("request file must contain a non-empty JSON array")
    requests: list[RequestSpec] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError(f"request {index + 1} must be an object")
        method = str(item.get("method", "GET")).upper()
        endpoint = item.get("path")
        weight = item.get("weight", 1)
        headers = item.get("headers", {})
        if method not in {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"}:
            raise ValueError(f"request {index + 1} has unsupported method {method!r}")
        if method not in {"GET", "HEAD"} and not allow_write:
            raise ValueError(
                f"request {index + 1} uses {method}; rerun with --allow-write "
                "only against an isolated benchmark database"
            )
        if not isinstance(endpoint, str) or not endpoint.startswith("/"):
            raise ValueError(f"request {index + 1} path must start with '/'")
        if not isinstance(weight, int) or weight < 1:
            raise ValueError(f"request {index + 1} weight must be a positive integer")
        if not isinstance(headers, dict) or not all(
            isinstance(key, str) and isinstance(value, str)
            for key, value in headers.items()
        ):
            raise ValueError(f"request {index + 1} headers must map strings to strings")
        requests.append(
            RequestSpec(
                method=method,
                path=endpoint,
                weight=weight,
                headers=headers,
                json=item.get("json"),
            )
        )
    return requests


def _percentile(samples: list[float], percentile: float) -> float:
    ordered = sorted(samples)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * percentile
    lower = math.floor(rank)
    upper = math.ceil(rank)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (rank - lower)


def _report_request(request: RequestSpec) -> dict[str, Any]:
    item = asdict(request)
    item["headers"] = {
        key: "[redacted]"
        if any(
            word in key.lower()
            for word in ("password", "token", "secret", "authorization")
        )
        else value
        for key, value in (request.headers or {}).items()
    }
    return item


def _stage(
    *,
    base_url: str,
    requests: list[RequestSpec],
    headers: dict[str, str],
    concurrency: int,
    duration_seconds: float,
    timeout_seconds: float,
) -> dict[str, Any]:
    origin = urlsplit(base_url)
    if origin.scheme not in {"http", "https"} or not origin.hostname:
        raise ValueError("base URL must be an http:// or https:// origin")
    secure = origin.scheme == "https"
    samples: list[tuple[float, int | None, str | None]] = []
    samples_lock = threading.Lock()
    cumulative: list[int] = []
    for request in requests:
        cumulative.append((cumulative[-1] if cumulative else 0) + request.weight)
    total_weight = cumulative[-1]
    deadline: list[float] = [0]
    start_gate = threading.Event()

    def new_connection() -> http.client.HTTPConnection:
        connection_type = (
            http.client.HTTPSConnection if secure else http.client.HTTPConnection
        )
        options: dict[str, Any] = {"timeout": timeout_seconds}
        if secure:
            options["context"] = ssl.create_default_context()
        return connection_type(origin.hostname, origin.port, **options)

    def worker(worker_id: int) -> None:
        rng = random.Random(worker_id ^ time.time_ns())
        connection = new_connection()
        start_gate.wait()
        while time.monotonic() < deadline[0]:
            choice = rng.randrange(total_weight)
            request_index = next(
                index for index, end in enumerate(cumulative) if choice < end
            )
            spec = requests[request_index]
            request_headers = {**headers, **(spec.headers or {})}
            url = urlsplit(urljoin(base_url.rstrip("/") + "/", spec.path.lstrip("/")))
            target = url.path or "/"
            if url.query:
                target += "?" + url.query
            body = (
                json.dumps(spec.json, separators=(",", ":")).encode("utf-8")
                if spec.json is not None
                else None
            )
            if body is not None:
                request_headers.setdefault("Content-Type", "application/json")
            started = time.perf_counter()
            try:
                connection.request(
                    spec.method, target, body=body, headers=request_headers
                )
                response = connection.getresponse()
                response.read()
                result = (time.perf_counter() - started, response.status, None)
                if response.will_close:
                    connection.close()
            except (OSError, http.client.HTTPException, ssl.SSLError) as error:
                connection.close()
                connection = new_connection()
                result = (time.perf_counter() - started, None, type(error).__name__)
            with samples_lock:
                samples.append(result)

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(worker, index) for index in range(concurrency)]
        started = time.monotonic()
        deadline[0] = started + duration_seconds
        start_gate.set()
        time.sleep(duration_seconds)
        elapsed = time.monotonic() - started
        for future in futures:
            future.result()
    latencies = [latency * 1000 for latency, _, _ in samples]
    statuses = Counter(str(status) for _, status, error in samples if error is None)
    errors = Counter(error for _, _, error in samples if error is not None)
    errors.update(
        f"HTTP {status}"
        for _, status, error in samples
        if error is None and (status is None or status >= 400)
    )
    count = len(samples)
    return {
        "concurrency": concurrency,
        "elapsed_seconds": round(elapsed, 3),
        "requests": count,
        "requests_per_second": round(count / elapsed, 2) if elapsed else 0,
        "errors": sum(errors.values()),
        "error_rate_percent": round(sum(errors.values()) * 100 / count, 3)
        if count
        else 0,
        "http_statuses": dict(statuses),
        "error_types": dict(errors),
        "latency_ms": {
            "min": round(min(latencies), 2) if latencies else None,
            "mean": round(statistics.fmean(latencies), 2) if latencies else None,
            "p50": round(_percentile(latencies, 0.50), 2) if latencies else None,
            "p95": round(_percentile(latencies, 0.95), 2) if latencies else None,
            "p99": round(_percentile(latencies, 0.99), 2) if latencies else None,
            "max": round(max(latencies), 2) if latencies else None,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url", required=True, help="API origin, e.g. https://api.example"
    )
    parser.add_argument("--requests", type=Path, required=True, help="JSON request-mix file")
    parser.add_argument("--stages", default="1,2,4,8", help="comma-separated client counts")
    parser.add_argument("--duration-seconds", type=float, default=30)
    parser.add_argument("--timeout-seconds", type=float, default=10)
    parser.add_argument(
        "--headers-file", type=Path, help="JSON object of shared request headers"
    )
    parser.add_argument("--header", action="append", default=[], metavar="NAME=VALUE")
    parser.add_argument("--allow-write", action="store_true")
    parser.add_argument("--report", type=Path, help="also save full results as JSON")
    args = parser.parse_args()

    if args.duration_seconds <= 0 or args.timeout_seconds <= 0:
        parser.error("duration and timeout must be positive")
    try:
        stages = [int(value) for value in args.stages.split(",")]
        if not stages or any(value < 1 for value in stages):
            raise ValueError
    except ValueError:
        parser.error("--stages must be comma-separated positive integers")
    headers: dict[str, str] = {}
    if args.headers_file:
        try:
            file_headers = json.loads(args.headers_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            parser.error(f"could not read headers file: {error}")
        if not isinstance(file_headers, dict) or not all(
            isinstance(name, str) and isinstance(value, str)
            for name, value in file_headers.items()
        ):
            parser.error("headers file must be a JSON object mapping strings to strings")
        headers.update(file_headers)
    for value in args.header:
        name, separator, content = value.partition("=")
        if not separator or not name:
            parser.error("each --header must use NAME=VALUE")
        headers[name] = content
    try:
        requests = _parse_requests(args.requests, args.allow_write)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        parser.error(str(error))

    report = {
        "base_url": args.base_url,
        "request_mix": [_report_request(request) for request in requests],
        "stages": [],
    }
    print(f"Target: {args.base_url}")
    print(
        f"Request mix: {len(requests)} routes; "
        f"duration per stage: {args.duration_seconds}s"
    )
    for concurrency in stages:
        print(f"\nRunning {concurrency} concurrent clients...", flush=True)
        result = _stage(
            base_url=args.base_url,
            requests=requests,
            headers=headers,
            concurrency=concurrency,
            duration_seconds=args.duration_seconds,
            timeout_seconds=args.timeout_seconds,
        )
        report["stages"].append(result)
        print(
            f"{result['requests_per_second']} req/s | "
            f"p95 {result['latency_ms']['p95']} ms | "
            f"errors {result['error_rate_percent']}%"
        )
    serialized = json.dumps(report, indent=2)
    if args.report:
        args.report.write_text(serialized + "\n", encoding="utf-8")
        print(f"\nSaved report to {args.report}")
    print("\nFull results:\n" + serialized)


if __name__ == "__main__":
    main()
