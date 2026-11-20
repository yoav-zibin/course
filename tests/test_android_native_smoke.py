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


def test_initial_local_list_deep_link_keeps_offline_mode_and_restart_resumes_saved_game():
    value = driver()
    value.package = "com.buildplay.app"
    commands = []

    def command(*arguments):
        commands.append(arguments)
        return value.package + "/.MainActivity" if arguments[1:3] == ("cmd", "package") else ""

    value.command = command
    value.launch(local_list=True)
    initial = commands[-1]
    assert initial[:6] == ("shell", "am", "start", "-W", "-n", value.package + "/.MainActivity")
    assert initial[6:9] == ("--ez", "buildplayLocalUiTest", "true")
    assert initial[9:] == ("-a", "android.intent.action.VIEW", "-d", "buildplay://portal#local")
    value.launch()
    assert commands[-1] == initial[:9]


def test_clipped_canvas_is_revealed_then_physical_tap_ignores_bad_virtual_bounds():
    value = driver()
    trees = iter([android_tree("[0,1770][1080,2328]", 1), android_tree("[0,555][1080,1563]", 1), android_tree("[0,555][1080,1563]", 4)])
    value.dump = lambda: next(trees)
    scrolls, touches = [], []
    value.scroll_outside_canvas = lambda canvas, viewport, upwards=True, distance=0: scrolls.append(upwards)
    value.command = lambda *args: touches.append(args)
    waited = []

    def wait(label, **options):
        waited.append(label)
        return ET.Element("node") if label in {"1 moves", "Game board."} else pytest.fail(label)

    value.wait = wait
    value.tap_cell(1)
    assert scrolls == [True]
    assert touches == [("shell", "input", "tap", "163", "855")]
    assert value.played_cells == [1]
    assert waited == ["1 moves", "Game board."]


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


def test_report_field_lookup_requires_an_editable_input_even_when_its_label_is_visible():
    value = driver()
    tree = ET.fromstring('''<hierarchy>
      <node text="Bug or feature request" class="android.widget.TextView" bounds="[80,900][900,950]"/>
      <node content-desc="Bug or feature request" class="android.widget.EditText" bounds="[80,960][900,1150]"/>
    </hierarchy>''')
    field = value.find(tree, value.BUG_FIELD, editable=True)
    assert field is not None and field.get("class") == "android.widget.EditText"
    tree.remove(field)
    assert value.find(tree, value.BUG_FIELD, editable=True) is None


def test_native_draft_must_keep_keyboard_focus_after_controlled_updates():
    value = driver()
    tree = ET.fromstring('''<hierarchy>
      <node content-desc="Bug or feature request" text="Local smoke draft"
        class="android.widget.EditText" bounds="[80,960][900,1150]" focused="false"/>
    </hierarchy>''')
    assert value.find(tree, "Local smoke draft", editable=True, focused=True) is None
    next(tree.iter("node")).set("focused", "true")
    assert value.find(tree, "Local smoke draft", editable=True, focused=True) is not None


def test_default_bug_control_floats_beside_logo_without_covering_it_or_reserving_a_row():
    value = driver()
    bug = ET.Element("node", {"bounds": "[15,70][123,166]"})
    value.wait = lambda *args, **options: bug
    value.dump = lambda: ET.fromstring('''<hierarchy><node content-desc="BuildPlay home" bounds="[150,110][570,210]"/></hierarchy>''')
    value.assert_bug_control("home", clear_logo=True)
    value.dump = lambda: ET.fromstring('''<hierarchy><node content-desc="BuildPlay home" bounds="[60,110][500,210]"/></hierarchy>''')
    with pytest.raises(RuntimeError, match="covers"):
        value.assert_bug_control("home", clear_logo=True)
    value.dump = lambda: ET.fromstring('''<hierarchy><node content-desc="BuildPlay home" bounds="[150,180][570,280]"/></hierarchy>''')
    with pytest.raises(RuntimeError, match="separate header row"):
        value.assert_bug_control("home", clear_logo=True)
    bug.set("bounds", "[400,70][508,166]")
    with pytest.raises(RuntimeError, match="top left"):
        value.assert_bug_control("home", clear_logo=True)
    value.assert_bug_control("account-modal")
    bug.set("bounds", "[1000,70][1108,166]")
    with pytest.raises(RuntimeError, match="outside"):
        value.assert_bug_control("account-modal")


def test_native_drag_requires_a_real_move_without_opening_the_report(monkeypatch):
    value = driver()
    original = ET.Element("node", {"bounds": "[15,70][123,166]"})
    value.wait = lambda *args, **options: original
    tree = ET.fromstring('''<hierarchy><node content-desc="Report a bug or request a feature" clickable="true" bounds="[210,300][318,396]"/></hierarchy>''')
    value.dump = lambda: tree
    commands, stages = [], []
    value.command = lambda *args: commands.append(args)
    value.assert_bug_control = lambda stage: stages.append(stage)
    clock = [0.0]
    monkeypatch.setattr(smoke.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(smoke.time, "sleep", lambda seconds: clock.__setitem__(0, clock[0] + 10))
    value.drag_bug_control()
    assert commands[0][:3] == ("shell", "input", "swipe")
    assert "after-physical-drag" in stages
    assert any(event.get("assertion") == "native-bug-drag-moves-without-opening-report" for event in value.events)
    node = next(tree.iter("node"))
    node.set("bounds", "[15,70][123,166]")
    with pytest.raises(RuntimeError, match="did not move"):
        value.drag_bug_control()
    ET.SubElement(tree, "node", {"text": value.BUG_DIALOG, "bounds": "[100,300][900,450]"})
    with pytest.raises(RuntimeError, match="opened the bug reporter"):
        value.drag_bug_control()


def test_chosen_bug_position_must_not_reset_when_opening_a_modal():
    value = driver()
    value.bug_drag_origin = (15, 70, 123, 166)
    node = ET.Element("node", {"bounds": "[210,370][318,466]"})
    value.wait = lambda *args, **options: node
    value.assert_bug_control("account-modal")
    node.set("bounds", "[15,70][123,166]")
    with pytest.raises(RuntimeError, match="position was reset"):
        value.assert_bug_control("account-modal")


def test_native_report_draft_restores_account_after_keyboard_and_never_sends():
    value = driver()
    commands, taps, controls, stages = [], [], [], []
    value.command = lambda *args: commands.append(args)
    value.tap = lambda label, **options: taps.append(label)
    value.tap_node = lambda node: None
    value.assert_bug_control = lambda stage, **options: stages.append(stage)
    value.drag_bug_control = lambda: stages.append("physical-drag")
    value.dump = lambda: ET.Element("hierarchy")
    keyboard_dismissed = False

    def wait(label, **options):
        nonlocal keyboard_dismissed
        controls.append((label, options))
        if label == "Language" and options.get("timeout") == 4:
            keyboard_dismissed = True
            raise RuntimeError("Keyboard closed; report still owns the modal")
        return ET.Element("node", {"class": "android.widget.EditText"})

    value.wait = wait
    value.bug_report_from_account()
    assert value.BUG_BUTTON in taps and "Close dialog" in taps
    assert "Send report" not in taps and all("Send report" not in command for command in commands)
    assert (value.BUG_SCREENSHOT, {"scroll": True, "dialog": True}) in controls
    assert (value.BUG_FIELD, {"editable": True, "scroll": True, "dialog": True}) in controls
    assert (value.BUG_FIELD, {"editable": True, "focused": True}) in controls
    assert ("Local smoke draft", {"editable": True, "focused": True}) in controls
    assert ("shell", "input", "text", "Local%ssmoke%sdraft") in commands
    assert commands.count(("shell", "input", "keyevent", "4")) == 2 and keyboard_dismissed
    assert "account-restored-after-report" in stages
    assert "physical-drag" in stages
    assert any(event.get("assertion") == "closing-bug-report-restores-account-modal-without-sending" for event in value.events)


def test_missing_native_screenshot_preview_fails_before_editing_or_sending():
    value = driver()
    commands = []
    value.command = lambda *args: commands.append(args)
    value.tap = lambda *args, **options: None
    value.tap_node = lambda node: None
    value.assert_bug_control = lambda *args, **options: None
    value.drag_bug_control = lambda: None

    def wait(label, **options):
        if label == value.BUG_SCREENSHOT:
            raise RuntimeError("Native screenshot preview is absent")
        return ET.Element("node")

    value.wait = wait
    with pytest.raises(RuntimeError, match="screenshot preview"):
        value.bug_report_from_account()
    assert not commands
