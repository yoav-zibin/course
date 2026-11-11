"""Game proposals submitted from the Portal's game-selection page.

A visitor who cannot find a game can propose it: the Portal explains that
AI agents review proposals and create the game within 24 hours. Proposals
land in their own dataset (the `game_proposals` collection) — they are not
games, drafts or matches, and nothing here touches those stores.

- `POST /game-proposals` is public (the Portal form; field lengths are
  capped, and that is the only write a visitor gets).
- `GET /game-proposals` and `DELETE /game-proposals/{id}` require the
  master password (the same HTTP Basic check as the debug tools): they
  are how the reviewing agents list what is waiting and remove a proposal
  once it has been handled — built, or rejected as a duplicate / bad fit.
"""

import datetime as dt
import secrets as secrets_module
import time

PROPOSAL_KIND = "game_proposals"


def proposals_supported(store) -> bool:
    return all(
        hasattr(store, name)
        for name in ("raw_get", "raw_put", "_query", "atomic", "ref")
    )


def _now():
    return dt.datetime.now(dt.timezone.utc)


def create_proposal(store, *, game_name, description, rules_url, proposer_name):
    proposal_id = secrets_module.token_hex(16)
    row = {
        "proposal_id": proposal_id,
        "game_name": game_name,
        "description": description,
        "rules_url": rules_url,
        "proposer_name": proposer_name,
        "created_at": _now(),
        "created_ns": time.time_ns(),
    }
    store.raw_put(store.ref(PROPOSAL_KIND, proposal_id), row)
    return {"id": proposal_id, **row}


def list_proposals(store):
    """Every proposal, oldest first, each with its id."""
    rows = []
    after = None
    while True:
        docs = store._query(PROPOSAL_KIND, (), limit=100, after=after)
        for doc in docs:
            row = doc.to_dict()
            row["id"] = row["proposal_id"]
            rows.append(row)
        if len(docs) < 100:
            break
        after = docs[-1].id
    rows.sort(key=lambda r: (r.get("created_ns", 0), r["id"]))
    return rows


def delete_proposal(store, proposal_id):
    """Remove one proposal; True when it existed."""
    ref = store.ref(PROPOSAL_KIND, proposal_id)
    if store.raw_get(ref) is None:
        return False
    # A None write deletes the document on commit (see QueryStore.atomic).
    store.raw_put(ref, None)
    return True


def _iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


def _public_row(row):
    return {
        "id": row["id"],
        "game_name": row["game_name"],
        "description": row["description"],
        "rules_url": row["rules_url"],
        "proposer_name": row["proposer_name"],
        "created_at": _iso(row["created_at"]),
    }


# ---------------------------------------------------------------------------
# HTTP endpoints
# ---------------------------------------------------------------------------


def make_router(platform_dependency, master_dependency):
    from fastapi import APIRouter, Depends, HTTPException
    from pydantic import BaseModel, Field, field_validator

    router = APIRouter()

    class ProposalIn(BaseModel):
        game_name: str = Field(min_length=1, max_length=120)
        description: str = Field(default="", max_length=2000)
        rules_url: str = Field(default="", max_length=500)
        proposer_name: str = Field(default="", max_length=120)

        @field_validator("game_name", "description", "rules_url", "proposer_name")
        @classmethod
        def _stripped(cls, value):
            return value.strip()

        @field_validator("rules_url")
        @classmethod
        def _http_url(cls, value):
            if value and not value.startswith(("https://", "http://")):
                raise ValueError("the rules link must start with http:// or https://")
            return value

    def store_of(platform):
        store = getattr(platform, "_store", None)
        if store is None or not proposals_supported(store):
            raise HTTPException(
                501, "game proposals require the Firestore query store"
            )
        return store

    @router.post("/game-proposals", status_code=201)
    def submit_proposal(payload: ProposalIn, platform=Depends(platform_dependency)):
        if not payload.game_name:
            raise HTTPException(422, "the game name is required")
        store = store_of(platform)
        row = create_proposal(
            store,
            game_name=payload.game_name,
            description=payload.description,
            rules_url=payload.rules_url,
            proposer_name=payload.proposer_name,
        )
        return _public_row(row)

    @router.get("/game-proposals", dependencies=[Depends(master_dependency)])
    def get_proposals(platform=Depends(platform_dependency)):
        store = store_of(platform)
        return {"proposals": [_public_row(row) for row in list_proposals(store)]}

    @router.delete(
        "/game-proposals/{proposal_id}",
        status_code=204,
        dependencies=[Depends(master_dependency)],
    )
    def remove_proposal(proposal_id: str, platform=Depends(platform_dependency)):
        store = store_of(platform)
        if not delete_proposal(store, proposal_id):
            raise HTTPException(404, "no proposal with that id")

    return router
