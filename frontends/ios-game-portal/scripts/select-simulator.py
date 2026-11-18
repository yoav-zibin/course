#!/usr/bin/env python3
"""Select an available iPhone, preferring a mature iOS 18 baseline on Intel CI."""
import json
import re
import sys


def select_iphone(catalog):
    runtimes = sorted(
        (runtime for runtime in catalog["devices"] if ".iOS-" in runtime),
        # iOS 26 cold migration/WebKit startup is unreliable on the Intel pool.
        # Use its installed iOS 18 baseline when present, then fall back to the
        # newest installed runtime as runner images evolve.
        key=lambda runtime: (".iOS-18-" in runtime,
                             tuple(map(int, re.findall(r"\d+", runtime)))),
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
