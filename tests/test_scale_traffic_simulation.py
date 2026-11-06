from datetime import datetime, timezone

from game_platform.scale_traffic_simulation import ROUTES, generate


def test_monthly_simulation_is_reproducible_and_totals_reconcile() -> None:
    start = datetime(2026, 10, 1, tzinfo=timezone.utc)
    rows, summary = generate(start=start, days=30, seed=3)
    repeated_rows, repeated_summary = generate(start=start, days=30, seed=3)

    assert rows == repeated_rows
    assert summary == repeated_summary
    assert len(rows) == 30 * 24
    assert sum(row["http_requests"] for row in rows) == 480_000_000
    for row in rows:
        route_total = sum(row[f"requests_{route}"] for route in ROUTES)
        assert route_total == row["http_requests"]
        assert row["data_provenance"] == "synthetic_model_not_live_telemetry"
        assert row["api_instances_modeled"] >= 2
        assert row["api_cpu_utilization_percent_modeled"] <= 65


def test_simulation_rejects_naive_start_time() -> None:
    try:
        generate(start=datetime(2026, 10, 1))
    except ValueError as error:
        assert "timezone-aware" in str(error)
    else:
        raise AssertionError("naive start time should be rejected")
