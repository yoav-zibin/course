"""Render the synthetic monthly scaling CSV as dependency-free SVG line charts."""

from __future__ import annotations

import argparse
import csv
import html
from datetime import datetime
from pathlib import Path
from typing import Any

WIDTH = 1200
HEIGHT = 560
MARGIN = {"left": 100, "right": 45, "top": 100, "bottom": 75}
COLORS = ("#2563eb", "#e11d48", "#059669", "#d97706", "#7c3aed")
PROVENANCE = "Synthetic model — not measured GCE telemetry"


def _number(row: dict[str, str], column: str) -> float:
    return float(row[column])


def _axis_label(value: float) -> str:
    magnitude = abs(value)
    if magnitude >= 1_000_000_000:
        return f"{value / 1_000_000_000:.1f}B"
    if magnitude >= 1_000_000:
        return f"{value / 1_000_000:.1f}M"
    if magnitude >= 10_000:
        return f"{value / 1_000:.0f}k"
    if magnitude >= 1_000:
        return f"{value / 1_000:.1f}k"
    if magnitude >= 100:
        return f"{value:.0f}"
    if magnitude >= 10:
        return f"{value:.1f}"
    return f"{value:.2f}"


def _series_path(
    values: list[float],
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    minimum: float,
    maximum: float,
) -> str:
    count = len(values)
    points = []
    for index, value in enumerate(values):
        x_pos = x + index / max(count - 1, 1) * width
        y_pos = y + (maximum - value) / (maximum - minimum) * height
        points.append(f"{x_pos:.2f},{y_pos:.2f}")
    return " ".join(points)


def render_chart(
    *,
    title: str,
    subtitle: str,
    timestamps: list[str],
    series: list[tuple[str, list[float]]],
    y_label: str,
) -> str:
    if not timestamps or any(len(values) != len(timestamps) for _, values in series):
        raise ValueError("chart series must be non-empty and match the timestamps")
    all_values = [value for _, values in series for value in values]
    minimum, maximum = min(all_values), max(all_values)
    if minimum == maximum:
        padding = max(abs(minimum) * 0.1, 1)
        minimum -= padding
        maximum += padding
    else:
        padding = (maximum - minimum) * 0.08
        minimum = min(0, minimum - padding) if minimum >= 0 else minimum - padding
        maximum += padding

    left = MARGIN["left"]
    top = MARGIN["top"]
    plot_width = WIDTH - MARGIN["left"] - MARGIN["right"]
    plot_height = HEIGHT - MARGIN["top"] - MARGIN["bottom"]
    bottom = top + plot_height
    right = left + plot_width
    svg: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" role="img" '
        f'aria-labelledby="title description" viewBox="0 0 {WIDTH} {HEIGHT}">',
        "<title id=\"title\">" + html.escape(title) + "</title>",
        "<desc id=\"description\">" + html.escape(subtitle) + "</desc>",
        f'<rect width="{WIDTH}" height="{HEIGHT}" fill="#ffffff"/>',
        '<style>text{font-family:Inter,Arial,sans-serif;fill:#172033}'
        '.muted{fill:#667085}.grid{stroke:#e5e7eb;stroke-width:1}'
        '.axis{stroke:#475467;stroke-width:1.2}</style>',
        f'<text x="{left}" y="38" font-size="25" font-weight="700">'
        + html.escape(title)
        + "</text>",
        f'<text x="{left}" y="65" font-size="14" class="muted">'
        + html.escape(subtitle)
        + "</text>",
    ]

    for tick in range(6):
        fraction = tick / 5
        y_pos = top + fraction * plot_height
        value = maximum - fraction * (maximum - minimum)
        svg.append(
            f'<line x1="{left}" y1="{y_pos:.2f}" x2="{right}" '
            f'y2="{y_pos:.2f}" class="grid"/>'
        )
        svg.append(
            f'<text x="{left - 12}" y="{y_pos + 5:.2f}" text-anchor="end" '
            f'font-size="12" class="muted">{_axis_label(value)}</text>'
        )

    tick_indices = sorted(
        {round(index * (len(timestamps) - 1) / 5) for index in range(6)}
    )
    for index in tick_indices:
        x_pos = left + index / max(len(timestamps) - 1, 1) * plot_width
        label = datetime.fromisoformat(timestamps[index]).strftime("%b %d")
        svg.append(
            f'<line x1="{x_pos:.2f}" y1="{bottom}" x2="{x_pos:.2f}" '
            f'y2="{bottom + 5}" class="axis"/>'
        )
        svg.append(
            f'<text x="{x_pos:.2f}" y="{bottom + 25}" text-anchor="middle" '
            f'font-size="12" class="muted">{html.escape(label)}</text>'
        )

    svg.extend(
        [
            f'<line x1="{left}" y1="{top}" x2="{left}" y2="{bottom}" class="axis"/>',
            f'<line x1="{left}" y1="{bottom}" x2="{right}" y2="{bottom}" class="axis"/>',
            f'<text transform="translate(24 {top + plot_height / 2:.2f}) '
            f'rotate(-90)" text-anchor="middle" font-size="13">'
            + html.escape(y_label)
            + "</text>",
        ]
    )

    for index, (name, values) in enumerate(series):
        color = COLORS[index % len(COLORS)]
        points = _series_path(
            values,
            x=left,
            y=top,
            width=plot_width,
            height=plot_height,
            minimum=minimum,
            maximum=maximum,
        )
        svg.append(
            f'<polyline points="{points}" fill="none" stroke="{color}" '
            'stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/>'
        )

    legend_y = HEIGHT - 18
    legend_x = left
    legend_row = 0
    legend_right = WIDTH - MARGIN["right"]
    for index, (name, _) in enumerate(series):
        color = COLORS[index % len(COLORS)]
        label_width = 32 + max(80, len(name) * 7.5)
        if legend_x + label_width > legend_right and legend_x > left:
            legend_row += 1
            legend_x = left
        current_y = legend_y - legend_row * 22
        svg.append(
            f'<line x1="{legend_x}" y1="{current_y - 4}" x2="{legend_x + 25}" '
            f'y2="{current_y - 4}" stroke="{color}" stroke-width="3"/>'
        )
        svg.append(
            f'<text x="{legend_x + 32}" y="{current_y}" font-size="13">'
            + html.escape(name)
            + "</text>"
        )
        legend_x += label_width
    svg.append("</svg>")
    return "\n".join(svg)


def _load_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as file:
        rows = list(csv.DictReader(file))
    if not rows:
        raise ValueError(f"{path} has no data rows")
    if any(row.get("data_provenance") != "synthetic_model_not_live_telemetry" for row in rows):
        raise ValueError("input CSV is missing the expected synthetic provenance marker")
    return rows


def generate_graphs(csv_path: Path, output_dir: Path) -> list[Path]:
    rows = _load_rows(csv_path)
    timestamps = [row["timestamp_utc"] for row in rows]
    charts = {
        "requests-per-second.svg": (
            "HTTP request rate",
            "Hourly average request rate · " + PROVENANCE,
            [("Requests per second", "requests_per_second_avg")],
            "Requests / second",
        ),
        "hourly-route-mix.svg": (
            "Hourly HTTP requests by route",
            "Hourly route-category counts · " + PROVENANCE,
            [
                (label.replace("_", " ").title(), f"requests_{column}")
                for label, column in (
                    ("Auth / profile", "auth_profile"),
                    ("Game catalog", "game_catalog"),
                    ("Match history", "match_history"),
                    ("Match details", "match_details"),
                    ("Open / quick match", "open_quick_match"),
                    ("Create / join", "match_create_join"),
                    ("Match moves", "match_moves"),
                    ("Invites / social", "invites_social"),
                    ("Health checks", "health_checks"),
                )
            ],
            "Requests / hour",
        ),
        "api-instances.svg": (
            "Modeled API instance count",
            "Hypothetical request-time API tier · " + PROVENANCE,
            [("API instances", "api_instances_modeled")],
            "Instances",
        ),
        "api-cpu.svg": (
            "Modeled API CPU utilization",
            "Four vCPU per instance; 65% autoscaling target · " + PROVENANCE,
            [("CPU utilization (%)", "api_cpu_utilization_percent_modeled")],
            "Percent",
        ),
        "firestore-operations.svg": (
            "Estimated Firestore document operations",
            "Assumed per-route operations · " + PROVENANCE,
            [
                ("Document reads", "firestore_document_reads_estimated"),
                ("Document writes", "firestore_document_writes_estimated"),
            ],
            "Document operations / hour",
        ),
        "network-throughput.svg": (
            "Estimated network throughput",
            "Assumed payload sizes: 2 KB request, 18 KB response · " + PROVENANCE,
            [
                ("Ingress Mbps", "network_ingress_mbps_estimated"),
                ("Egress Mbps", "network_egress_mbps_estimated"),
            ],
            "Megabits / second",
        ),
        "modeled-latency.svg": (
            "Modeled API latency percentiles",
            "Illustrative latency model, not request measurements · " + PROVENANCE,
            [
                ("p50", "latency_p50_ms_modeled"),
                ("p95", "latency_p95_ms_modeled"),
                ("p99", "latency_p99_ms_modeled"),
            ],
            "Milliseconds",
        ),
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for filename, (title, subtitle, definitions, y_label) in charts.items():
        series = [
            (label, [_number(row, column) for row in rows])
            for label, column in definitions
        ]
        svg = render_chart(
            title=title,
            subtitle=subtitle,
            timestamps=timestamps,
            series=series,
            y_label=y_label,
        )
        path = output_dir / filename
        path.write_text(svg + "\n", encoding="utf-8")
        paths.append(path)

    image_tags = "\n".join(
        f'<figure><img src="{path.name}" alt="{html.escape(path.stem.replace("-", " "))}">'
        f"<figcaption>{html.escape(path.stem.replace('-', ' ').title())}</figcaption></figure>"
        for path in paths
    )
    dashboard = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Synthetic monthly scaling charts</title>
<style>
body{{margin:0;background:#f3f5f8;color:#172033;font:16px/1.5 Inter,Arial,sans-serif}}
main{{max-width:1280px;margin:36px auto;padding:0 20px}}
h1{{margin-bottom:4px}}.notice{{padding:14px 18px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px}}
.charts{{display:grid;grid-template-columns:repeat(auto-fit,minmax(520px,1fr));gap:20px;margin-top:24px}}
figure{{margin:0;background:white;border-radius:10px;padding:12px;box-shadow:0 2px 8px #10182812}}
img{{display:block;width:100%;height:auto}}figcaption{{padding:8px 12px;color:#667085}}
@media(max-width:600px){{.charts{{grid-template-columns:1fr}}}}
</style>
</head>
<body><main>
<h1>Synthetic monthly scaling scenario</h1>
<p class="notice"><strong>Modeled data only.</strong> These charts are generated from
assumptions for a 10M-user / 1B-match / 100K-game inventory. These are not measured
GCE telemetry, a production trace, or an HTTP load-test result.</p>
<section class="charts">{image_tags}</section>
</main></body></html>
"""
    html_path = output_dir / "index.html"
    html_path.write_text(dashboard, encoding="utf-8")
    paths.append(html_path)
    return paths


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--csv",
        type=Path,
        default=Path("reports/scaling-traffic-30d.csv"),
    )
    parser.add_argument("--output-dir", type=Path, default=Path("reports/graphs"))
    args = parser.parse_args()
    paths = generate_graphs(args.csv, args.output_dir)
    print(f"Wrote {len(paths) - 1} SVG charts and dashboard {paths[-1]}")


if __name__ == "__main__":
    main()
