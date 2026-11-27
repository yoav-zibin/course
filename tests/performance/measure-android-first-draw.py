"""Record Android's time to initial display for five cold release launches."""
import argparse
import json
from pathlib import Path
import re
import subprocess


def measure(serial, package):
    adb = ["adb", "-s", serial]
    if subprocess.check_output([*adb, "shell", "getprop", "ro.kernel.qemu"], text=True).strip() != "1":
        raise RuntimeError("Use a disposable emulator for cold-start measurements")
    component = subprocess.check_output(
        [*adb, "shell", "cmd", "package", "resolve-activity", "--brief", package],
        text=True, timeout=30,
    ).strip().splitlines()[-1]
    if not component.startswith(package + "/"):
        raise RuntimeError(f"Could not resolve the installed launch activity: {component}")
    samples = []
    for _ in range(5):
        result = subprocess.check_output([
            *adb, "shell", "am", "start", "-S", "-W", "-n", component,
            "--ez", "buildplayLocalUiTest", "true",
        ], text=True, timeout=45)
        total = re.search(r"^TotalTime: (\d+)$", result, re.MULTILINE)
        if not total or int(total[1]) <= 0 or "LaunchState: COLD" not in result:
            raise RuntimeError(f"Android did not report a cold draw:\n{result}")
        samples.append(int(total[1]))
    return samples


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--package", default="fun.buildplay.debug")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    samples = measure(args.serial, args.package)
    args.output.write_text(json.dumps(samples) + "\n")
    print("Android first-draw samples (ms):", samples)
