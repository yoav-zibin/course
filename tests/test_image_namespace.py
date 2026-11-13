"""Generated SVG images are normalized so they also render as a standalone <img> document."""

import xml.etree.ElementTree as ET

import pytest

from game_platform import game_artifacts


@pytest.mark.parametrize(
    "opening",
    ["<svg", '<svg xmlns=""', "<svg xmlns=''", '<svg xmlns="http://www.w3.org/2000/svg"'],
)
def test_image_normalizes_standalone_svg_namespace(opening):
    image = {
        "caption": "Board",
        "svg": opening + ' viewBox="0 0 100 100"><rect width="100" height="100" fill="blue"/></svg>',
    }
    game_artifacts.validate_image(image)
    root = ET.fromstring(image["svg"])
    assert root.tag == "{http://www.w3.org/2000/svg}svg"
    assert root[0].tag == "{http://www.w3.org/2000/svg}rect"
    normalized = image["svg"]
    game_artifacts.validate_image(image)
    assert image["svg"] == normalized
