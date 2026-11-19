"""Erase attributable referral snapshot fields without enumerating live users."""

from google.cloud.firestore_v1.base_query import FieldFilter

from game_platform.query_store import key


_REFERRAL_PHASES = {"users", "prepare", "drain"}
_REFERRAL_SUMMARY = {"users", "invited_users", "inviters", "biggest_tree", "longest_chain", "cycles_broken"}


def _is_referral_report(row):
    return (isinstance(row, dict) and row.get("phase") in _REFERRAL_PHASES
            and isinstance(row.get("summary"), dict)
            and _REFERRAL_SUMMARY <= row["summary"].keys())


def purge_report_step(store, job):
    """One run selection, exact user-node deletion, or direct-child update.

    The caller holds its purge transaction and maintenance context and saves
    the returned job in that same transaction. Existing numeric summaries are
    historical aggregates and remain unchanged. Deleted account fences prevent
    a normal report writer from adding these user/parent associations again.
    """
    state = dict(job.get("reports") or {})
    if state.get("complete"):
        return job, True
    run_doc = state.get("run_doc")
    if run_doc is None:
        rows = store._query("dashboard_runs", limit=1, after=state.get("last_run"))
        if not rows:
            return {**job, "reports": {**state, "complete": True}}, True
        row = rows[0]
        report = store.raw_get(row.reference)
        state = {"last_run": row.id}
        if _is_referral_report(report):
            state.update(run_doc=row.id, account_index=0, phase="node")
        return {**job, "reports": state}, False

    report_ref = store.collection("dashboard_runs").document(run_doc)
    if not _is_referral_report(store.raw_get(report_ref)):
        return {**job, "reports": {"last_run": run_doc}}, False
    accounts = job["accounts"]
    index = state.get("account_index", 0)
    if index >= len(accounts):
        return {**job, "reports": {"last_run": run_doc}}, False
    user_id = accounts[index]
    nodes = report_ref.collection("referral_nodes")
    if state.get("phase", "node") == "node":
        own = nodes.document(key(user_id))
        if store.raw_get(own) is not None:
            store.raw_put(own, None)
        state["phase"] = "children"
        return {**job, "reports": state}, False

    # Query from the start: clearing parent_id removes each processed child
    # from this result, and concurrent normal writers cannot restore the fence.
    rows = list(nodes.where(filter=FieldFilter("parent_id", "==", user_id))
                .order_by("__name__").limit(1)
                .stream(transaction=store._local.uow["tx"]))
    if rows:
        child = rows[0]
        row = store.raw_get(child.reference)
        if row is not None:
            store.raw_put(child.reference, {**row, "parent_id": None, "parent_name": ""})
        return job, False
    state.update(account_index=index + 1, phase="node")
    return {**job, "reports": state}, False
