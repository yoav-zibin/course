"""JSON Schema helpers for the v2 server-side game contract."""

from collections.abc import Mapping
from typing import Any

from jsonschema import Draft202012Validator, ValidationError

SCHEMA_KEYS = frozenset({"state", "move", "view"})


def compile_game_schemas(game_schemas: Mapping[str, Any]) -> dict[str, Draft202012Validator]:
    if set(game_schemas) != SCHEMA_KEYS:
        missing = sorted(SCHEMA_KEYS - set(game_schemas))
        unknown = sorted(set(game_schemas) - SCHEMA_KEYS)
        details = []
        if missing:
            details.append(f"missing {', '.join(missing)}")
        if unknown:
            details.append(f"unknown {', '.join(unknown)}")
        raise ValueError("game_schemas must define state, move, and view (" + "; ".join(details) + ")")

    validators: dict[str, Draft202012Validator] = {}
    for key, schema in game_schemas.items():
        Draft202012Validator.check_schema(schema)
        validators[key] = Draft202012Validator(schema)
    return validators


def validation_message(
    validator: Draft202012Validator, value: Any
) -> str | None:
    if validator.schema is True or validator.schema == {}:
        return None
    if validator.is_valid(value):
        return None
    error: ValidationError | None = next(validator.iter_errors(value), None)
    if error is None:
        return None
    path = ".".join(str(part) for part in error.absolute_path) or "$"
    return f"{path}: {error.message}"
