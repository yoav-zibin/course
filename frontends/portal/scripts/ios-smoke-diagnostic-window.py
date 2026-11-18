#!/usr/bin/env python3
"""Select the actual failing launch window, excluding later diagnostic phases."""

import datetime as dt
import json
from pathlib import Path
import sys


CORE_PHASES = {"list-devices", "boot", "install", "launch", "screenshot", "processes"}


def diagnostic_window(phases, now=None):
    # A reused results directory may contain a previous successful invocation.
    beginning = max((index for index, phase in enumerate(phases) if phase.get("phase") == "list-devices"), default=0)
    core = [phase for phase in phases[beginning:] if phase.get("phase") in CORE_PHASES]
    if core:
        final = core[-1]
        launch = next((phase for phase in reversed(core) if phase.get("phase") == "launch"), final)
        started = dt.datetime.fromisoformat(launch["started_at"])
        ended = dt.datetime.fromisoformat(final["finished_at"]) if final.get("finished_at") else dt.datetime.fromisoformat(final["started_at"]) + dt.timedelta(seconds=float(final["elapsed_seconds"]))
        source_phase = final["phase"]
    else:
        ended = now or dt.datetime.now(dt.timezone.utc)
        started = ended - dt.timedelta(seconds=30)
        source_phase = "before-first-phase"
    if started.tzinfo is None or ended.tzinfo is None:
        raise ValueError("Phase timestamps must include their UTC offset")
    start = started.astimezone(dt.timezone.utc) - dt.timedelta(seconds=5)
    end = ended.astimezone(dt.timezone.utc) + dt.timedelta(seconds=5)
    return {"source_phase": source_phase, "phase_started_at": started.isoformat(), "phase_finished_at": ended.isoformat(), "padding_seconds": 5, "start": start.strftime("%Y-%m-%d %H:%M:%S%z"), "end": end.strftime("%Y-%m-%d %H:%M:%S%z")}


if __name__ == "__main__":
    phases = []
    path = Path(sys.argv[1])
    if path.exists():
        for line in path.read_text().splitlines():
            try:
                phases.append(json.loads(line))
            except ValueError:
                pass  # A killed phase can leave its final JSONL line incomplete.
    window = diagnostic_window(phases)
    Path(sys.argv[2]).write_text(json.dumps(window) + "\n")
    print(window["start"] + "|" + window["end"])
