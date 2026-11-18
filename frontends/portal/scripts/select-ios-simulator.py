#!/usr/bin/env python3
"""Choose an available iPhone without relying on simulator/model name ordering."""

import json
import re
import sys


def select_simulator(data):
    candidates = []
    for runtime, devices in data.get("devices", {}).items():
        match = re.fullmatch(r"(?:com\.apple\.CoreSimulator\.SimRuntime\.)?iOS[- ](\d+(?:[-.]\d+)*)", runtime)
        if not match:
            continue
        version = tuple(int(part) for part in re.split(r"[-.]", match.group(1)))
        # Prefer the mature iOS 18 runtime when installed; otherwise choose the
        # newest available runtime numerically, independent of model names.
        runtime_rank = (version[0] == 18, version)
        for device in devices:
            if not device.get("isAvailable") or not device.get("name", "").startswith("iPhone") or not device.get("udid"):
                continue
            candidates.append((runtime_rank, device.get("state") == "Booted", device["name"], device["udid"], runtime))
    if not candidates:
        raise ValueError("No available iPhone simulator on the selected runner")
    rank = max(candidate[0] for candidate in candidates)
    same_runtime = [candidate for candidate in candidates if candidate[0] == rank]
    chosen = min(same_runtime, key=lambda candidate: (not candidate[1], candidate[2], candidate[3]))
    return {"udid": chosen[3], "name": chosen[2], "runtime": chosen[4], "version": ".".join(map(str, chosen[0][1])), "booted": chosen[1]}


if __name__ == "__main__":
    try:
        with open(sys.argv[1]) as source:
            print(json.dumps(select_simulator(json.load(source))))
    except (IndexError, OSError, ValueError) as error:
        raise SystemExit(str(error))
