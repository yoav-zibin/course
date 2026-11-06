"""Process-local counters and structured logs for game input schema failures."""

import logging
import threading
from collections import Counter

logger = logging.getLogger(__name__)
_lock = threading.Lock()
_invalid_inputs: Counter[tuple[str, int, str, str]] = Counter()


def record_invalid_game_input(
    *,
    game_id: str,
    game_version: int,
    function: str,
    input_name: str,
    message: str,
) -> None:
    key = (game_id, game_version, function, input_name)
    with _lock:
        _invalid_inputs[key] += 1
        count = _invalid_inputs[key]
    logger.warning(
        "game input failed JSON Schema validation",
        extra={
            "game_id": game_id,
            "game_version": game_version,
            "game_function": function,
            "input_name": input_name,
            "invalid_input_count": count,
            "validation_error": message,
        },
    )


def game_input_metrics() -> list[dict[str, str | int]]:
    with _lock:
        counts = list(_invalid_inputs.items())
    return [
        {
            "game_id": game_id,
            "game_version": game_version,
            "function": function,
            "input": input_name,
            "invalid_count": count,
        }
        for (game_id, game_version, function, input_name), count in sorted(counts)
    ]
