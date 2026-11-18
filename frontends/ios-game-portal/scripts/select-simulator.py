#!/usr/bin/env python3
"""Select an available iPhone from simctl JSON, preferring the newest iOS."""
import json
import re
import sys


def select_iphone(catalog):
    runtimes = sorted(
        (runtime for runtime in catalog["devices"] if ".iOS-" in runtime),
        key=lambda runtime: tuple(map(int, re.findall(r"\d+", runtime))),
        reverse=True,
    )
    for runtime in runtimes:
        for device in catalog["devices"][runtime]:
            if device.get("isAvailable", True) and device["name"].startswith("iPhone"):
                return device
    raise SystemExit("No available iPhone simulator; inspect simulators.json in test artifacts.")


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as handle:
        device = select_iphone(json.load(handle))
    print(device["udid"])
