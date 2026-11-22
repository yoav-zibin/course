"""Durable recruitment ancestry, independent of account and match retention.

Only opaque identifiers and lifecycle times belong here. Display names, login
identities, credentials and request/device information are never copied.
"""

from contextlib import nullcontext
from datetime import datetime, timezone

from game_platform.conversion_funnel import record_event


NODE_KIND = "recruitment_nodes"
NODE_FIELDS = (
    "user_id", "inviter_user_id", "via_match_id", "created_at", "attributed_at",
    "deleted_at", "merged_into_user_id", "original_inviter_user_id",
    "original_via_match_id", "original_attributed_at",
)


def _time(value):
    return value.isoformat() if isinstance(value, datetime) else value


def _read(store, user_id):
    """Read a historical node, lazily preserving a still-live legacy account."""
    node = store.get_analytics(NODE_KIND, user_id)
    if node is not None:
        return {field: node.get(field) for field in NODE_FIELDS}
    get_user = getattr(store, "get_user", None)
    user = get_user(user_id) if get_user else None
    if user is None:
        return None
    node = record_node(store, user_id, user.created_at)
    # The personal-referral cleanup must run before backfill. Even without it,
    # never copy an inviter without recorded match/invitation provenance.
    if user.invited_by_user_id and (
        user.invited_via_invite_token or user.invited_via_match_id
    ):
        node["inviter_user_id"] = user.invited_by_user_id
        node["via_match_id"] = user.invited_via_match_id
        node["attributed_at"] = _time(user.created_at)
    if user.replaced_by_user_id:
        node["merged_into_user_id"] = user.replaced_by_user_id
    store.put_analytics(NODE_KIND, user_id, node)
    return node


def record_node(store, user_id, created_at=None):
    """Create a root without changing an existing node or its first inviter."""
    existing = store.get_analytics(NODE_KIND, user_id)
    if existing is not None:
        return {field: existing.get(field) for field in NODE_FIELDS}
    if created_at is None:
        live = getattr(store, "get_user", lambda _: None)(user_id)
        if live is not None:
            return _read(store, user_id)
    node = dict.fromkeys(NODE_FIELDS)
    node.update(user_id=user_id, created_at=_time(created_at))
    store.put_analytics(NODE_KIND, user_id, node)
    return node


def canonical_user_id(store, user_id):
    """Resolve merged aliases; a deletion or missing ancestor is a valid root.

    Malformed merge cycles have no canonical account and resolve to ``None``.
    """
    seen = set()
    while user_id is not None:
        if user_id in seen:
            return None
        seen.add(user_id)
        node = _read(store, user_id)
        if node is None or not node["merged_into_user_id"]:
            return user_id
        user_id = node["merged_into_user_id"]
    return None


def inviter_chain(store, user_id):
    """Immediate inviter through terminal root, resolved against current nodes.

    A root can itself be recruited later, extending all descendants' chains.
    Deleted nodes retain their edges. Missing ancestors appear as the final ID,
    while malformed self-links and cycles stop without returning duplicates.
    """
    current = canonical_user_id(store, user_id)
    chain, seen = [], {current}
    while current is not None:
        node = _read(store, current)
        if node is None or not node["inviter_user_id"]:
            break
        parent = canonical_user_id(store, node["inviter_user_id"])
        if parent is None or parent in seen:
            break
        chain.append(parent)
        seen.add(parent)
        current = parent
    return chain


def record_attribution(store, user_id, inviter_user_id, *, via_match_id, at, created_at=None):
    """Assign the first historical inviter, excluding self-links and cycles."""
    canonical = canonical_user_id(store, user_id)
    parent = canonical_user_id(store, inviter_user_id)
    node = _read(store, canonical) if canonical is not None else None
    if node is None:
        node = record_node(store, user_id, created_at or at)
    if (
        canonical is None or parent is None or canonical == parent
        or node["inviter_user_id"] or canonical in inviter_chain(store, parent)
    ):
        return node
    # Preserve a minimal ancestor even if its live account has already gone.
    if _read(store, parent) is None:
        record_node(store, parent)
    node.update(inviter_user_id=parent, via_match_id=via_match_id,
                attributed_at=_time(at))
    store.put_analytics(NODE_KIND, canonical, node)
    return node


def mark_deleted(store, user_id, at):
    """Keep an account's graph node after deleting its live account and PII."""
    node = _read(store, user_id) or record_node(store, user_id)
    if node["deleted_at"] is None:
        node["deleted_at"] = _time(at)
        store.put_analytics(NODE_KIND, user_id, node)
    record_event(store, "account_deleted", identity="deleted:" + user_id,
                 at=at, user_id=user_id)
    return node


def mark_merged(store, user_id, into_user_id, at=None):
    """Retain the old identifier as an alias of the surviving graph node."""
    node = _read(store, user_id) or record_node(store, user_id, at)
    target = canonical_user_id(store, into_user_id)
    if target is None or target == user_id:
        return node
    target_node = _read(store, target) or record_node(store, target, at)
    source = canonical_user_id(store, user_id)
    source_node = _read(store, source) if source is not None else node
    if source != target and source in inviter_chain(store, target):
        # Merging an ancestor into its descendant makes the path between them
        # internal to the merged account. Keep the source's external ancestor,
        # and retain the survivor's original edge as permanent audit evidence.
        if target_node["original_inviter_user_id"] is None:
            target_node.update(
                original_inviter_user_id=target_node["inviter_user_id"],
                original_via_match_id=target_node["via_match_id"],
                original_attributed_at=target_node["attributed_at"],
            )
        target_node.update(
            inviter_user_id=source_node["inviter_user_id"],
            via_match_id=source_node["via_match_id"],
            attributed_at=source_node["attributed_at"],
        )
        store.put_analytics(NODE_KIND, target, target_node)
    elif source_node and source_node["inviter_user_id"]:
        record_attribution(store, target, source_node["inviter_user_id"],
                           via_match_id=source_node["via_match_id"], at=source_node["attributed_at"])
    node["merged_into_user_id"] = target
    store.put_analytics(NODE_KIND, user_id, node)
    record_event(store, "account_merged", identity="merged:" + user_id,
                 at=at or datetime.now(timezone.utc), user_id=user_id,
                 into_user_id=target)
    return node


def backfill_nodes(store, *, limit=100, cursor=None):
    """Preserve retained accounts after removing legacy personal attribution.

    Read one bounded user page. This is an explicit migration helper, never a
    startup scan; durable nodes already retained after deletion are untouched.
    """
    if not 1 <= limit <= 100:
        raise ValueError("recruitment backfill limit must be between 1 and 100")
    counts = {"processed": 0, "created": 0, "attributed": 0, "next_cursor": None}
    if getattr(store, "scalable", False):
        page = store.page("users", limit=limit, cursor=cursor,
                          scope="recruitment-history-backfill")
        users, counts["next_cursor"] = page.items, page.next_cursor
    else:
        # The in-memory fixture store has no remote paging or startup import.
        users = sorted(store.list_users(), key=lambda user: user.id)
        if cursor is not None:
            users = [user for user in users if user.id > cursor]
        if len(users) > limit:
            counts["next_cursor"] = users[limit - 1].id
        users = users[:limit]
    for user in users:
        counts["processed"] += 1
        # Commit the event and its aggregate counters together, so a resumed
        # migration cannot keep the event but permanently miss its counters.
        with getattr(store, "atomic", nullcontext)():
            existing = store.get_analytics(NODE_KIND, user.id)
            node = _read(store, user.id)
            counts["created"] += int(existing is None)
            if existing is None and node["inviter_user_id"]:
                counts["attributed"] += 1
            record_event(store, "account_created", identity="signup:" + user.id,
                         at=user.created_at, user_id=user.id, reconstructed=True)
            if node["inviter_user_id"] and (
                node["via_match_id"] or user.invited_via_invite_token
            ):
                record_event(store, "recruited", identity="recruited:" + user.id,
                             at=node["attributed_at"] or user.created_at,
                             user_id=user.id, owner_user_id=node["inviter_user_id"],
                             match_id=node["via_match_id"], reconstructed=True,
                             on_signup=True if user.invited_via_invite_token else None)
    return counts
