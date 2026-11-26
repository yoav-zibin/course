"""Visual reference for the fixture's populated Backgammon opening."""

import numpy as np


def opening_bounds(image):
    """Return normalized board bounds once the wood and both checker colors appear."""
    red, green, blue = image.astype(np.int16, copy=False).transpose(2, 0, 1)
    y, x = np.nonzero((red > 95) & (red > green + 34) & (green > blue + 18))
    height, width = red.shape
    if len(x) < red.size * .1:
        return None
    left, right = np.percentile(x, [2, 98]).astype(int)
    top, bottom = np.percentile(y, [2, 98]).astype(int)
    region = np.s_[top:bottom, left:right]
    r, g, b = red[region], green[region], blue[region]
    red_checkers = (r > 150) & (g < 95) & (r > g + 95) & (b < 100)
    ivory_checkers = (r > 190) & (g > 180) & (b > 160) & (abs(r-g) < 45) & (abs(g-b) < 55)
    if red_checkers.mean() < .015 or ivory_checkers.mean() < .015:
        return None
    return left / width, top / height, right / width, bottom / height
