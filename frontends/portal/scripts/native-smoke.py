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


def fixture_viewport(spec: dict) -> tuple[float, float, float, float]:
    """Bundled Tic-tac-toe's pieces/targets remain inside its declared boards."""
    boxes = [(0, 0, spec["viewport"]["width"], spec["viewport"]["height"])]
    boxes.extend((board.get("x", 0), board.get("y", 0), board["width"], board["height"]) for board in spec["boards"])
    left, top = min(box[0] for box in boxes), min(box[1] for box in boxes)
    return left, top, max(box[0] + box[2] for box in boxes) - left, max(box[1] + box[3] for box in boxes) - top


def fixture_cell_point(spec: dict, number: int, canvas: tuple[int, int, int, int]) -> tuple[int, int]:
    """Project the real grid center through SVG's default xMidYMid/meet fit.

    Android SVG accessibility groups can report their un-fitted translated
    positions. The declared viewport includes instructions around the board;
    treating the entire canvas as a 3x3 board would tap a different legal cell.
    This only computes a physical touch coordinate, never a game move.
    """
    board = next(board for board in spec["boards"] if board["id"] == "main")
    if board.get("kind") != "grid" or board.get("rows") != 3 or board.get("columns") != 3 or not 1 <= number <= 9:
        raise ValueError("Native gameplay smoke requires the bundled 3x3 grid")
    left, top, right, bottom = canvas
    vx, vy, vw, vh = fixture_viewport(spec)
    scale = min((right - left) / vw, (bottom - top) / vh)
    world_x = board.get("x", 0) + (((number - 1) % 3) + .5) * board["width"] / 3
    world_y = board.get("y", 0) + (((number - 1) // 3) + .5) * board["height"] / 3
    return (round(left + ((right - left) - vw * scale) / 2 + (world_x - vx) * scale),
            round(top + ((bottom - top) - vh * scale) / 2 + (world_y - vy) * scale))


class NativeSmoke:
    BUG_BUTTON = "Report a bug or request a feature"
    BUG_DIALOG = "Report a bug or feature request"
    BUG_FIELD = "Bug or feature request"
    BUG_SCREENSHOT = "Screenshot captured before opening this report"

    def __init__(self, package: str, output: Path, adb: str):
        self.package, self.output, self.adb = package, output, adb
        output.mkdir(parents=True, exist_ok=True)
        self.last_xml = ""
        self.events: list[dict] = []
        self.played_cells: list[int] = []
        fixture = Path(__file__).resolve().parents[1] / "src/core/bundled-tictactoe.json"
        self.fixture = json.loads(fixture.read_text())["declarative_ui"]
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

    def find(self, tree: ET.Element, label: str, *, contains: bool = False, clickable: bool = False, editable: bool = False, focused: bool = False) -> ET.Element | None:
        wanted = normalized(label)
        parents = {child: parent for parent in tree.iter() for child in parent}
        candidates: list[tuple[int, int, ET.Element]] = []
        for node in tree.iter("node"):
            if editable and node.get("class") != "android.widget.EditText":
                continue
            if focused and node.get("focused") != "true":
                continue
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

    def wait(self, label: str | tuple[str, ...], *, contains: bool = False, timeout: int = 35, scroll: bool = False, clickable: bool = False, editable: bool = False, focused: bool = False, dialog: bool = False) -> ET.Element:
        deadline, attempts, last_error = time.monotonic() + timeout, 0, ""
        while time.monotonic() < deadline:
            try:
                tree = self.dump()
                for option in (label,) if isinstance(label, str) else label:
                    target = self.find(tree, option, contains=contains, clickable=clickable, editable=editable, focused=focused)
                    if target is not None:
                        return target
                attempts += 1
                if scroll and attempts % 2 == 0:
                    if dialog:
                        # A native Modal owns a separate ScrollView; swiping
                        # the page's outside margin cannot reveal its fields.
                        x, low, high = self.width // 2, int(self.height * .76), int(self.height * .32)
                        upward = attempts % 12 < 8
                        self.command("shell", "input", "swipe", str(x), str(low if upward else high), str(x), str(high if upward else low), "350")
                    else:
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

    def launch(self, *, local_list: bool = False):
        response = self.command("shell", "cmd", "package", "resolve-activity", "--brief", self.package)
        component = next((line.strip() for line in reversed(response.splitlines()) if "/" in line and self.package in line), None)
        if not component:
            raise RuntimeError("The standalone BuildPlay launch activity was not found")
        arguments = ["shell", "am", "start", "-W", "-n", component, "--ez", "buildplayLocalUiTest", "true"]
        if local_list:
            arguments.extend(["-a", "android.intent.action.VIEW", "-d", "buildplay://portal#local"])
        self.command(*arguments)

    def assert_bug_control(self, stage: str, *, clear_logo: bool = False):
        node = self.wait(self.BUG_BUTTON, clickable=True, scroll=False)
        box = bounds(node)
        if box is None or box[0] < 0 or box[1] < 0 or box[2] > self.width or box[3] > self.height:
            raise RuntimeError(f"Bug control is outside the screen during {stage}")
        if clear_logo:
            if box[0] > self.width * .2 or box[1] > self.height * .2:
                raise RuntimeError("Default bug control is not at the top left")
            logo = self.find(self.dump(), "BuildPlay home")
            logo_box = bounds(logo) if logo is not None else None
            if logo_box is None or intersection(box, logo_box) is not None:
                raise RuntimeError("Bug control covers the BuildPlay logo")
            if logo_box[1] >= box[3]:
                raise RuntimeError("Bug control still reserves a separate header row")
        elif getattr(self, "bug_drag_origin", None) is not None and abs(box[0] - self.bug_drag_origin[0]) < self.width * .05:
            raise RuntimeError(f"Chosen bug control position was reset during {stage}")
        self.events.append({"assertion": "bug-control-visible-in-screen", "stage": stage, "bounds": box})

    def drag_bug_control(self):
        """Move the real native control without opening or submitting a report."""
        original = bounds(self.wait(self.BUG_BUTTON, clickable=True, scroll=False))
        if original is None:
            raise RuntimeError("Bug control has no physical drag bounds")
        x, y = (original[0] + original[2]) // 2, (original[1] + original[3]) // 2
        self.command("shell", "input", "swipe", str(x), str(y), str(round(self.width * .25)), str(round(self.height * .15)), "700")
        moved = None
        # A mistaken press can finish screenshot capture asynchronously. Watch
        # beyond its eight-second timeout so a drag cannot secretly open it.
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            tree = self.dump()
            if self.find(tree, self.BUG_DIALOG) is not None:
                raise RuntimeError("Dragging the bug control opened the bug reporter")
            control = self.find(tree, self.BUG_BUTTON, clickable=True)
            box = bounds(control) if control is not None else None
            if box is not None and abs(box[0] - original[0]) > self.width * .05:
                moved = box
            time.sleep(.2)
        if moved is None:
            raise RuntimeError("The native bug control did not move after a physical drag")
        self.bug_drag_origin = original
        self.assert_bug_control("after-physical-drag")
        self.events.append({"assertion": "native-bug-drag-moves-without-opening-report", "from": original, "to": moved})
        self.capture("bug-00-floating-drag")

    def bug_report_from_account(self):
        """Exercise the real native Modal window without transmitting a report.

        launch() enables the existing local-only test mode. The smoke never
        presses Send report, creates an account, or changes saved credentials.
        Capturing the current window and editing a draft work fully offline.
        """
        self.assert_bug_control("home", clear_logo=True)
        self.drag_bug_control()
        self.tap_node(self.wait(("Account menu", "Log in"), clickable=True))
        self.wait("Close dialog")
        self.wait("Language", scroll=True, dialog=True)
        self.assert_bug_control("account-modal")
        self.capture("bug-01-account-modal")

        self.tap(self.BUG_BUTTON, scroll=False)
        self.wait(self.BUG_DIALOG, timeout=20)
        self.wait(self.BUG_SCREENSHOT, scroll=True, dialog=True)
        self.assert_bug_control("report-over-account-modal")
        self.capture("bug-02-report-preview")
        field = self.wait(self.BUG_FIELD, editable=True, scroll=True, dialog=True)
        self.tap_node(field)
        self.wait(self.BUG_FIELD, editable=True, focused=True)
        self.command("shell", "input", "text", "Local%ssmoke%sdraft")
        # Exact text and retained focus catch overlay remounts on each letter.
        # Never scroll with the keyboard open: a swipe can type IME gestures.
        self.wait("Local smoke draft", editable=True, focused=True)
        self.events.append({"assertion": "native-bug-report-from-account-has-screenshot-and-editable-draft"})
        self.capture("bug-03-editable-draft")

        # Back may first dismiss the keyboard. The report must then close
        # while retaining the Account dialog that owned its native window.
        self.command("shell", "input", "keyevent", "4")
        try:
            self.wait("Language", timeout=4)
        except RuntimeError:
            self.command("shell", "input", "keyevent", "4")
            self.wait("Language")
        if self.find(self.dump(), self.BUG_DIALOG) is not None:
            raise RuntimeError("Closing the bug report did not restore the Account dialog")
        self.assert_bug_control("account-restored-after-report")
        self.events.append({"assertion": "closing-bug-report-restores-account-modal-without-sending"})
        self.tap("Close dialog", scroll=False)
        self.wait("On this device")

    def fitted_canvas(self) -> tuple[ET.Element, tuple[int, int, int, int]]:
        """Reveal a full canvas before using its dimensions for SVG projection."""
        for _ in range(12):
            tree = self.dump()
            canvas = self.find(tree, "Game board.", contains=True)
            box = bounds(canvas) if canvas is not None else None
            if box is None:
                self.wait("Game board.", contains=True, timeout=20, scroll=True)
                continue
            parents = {child: parent for parent in tree.iter() for child in parent}
            parent, viewport = canvas, (0, 0, self.width, self.height)
            while parent in parents:
                parent = parents[parent]
                if parent.get("class") == "android.widget.ScrollView" and bounds(parent):
                    viewport = bounds(parent)
                    break
            _, _, world_width, world_height = fixture_viewport(self.fixture)
            fitted_height = (box[2] - box[0]) * world_height / world_width
            # A fully visible shorter/wider canvas may have letterboxing. If
            # an edge touches the ScrollView, a shorter XML rectangle may be
            # clipped, and its origin/height cannot safely define the viewBox.
            if box[3] - box[1] >= fitted_height - 3 or box[1] > viewport[1] + 3 and box[3] < viewport[3] - 3:
                return tree, box
            upward = box[3] >= viewport[3] - 3 and box[1] > viewport[1] + 3
            self.events.append({"action": "reveal-canvas", "bounds": box, "viewport": viewport, "upwards": upward})
            self.scroll_outside_canvas(box, viewport, upwards=upward, distance=round(fitted_height - (box[3] - box[1]) + 24))
        raise RuntimeError("Could not reveal the complete bundled game canvas for a physical touch")

    def scroll_outside_canvas(self, canvas: tuple[int, int, int, int], viewport: tuple[int, int, int, int], *, upwards: bool, distance: int):
        # Narrow phones render the board all the way to both screen edges.
        # An edge swipe there pans the game instead of scrolling its parent.
        # Use visible page content above/below the board for the real gesture.
        regions = [(viewport[1] + 12, canvas[1] - 12), (canvas[3] + 12, viewport[3] - 12)]
        top, bottom = max(regions, key=lambda region: region[1] - region[0])
        if bottom - top < 60:
            raise RuntimeError("No page area outside the game canvas is available for scrolling")
        distance = min(max(60, distance), bottom - top)
        x = (viewport[0] + viewport[2]) // 2
        self.command("shell", "input", "swipe", str(x), str(bottom if upwards else top), str(x), str(bottom - distance if upwards else top + distance), "700")

    def tap_cell(self, number: int, *, finished: bool = False):
        expected = "Finished" if finished else f"{len(self.played_cells) + 1} moves"
        # Exercise the normal camera control so the projection has a known
        # fitted view even if an earlier scrolling gesture moved the camera.
        self.tap("Reset board view")
        for attempt in range(4):
            if attempt and self.find(self.dump(), expected, contains=True) is not None:
                break
            tree, canvas = self.fitted_canvas()
            labels = {label for node in tree.iter("node") for label in self.labels(node)}
            for played in self.played_cells:
                if normalized(f"Cell {played}") in labels:
                    raise RuntimeError(f"The previous physical tap did not occupy Cell {played}")
            if normalized(f"Cell {number}") not in labels:
                self.wait(f"Cell {number}", timeout=12)
                continue
            if number == 1 and attempt == 0:
                self.capture("game-00-fitted-board")
            x, y = fixture_cell_point(self.fixture, number, canvas)
            self.command("shell", "input", "tap", str(x), str(y))
            self.events.append({"action": "native-cell-tap", "cell": number, "attempt": attempt + 1, "x": x, "y": y, "canvas": canvas})
            try:
                self.wait(expected, contains=True, timeout=8, scroll=True)
                break
            except RuntimeError:
                pass
        else:
            raise RuntimeError(f"Native SVG/QuickJS did not accept Cell {number}")
        self.played_cells.append(number)
        if not finished:
            self.assert_public_board()

    def assert_public_board(self):
        self.wait("Game board.", contains=True, scroll=True)
        if self.find(self.dump(), "I'm ready") is not None:
            raise RuntimeError("The public-state bundled game unexpectedly requires a handoff")

    def run(self):
        # Saved local games remain available by deep link after their navigation
        # tab was removed. Restart launches below omit the route to resume play.
        self.launch(local_list=True)
        self.wait("On this device")
        self.bug_report_from_account()
        self.tap("Pass and play")
        self.tap("Focus mode", scroll=False)
        self.wait("Exit focus mode")
        self.assert_bug_control("game-focus-mode")
        self.capture("bug-04-focus-mode")
        self.tap("Exit focus mode", scroll=False)
        self.tap_cell(1)
        self.capture("game-01-next-player-board")

        # The public board and next player's controls survive a real process
        # restart without requiring a pass-and-play privacy handoff.
        self.command("shell", "am", "force-stop", self.package)
        self.launch()
        self.wait("1 moves", contains=True, timeout=60, scroll=True)
        self.assert_public_board()
        self.wait("Cell 4", scroll=True)
        self.events.append({"assertion": "public-board-and-next-turn-restored-after-process-restart"})
        self.capture("game-02-restored-public-board")

        self.command("shell", "input", "keyevent", "4")
        self.wait("Pass and play", scroll=True)
        self.wait("1 moves", contains=True, scroll=True)
        self.events.append({"assertion": "hardware-back-opens-saved-local-match-list"})
        self.capture("game-03-local-list")
        # Select the saved card by its move count, so an unrelated migrated
        # local match cannot be opened accidentally.
        self.tap("1 moves", contains=True)
        self.assert_public_board()

        for index, cell in enumerate((4, 2, 5, 3), start=2):
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
        print("Native gameplay passed: bug control over Account and focus mode, offline screenshot/draft, SVG taps, isolated QuickJS rules, continuous public board, process restart, Back navigation, win and replay.")


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
    finally:
        # These CI launches use synthetic, offline data. Keep the view setup
        # and OS exclusion evidence even when a physical gesture exits the app.
        for filename, command in (
            ("bug-gesture.log", ("logcat", "-d", "-s", "BuildPlayBugGesture:V", "*:S")),
            ("bug-gesture-region.txt", ("shell", "dumpsys", "window")),
        ):
            try:
                output = smoke.command(*command)
                if filename.endswith(".txt"):
                    output = "\n".join(line for line in output.splitlines() if "gestureexclusion" in line.lower())
                (arguments.output / filename).write_text(output)
            except Exception:
                pass  # Evidence collection must preserve the actual test result.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
