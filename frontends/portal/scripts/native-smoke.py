#!/usr/bin/env python3
"""Play the bundled game through Android UI controls; never create server data.

Usage: native-smoke.py PACKAGE OUTPUT_DIRECTORY [--adb /path/to/adb]
The standalone app must already be installed. Saves and account credentials are
kept intact. XML and screenshots document each checked transition for CI.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import unicodedata
import xml.etree.ElementTree as ET
from pathlib import Path


def normalized(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).replace("’", "'").split()).casefold()


def bounds(node: ET.Element) -> tuple[int, int, int, int] | None:
    match = re.fullmatch(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]", node.get("bounds", ""))
    if not match:
        return None
    left, top, right, bottom = map(int, match.groups())
    return (left, top, right, bottom) if right > left and bottom > top else None


def intersection(*rectangles: tuple[int, int, int, int]) -> tuple[int, int, int, int] | None:
    left = max(rectangle[0] for rectangle in rectangles)
    top = max(rectangle[1] for rectangle in rectangles)
    right = min(rectangle[2] for rectangle in rectangles)
    bottom = min(rectangle[3] for rectangle in rectangles)
    return (left, top, right, bottom) if right > left and bottom > top else None


class NativeSmoke:
    def __init__(self, package: str, output: Path, adb: str):
        self.package, self.output, self.adb = package, output, adb
        output.mkdir(parents=True, exist_ok=True)
        self.last_xml = ""
        self.events: list[dict] = []
        sizes = re.findall(r"(\d+)x(\d+)", self.command("shell", "wm", "size"))
        if not sizes:
            raise RuntimeError("Android did not report its display size")
        self.width, self.height = map(int, sizes[-1])

    def command(self, *arguments: str, timeout: int = 25) -> str:
        result = subprocess.run([self.adb, *arguments], capture_output=True, text=True, timeout=timeout)
        if result.returncode:
            raise RuntimeError(f"adb {arguments[0]} failed: {result.stderr.strip() or result.stdout.strip()}")
        return result.stdout.strip()

    def dump(self) -> ET.Element:
        # UIAutomator includes SVG virtual accessibility nodes when available.
        # Do not use a JavaScript debug bridge or inject game moves.
        self.command("shell", "uiautomator", "dump", "--compressed", "/sdcard/buildplay-native-smoke.xml")
        raw = self.command("shell", "cat", "/sdcard/buildplay-native-smoke.xml")
        start, end = raw.find("<hierarchy"), raw.rfind("</hierarchy>")
        if start < 0 or end < 0:
            raise RuntimeError("UIAutomator did not return an Android view hierarchy")
        self.last_xml = raw[start:end + len("</hierarchy>")]
        return ET.fromstring(self.last_xml)

    @staticmethod
    def labels(node: ET.Element) -> list[str]:
        return [normalized(node.get(key, "")) for key in ("content-desc", "text") if node.get(key)]

    def find(self, tree: ET.Element, label: str, *, contains: bool = False, clickable: bool = False) -> ET.Element | None:
        wanted = normalized(label)
        parents = {child: parent for parent in tree.iter() for child in parent}
        candidates: list[tuple[int, int, ET.Element]] = []
        for node in tree.iter("node"):
            values = self.labels(node)
            if not any(wanted in value if contains else wanted == value for value in values):
                continue
            target, score = node, 0
            if clickable:
                while target.get("clickable") != "true" and target in parents:
                    target = parents[target]
                if target.get("clickable") == "true":
                    score += 10
                else:
                    # Some react-native-svg virtual buttons report a label and
                    # real hit bounds without Android's clickable flag.
                    target = node
            box = bounds(target)
            if not box or target.get("enabled", "true") == "false":
                continue
            left, top, right, bottom = box
            if right <= 0 or bottom <= 0 or left >= self.width or top >= self.height:
                continue
            score += 3 if normalized(node.get("content-desc", "")) == wanted else 0
            score += 1 if target is node else 0
            area = (right - left) * (bottom - top)
            candidates.append((score, -area, target))
        return max(candidates, key=lambda item: item[:2])[2] if candidates else None

    def scroll(self, upwards: bool = True):
        # The outside margin belongs to the page ScrollView. Swiping over the
        # board itself would pan its camera, which is a different operation.
        x, low, high = self.width - 5, int(self.height * .82), int(self.height * .32)
        self.command("shell", "input", "swipe", str(x), str(low if upwards else high), str(x), str(high if upwards else low), "350")

    def wait(self, label: str, *, contains: bool = False, timeout: int = 35, scroll: bool = False, clickable: bool = False) -> ET.Element:
        deadline, attempts, last_error = time.monotonic() + timeout, 0, ""
        while time.monotonic() < deadline:
            try:
                tree = self.dump()
                target = self.find(tree, label, contains=contains, clickable=clickable)
                if target is not None:
                    return target
                attempts += 1
                if scroll and attempts % 2 == 0:
                    self.scroll(upwards=attempts % 12 < 8)
            except (RuntimeError, ET.ParseError, subprocess.TimeoutExpired) as error:
                last_error = str(error)
            time.sleep(.4)
        raise RuntimeError(f"Could not find Android control {label!r}. {last_error}".strip())

    def tap_node(self, node: ET.Element):
        box = bounds(node)
        if box is None:
            raise RuntimeError("Android control has no tappable bounds")
        left, top, right, bottom = box
        x = (max(0, left) + min(self.width - 1, right)) // 2
        y = (max(0, top) + min(self.height - 1, bottom)) // 2
        self.command("shell", "input", "tap", str(x), str(y))

    def tap(self, label: str, *, contains: bool = False, scroll: bool = True):
        self.tap_node(self.wait(label, contains=contains, clickable=True, scroll=scroll))
        self.events.append({"action": "tap", "control": label})

    def capture(self, stage: str):
        try:
            self.dump()
        except Exception:
            pass
        (self.output / f"{stage}.xml").write_text(self.last_xml)
        result = subprocess.run([self.adb, "exec-out", "screencap", "-p"], capture_output=True, timeout=20)
        if result.returncode == 0:
            (self.output / f"{stage}.png").write_bytes(result.stdout)
        (self.output / "native-gameplay.json").write_text(json.dumps({"package": self.package, "events": self.events}, indent=2))

    def launch(self):
        response = self.command("shell", "cmd", "package", "resolve-activity", "--brief", self.package)
        component = next((line.strip() for line in reversed(response.splitlines()) if "/" in line and self.package in line), None)
        if not component:
            raise RuntimeError("The standalone BuildPlay launch activity was not found")
        self.command("shell", "am", "start", "-W", "-n", component, "--ez", "buildplayLocalUiTest", "true")

    def tap_cell(self, number: int, *, finished: bool = False):
        expected = "Finished" if finished else "I'm ready"
        for attempt in range(4):
            tree = self.dump()
            if self.find(tree, expected, contains=finished) is not None:
                return
            # SVG groups expose screen bounds even though their Android
            # `clickable` flag is false. Climbing to a clickable ancestor here
            # would replace the individual target with the entire game board.
            cell = self.find(tree, f"Cell {number}")
            cell_box = bounds(cell) if cell is not None else None
            if cell is not None and cell_box is not None and cell_box[2] - cell_box[0] < self.width * .6:
                canvas = self.find(tree, "Game board.", contains=True)
                canvas_box = bounds(canvas) if canvas is not None else None
                visible = intersection(cell_box, canvas_box or (0, 0, self.width, self.height), (0, 0, self.width, self.height))
                if visible is None or visible[3] - visible[1] < min(44, (cell_box[3] - cell_box[1]) * .35):
                    # A sticky header or parent ScrollView can clip a virtual
                    # SVG target. Reveal it instead of tapping the header or
                    # rejecting the whole board because its rectangle is cut.
                    self.events.append({"action": "reveal-cell", "cell": number, "bounds": cell_box, "canvas": canvas_box})
                    self.scroll(upwards=cell_box[1] >= (canvas_box[1] if canvas_box else 0))
                    continue
                x, y = (visible[0] + visible[2]) // 2, (visible[1] + visible[3]) // 2
                self.command("shell", "input", "tap", str(x), str(y))
            else:
                # Native SVG releases can expose different virtual-node bounds.
                # This fallback still performs a physical
                # tap on the rendered native board, not a protocol/API call.
                canvas = self.wait("Game board.", contains=True, timeout=20, scroll=True)
                box = bounds(canvas)
                assert box is not None
                left, top, right, bottom = box
                side = min(right - left, bottom - top)
                x = left + (right - left - side) / 2 + ((number - 1) % 3 + .5) * side / 3
                y = top + (bottom - top - side) / 2 + ((number - 1) // 3 + .5) * side / 3
                self.command("shell", "input", "tap", str(round(x)), str(round(y)))
            self.events.append({"action": "native-cell-tap", "cell": number, "attempt": attempt + 1, "x": round(x), "y": round(y)})
            try:
                self.wait(expected, contains=finished, timeout=8, scroll=True)
                return
            except RuntimeError:
                pass
        raise RuntimeError(f"Native SVG/QuickJS did not accept Cell {number}")

    def run(self):
        self.launch()
        # The navigation menu exposes every destination even on narrow phones
        # where the horizontal tabs need scrolling.
        try:
            self.tap("Navigation menu", scroll=False)
        except RuntimeError:
            pass  # Tablet/landscape navigation can already be expanded.
        self.tap("On this device")
        self.tap("Pass and play")
        self.tap_cell(1)
        self.wait("I'm ready", scroll=True)
        self.capture("game-01-handoff")

        # The board is saved before it changes. A real process restart must
        # restore the pending handoff instead of exposing the next player's UI.
        self.command("shell", "am", "force-stop", self.package)
        self.launch()
        self.wait("I'm ready", timeout=60, scroll=True)
        self.events.append({"assertion": "handoff-restored-after-process-restart"})
        self.capture("game-02-restored-handoff")

        self.command("shell", "input", "keyevent", "4")
        self.wait("Pass and play", scroll=True)
        self.wait("1 moves", contains=True, scroll=True)
        self.events.append({"assertion": "hardware-back-opens-saved-local-match-list"})
        self.capture("game-03-local-list")
        # Select the saved card by its move count, so an unrelated migrated
        # local match cannot be opened accidentally.
        self.tap("1 moves", contains=True)
        self.wait("I'm ready", scroll=True)

        for index, cell in enumerate((4, 2, 5, 3), start=2):
            self.tap("I'm ready")
            self.tap_cell(cell, finished=cell == 3)
            self.capture(f"game-{index + 2:02d}-move-{index}")
        self.wait("Finished", contains=True, scroll=True)
        self.wait("5 moves", contains=True, scroll=True)
        self.events.append({"assertion": "native-quickjs-and-svg-complete-five-move-win"})
        self.capture("game-08-finished")

        self.tap("Previous", contains=True)
        self.wait("Replay", contains=True, scroll=True)
        self.events.append({"assertion": "native-match-history-is-readable"})
        self.capture("game-09-replay")
        self.tap("Live board")
        self.wait("Finished", contains=True, scroll=True)
        self.capture("game-10-live-finished")
        print("Native gameplay passed: SVG taps, isolated QuickJS rules, durable handoff, process restart, Back navigation, win and replay.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package")
    parser.add_argument("output", type=Path)
    parser.add_argument("--adb", default="adb")
    arguments = parser.parse_args()
    smoke = NativeSmoke(arguments.package, arguments.output, arguments.adb)
    try:
        smoke.run()
    except Exception as error:
        smoke.events.append({"failure": str(error)})
        smoke.capture("game-failure")
        print(f"Native gameplay failed: {error}. Inspect {arguments.output}/game-failure.xml and .png", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
