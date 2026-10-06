"""Conversational game-building agent for the builder page.

The agent helps the user iteratively write and refine a game's HTML code through
chat. It runs on Meta's Model API (see model_api.py) and knows the platform's
game API (the postMessage protocol between the page and the game iframe).

The model is instructed to answer with a single JSON object:
{"message": "<chat reply>", "code": "<full HTML or null>",
 "name": "<suggested name or null>", "description": "<suggested description or null>"}.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from game_platform.model_api import ModelApiClient
from game_platform.schemas import AgentChatRequest, AgentChatResponse
SYSTEM_PROMPT = """\
You are a game-building assistant inside a turn-based multiplayer game platform's \
builder. You help the user create and refine a game by writing its code through \
conversation. Be concise, friendly, and iterative: propose a change, explain it \
briefly, and let the user test it.

The game's `code` is a COMPLETE HTML document. It runs in an iframe with \
`sandbox="allow-scripts"`: scripts run in an isolated origin, so keep everything \
self-contained (no external scripts, stylesheets, fonts, or network fetches) and \
never try to reach the platform's cookies, storage, or API.

