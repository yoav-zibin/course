"""Physical native touches must follow SVG fitting, not virtual-node offsets."""

import importlib.util
import json
from pathlib import Path
import xml.etree.ElementTree as ET

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "frontends/portal/scripts/native-smoke.py"
spec = importlib.util.spec_from_file_location("native_smoke", SCRIPT)
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
FIXTURE = json.loads((ROOT / "frontends/portal/src/core/bundled-tictactoe.json").read_text())["declarative_ui"]


def test_actual_failed_ci_canvas_projects_cell_one_to_visible_top_left_target():
    # Regression from the real 12b9 screenshot: virtual Cell1 reports center
    # (238,992); the declared viewport/board renders its center at (163,855).
    assert smoke.fixture_cell_point(FIXTURE, 1, (0, 555, 1080, 1563)) == (163, 855)
    assert smoke.fixture_cell_point(FIXTURE, 4, (0, 555, 1080, 1563)) == (163, 1095)
    assert smoke.fixture_cell_point(FIXTURE, 3, (0, 555, 1080, 1563)) == (643, 855)


def test_letterboxed_canvas_keeps_instructions_and_board_offset():
    assert smoke.fixture_cell_point(FIXTURE, 1, (10, 20, 1210, 580)) == (401, 187)
    assert smoke.fixture_cell_point(FIXTURE, 9, (10, 20, 610, 1140)) == (367, 733)


def test_declared_viewport_is_not_replaced_with_board_bounds():
    assert smoke.fixture_viewport(FIXTURE) == (0, 0, 600, 560)
    assert smoke.fixture_cell_point(FIXTURE, 1, (0, 0, 600, 560)) == (91, 167)


def android_tree(canvas, *legal_cells):
    root = ET.Element("hierarchy")
    scroll = ET.SubElement(root, "node", {"class": "android.widget.ScrollView", "bounds": "[0,469][1080,2328]"})
    view = ET.SubElement(scroll, "node", {"content-desc": "Game board. Use pieces and highlighted destinations.", "bounds": canvas})
    for cell in legal_cells:
        # Deliberately wrong Android virtual bounds from the actual CI failure.
        ET.SubElement(view, "node", {"content-desc": f"Cell {cell}", "bounds": "[118,872][358,1112]"})
    return root


def driver():
    value = smoke.NativeSmoke.__new__(smoke.NativeSmoke)
    value.fixture, value.width, value.height = FIXTURE, 1080, 2400
    value.events, value.played_cells = [], []
    value.tap = lambda label: None
    value.capture = lambda stage: None
    return value


def test_clipped_canvas_is_revealed_then_physical_tap_ignores_bad_virtual_bounds():
    value = driver()
    trees = iter([android_tree("[0,1770][1080,2328]", 1), android_tree("[0,555][1080,1563]", 1)])
    value.dump = lambda: next(trees)
    scrolls, touches = [], []
    value.scroll_outside_canvas = lambda canvas, viewport, upwards=True, distance=0: scrolls.append(upwards)
    value.command = lambda *args: touches.append(args)
    value.wait = lambda label, **options: ET.Element("node") if label == "I'm ready" else pytest.fail(label)
    value.tap_cell(1)
    assert scrolls == [True]
    assert touches == [("shell", "input", "tap", "163", "855")]
    assert value.played_cells == [1]


def test_a_wrong_previous_physical_cell_cannot_be_accepted_as_progress():
    value = driver()
    value.played_cells = [1]
    value.dump = lambda: android_tree("[0,555][1080,1563]", 1, 4)
    with pytest.raises(RuntimeError, match="did not occupy Cell 1"):
        value.tap_cell(4)


def test_narrow_full_width_board_is_revealed_by_swiping_page_header():
    value = driver()
    gestures = []
    value.command = lambda *args: gestures.append(args)
    value.scroll_outside_canvas((0, 884, 720, 1280), (0, 228, 720, 1280), upwards=True, distance=300)
    assert gestures == [("shell", "input", "swipe", "360", "872", "360", "572", "700")]
