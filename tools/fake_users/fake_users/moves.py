"""Playing declarative games by clicking their declared actions, and
noticing (from the portal's own view of the match) whether a move was accepted."""

from __future__ import annotations

import asyncio
import random

# The portal's view of the open match, read from its page (the portal keeps it in
# `state.match`; `me()`, `seatOf()` and `gameMetaOf()` are its own helpers). This only
# reads what the page already shows; it calls no API. `acting` is the viewer's
# own seat when it is their turn, else null: a player only acts for themselves.
READ_MATCH_JS = """() => {
  if (typeof state === 'undefined' || typeof me !== 'function') return null;
  const m = state.match, u = me();
  if (!m || !u) return null;
  const seat = seatOf(m, u.id);
  const mySeat = seat ? seat.player_index : null;
  const game = typeof gameMetaOf === 'function' ? gameMetaOf(m.game_id, m.game_version) : null;
  return {
    game_id: m.game_id ?? null, game_version: m.game_version ?? null, game_name: game?.name ?? null,
    player_counts: game?.allowed_player_counts ?? null,
    id: m.id, status: m.status, end_reason: m.end_reason, move_count: m.move_count,
    turn: m.turn_of_player_indices, my_seat: mySeat,
    acting: (mySeat !== null && m.turn_of_player_indices?.includes(mySeat)) ? mySeat : null, owner: m.owner_user_id === u.id,
    humans: m.players.filter(p => p.kind === 'human').length, seats: m.players.length,
    turn_seconds: m.turn_seconds || null, conflict: Boolean(m.conflict),
  };
}"""

# Only platform-rendered game actions are candidates. Never click portal account,
# navigation, chat or match controls while trying to play a move.
TAG_CANDIDATES_JS = """() => {
  document.querySelectorAll('[data-fake-user-pick]').forEach(e => e.removeAttribute('data-fake-user-pick'));
  const selectors = '#game-box .declarative-target[role="button"], '
    + '#game-box .declarative-controls button, #game-box .declarative-piece.actionable';
  let n = 0; const buttons = [];
  for (const e of document.querySelectorAll(selectors)) {
    if (e.disabled || e.getAttribute('aria-disabled') === 'true') continue;
    const style = getComputedStyle(e), r = e.getBoundingClientRect();
    if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none' || Number(style.opacity) < 0.1) continue;
    if (r.width < 6 || r.height < 6 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    if (e.tagName.toLowerCase() === 'button') buttons.push(n);
    e.setAttribute('data-fake-user-pick', String(n++));
  }
  return {count:n, buttons};
}"""

# Most clicks go to buttons when there are any (people tap the obvious controls first).
BUTTON_SHARE = 0.75


async def read_match(page) -> dict | None:
    try:
        return await page.evaluate(READ_MATCH_JS)
    except Exception:
        return None  # the page is navigating


def my_turn(match: dict | None) -> bool:
    """Whether this fake user should move now: the portal acts for their own seat."""
    return bool(match) and match["status"] == "ongoing" and match["acting"] is not None and match["acting"] == match["my_seat"]


def changed(before: dict, after: dict | None) -> bool:
    """Whether the match moved on: a new move, a different turn, or a new status."""
    return bool(after) and (
        after["move_count"] > before["move_count"]
        or after["status"] != before["status"]
        or after["turn"] != before["turn"]
    )


async def try_move(page, rng: random.Random, tries: int, wait_seconds: float = 2.0) -> bool:
    """Clicks random tappable things in the game until a move is accepted, up to [tries]
    clicks. Returns whether a move happened."""
    before = await read_match(page)
    if not my_turn(before):
        return False
    for _ in range(tries):
        try:
            found = await page.evaluate(TAG_CANDIDATES_JS)
        except Exception:
            found = {"count": 0, "buttons": []}
        if found["count"]:
            pool = found["buttons"] if found["buttons"] and rng.random() < BUTTON_SHARE else range(found["count"])
            target = page.locator(f'[data-fake-user-pick="{rng.choice(list(pool))}"]').first
            try:
                moving_piece = await target.evaluate("e => e.classList.contains('declarative-piece') && e.dataset.actions.split(' ').includes('move')")
                await target.click(timeout=1500)
                if moving_piece:
                    drops = page.locator('#game-box .declarative-target[data-drop-state="allowed"]')
                    count = await drops.count()
                    if count:
                        await drops.nth(rng.randrange(count)).click(timeout=1500)
            except Exception:
                pass  # covered, moved or gone; try something else
        # Wait for the portal to show the move (it submits it and refreshes the match).
        loop = asyncio.get_running_loop()
        deadline = loop.time() + wait_seconds
        while loop.time() < deadline:
            await asyncio.sleep(0.25)
            after = await read_match(page)
            if changed(before, after):
                return True
            if not my_turn(after):
                return False
    return False
