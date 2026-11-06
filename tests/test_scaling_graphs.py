import csv
from pathlib import Path

from game_platform.reports.generate_graphs import generate_graphs


def test_generate_graphs_creates_labeled_svg_and_dashboard(
    tmp_path: Path,
) -> None:
    source = tmp_path / "input.csv"
    with source.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=(
                "timestamp_utc",
                "data_provenance",
                "requests_per_second_avg",
                "api_instances_modeled",
                "api_cpu_utilization_percent_modeled",
                "firestore_document_reads_estimated",
                "firestore_document_writes_estimated",
                "network_ingress_mbps_estimated",
                "network_egress_mbps_estimated",
                "latency_p50_ms_modeled",
                "latency_p95_ms_modeled",
                "latency_p99_ms_modeled",
                *(f"requests_{name}" for name in (
                    "auth_profile",
                    "game_catalog",
                    "match_history",
                    "match_details",
                    "open_quick_match",
                    "match_create_join",
                    "match_moves",
                    "invites_social",
                    "health_checks",
                )),
            ),
        )
        writer.writeheader()
        for hour in range(2):
            writer.writerow(
                {
                    "timestamp_utc": f"2026-10-01T{hour:02d}:00:00+00:00",
                    "data_provenance": "synthetic_model_not_live_telemetry",
                    "requests_per_second_avg": 10 + hour,
                    "api_instances_modeled": 2 + hour,
                    "api_cpu_utilization_percent_modeled": 40 + hour,
                    "firestore_document_reads_estimated": 100 + hour,
                    "firestore_document_writes_estimated": 20 + hour,
                    "network_ingress_mbps_estimated": 1 + hour,
                    "network_egress_mbps_estimated": 5 + hour,
                    "latency_p50_ms_modeled": 40 + hour,
                    "latency_p95_ms_modeled": 100 + hour,
                    "latency_p99_ms_modeled": 200 + hour,
                    **{
                        f"requests_{name}": 1
                        for name in (
                            "auth_profile",
                            "game_catalog",
                            "match_history",
                            "match_details",
                            "open_quick_match",
                            "match_create_join",
                            "match_moves",
                            "invites_social",
                            "health_checks",
                        )
                    },
                }
            )

    output = tmp_path / "graphs"
    paths = generate_graphs(source, output)
    assert len(paths) == 8
    assert (output / "index.html").exists()
    svg_paths = list(output.glob("*.svg"))
    assert len(svg_paths) == 7
    assert all("Synthetic model" in path.read_text(encoding="utf-8") for path in svg_paths)
    dashboard = " ".join(
        (output / "index.html").read_text(encoding="utf-8").split()
    )
    assert "not measured GCE telemetry" in dashboard
    assert "modeled-latency.svg" in dashboard
