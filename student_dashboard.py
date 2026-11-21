"""Private course leaderboard, built from roster and bounded activity queries.

The course sheet contains unrelated private cells. Only roster columns are used;
neither the CSV nor its credentials are stored or returned. All exposed account
records are an explicit allowlist, never the admin user/password serializer.
"""

import csv
import datetime as dt
import io
import re
import threading
import time
import unicodedata
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse


ROSTER_SHEET_URL = "https://docs.google.com/spreadsheets/d/1-_GPw7Sd_ZOmv21VgsVshiH-Q2GpeVeZiBP6UB2ovH4/edit"
ROSTER_CSV_URL = ROSTER_SHEET_URL.rsplit("/", 1)[0] + "/export?format=csv&range=A1%3AC14"
CACHE_SECONDS = 60
ROSTER_CACHE_SECONDS = 3600
MATCH_KINDS = ("computer", "pass_and_play", "multiplayer")
_EMAIL = re.compile(r"[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+")


@dataclass(frozen=True)
class CoursePerson:
    id: str
    name: str
    role: str
    institutional_email: str | None
    personal_email: str | None
    emails: tuple[str, ...]


def email_addresses(value):
    return tuple(dict.fromkeys(address.casefold() for address in _EMAIL.findall(value or "")))


def name_tokens(value):
    normalized = unicodedata.normalize("NFKD", value.casefold())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.findall(r"[^\W\d_]+", normalized)


def parse_roster(text):
    """Select roster records only, never other sheet cells (including notes)."""
    rows = csv.DictReader(io.StringIO(text))
    if not {"Email", "Apple account email", "Full name"}.issubset(rows.fieldnames or ()):
        raise ValueError("course roster columns have changed")
    students = []
    instructor_emails = ()
    for row in rows:
        primary = email_addresses(row.get("Email"))
        institutional = next((email for email in primary
                              if email.endswith(("@columbia.edu", "@barnard.edu"))), None)
        raw_name = (row.get("Full name") or "").strip()
        if institutional and raw_name:
            personal = email_addresses(row.get("Apple account email"))
            name = " ".join(reversed(raw_name.split(",", 1))) if "," in raw_name else raw_name
            students.append(CoursePerson(
                institutional.split("@", 1)[0], " ".join(name.split()), "student",
                institutional, personal[0] if personal else None,
                tuple(dict.fromkeys((*primary, *personal))),
            ))
        elif any(email.split("@", 1)[0] == "yoav.zibin" for email in primary):
            instructor_emails = primary
    if len(students) != 12 or len({student.id for student in students}) != 12 or not instructor_emails:
        raise ValueError("course roster must contain the instructor and 12 distinct students")
    instructor = CoursePerson("yoav-zibin", "Yoav ZIBIN", "instructor", None,
                              instructor_emails[0], instructor_emails)
    return [instructor, *students]


def fetch_roster():
    # A fixed URL and size/time bounds prevent the roster dependency from tying up
    # an admin worker indefinitely. Errors never include response bodies.
    with urllib.request.urlopen(ROSTER_CSV_URL, timeout=10) as response:
        body = response.read(1_000_001)
    if len(body) > 1_000_000:
        raise ValueError("course roster exceeds its size limit")
    return parse_roster(body.decode("utf-8-sig"))


def account_emails(user):
    emails = list(email_addresses(user.email))
    for account in user.linked_accounts:
        if account.kind == "email":
            emails.extend(email_addresses(account.identifier))
    return sorted(set(emails))


def match_reasons(person, user):
    reasons = []
    if set(person.emails) & set(account_emails(user)):
        reasons.append("Roster email")
    tokens = name_tokens(person.name)
    displayed = set(name_tokens(user.display_name))
    if tokens and tokens[0] in displayed:
        reasons.append("First name")
    if tokens and tokens[-1] in displayed:
        reasons.append("Last name")
    return reasons


def all_users(store):
    if not getattr(store, "scalable", False):
        return store.list_users()
    users, cursor = [], None
    while True:
        page = store.page("users", limit=100, cursor=cursor, scope="student-dashboard")
        users.extend(page.items)
        cursor = page.next_cursor
        if cursor is None:
            return users


def report_headers(store):
    after = None
    while True:
        rows, after = store.list_bug_reports(status=None, limit=100, after=after)
        yield from rows
        if after is None:
            return


def empty_matches():
    return {"total": 0, **dict.fromkeys(MATCH_KINDS, 0), "waiting": 0,
            "by_status": dict.fromkeys(("waiting_for_players", "ongoing", "over"), 0)}


def count_match(counts, match):
    counts["by_status"][match["status"]] += 1
    if match["status"] == "waiting_for_players":
        counts["waiting"] += 1
        return
    counts["total"] += 1
    counts[match["match_kind"]] += 1


def report_sample(row):
    return {key: row.get(key) for key in (
        "id", "text", "score", "score_rationale", "status", "resolution",
        "changes_summary", "created_at", "reporter_user_id",
    )}


def build_dashboard(store, roster, *, roster_fetched_at):
    users = {user.id: user for user in all_users(store)}
    canonical = {}

    def resolve(user_id):
        if user_id in canonical:
            return canonical[user_id]
        current, seen = user_id, set()
        while current in users and users[current].replaced_by_user_id:
            if current in seen:
                raise ValueError("an account merge cycle prevents computing the leaderboard")
            seen.add(current)
            current = users[current].replaced_by_user_id
        canonical[user_id] = current
        return current

    aliases = defaultdict(set)
    for user_id in users:
        aliases[resolve(user_id)].add(user_id)
    # Reuse the platform's persisted referral relation: merged accounts are not
    # new players; references to merged inviters resolve to the surviving owner.
    children = defaultdict(set)
    for user in users.values():
        if user.replaced_by_user_id is None and user.invited_by_user_id:
            parent = resolve(user.invited_by_user_id)
            if parent in users and parent != user.id:
                children[parent].add(user.id)

    students, cohorts, descendants = [], [], []
    account_owners = defaultdict(list)
    for person in roster:
        matched = {user.id: match_reasons(person, user) for user in users.values()}
        matched = {user_id: reasons for user_id, reasons in matched.items() if reasons}
        roots = {resolve(user_id) for user_id in matched}
        # Name/email may survive only on a merged alias. Include its survivor and
        # every alias so historical reports remain attributable after a merge.
        account_ids = set().union(*(aliases[root] for root in roots)) if roots else set()
        accounts = []
        for user_id in sorted(account_ids, key=lambda uid: (users[uid].created_at, uid)):
            user = users[user_id]
            reasons = matched.get(user_id) or ["Merged account"]
            account_owners[user_id].append(person.name)
            accounts.append({
                "id": user.id, "display_name": user.display_name,
                "emails": account_emails(user),
                "login_methods": sorted({account.kind for account in user.linked_accounts}) or ["guest"],
                "match_reasons": reasons,
                "canonical_user_id": resolve(user.id),
                "replaced_by_user_id": user.replaced_by_user_id,
                "created_at": user.created_at.isoformat(),
            })
        direct = set().union(*(children[root] for root in roots)) - roots if roots else set()
        recruited, seen, pending = set(), set(roots), list(direct)
        while pending:
            user_id = pending.pop()
            if user_id in seen:
                continue
            seen.add(user_id)
            recruited.add(user_id)
            pending.extend(children[user_id] - seen)
        cohorts.append(roots)
        descendants.append(recruited)
        students.append({
            "id": person.id, "name": person.name, "role": person.role,
            "institutional_email": person.institutional_email,
            "personal_email": person.personal_email, "emails": list(person.emails),
            "accounts": accounts, "account_count": len(accounts),
            "canonical_account_count": len(roots),
            "matches": empty_matches(), "other_players": 0,
            "direct_recruits": len(direct), "transitive_recruits": len(recruited),
            "recruits_matches": empty_matches(),
            "reports": {"total": 0, "assessed": 0, "unassessed": 0,
                        "average_score": None,
                        "status_counts": dict.fromkeys(("open", "handling", "escalated", "handled"), 0),
                        "top": [], "lowest": []},
        })

    target_ids = set().union(*cohorts, *descendants)
    # Query the aliases too: old valid headers may retain pre-merge ownership.
    target_ids |= set().union(*(aliases[root] for root in target_ids)) if target_ids else set()
    opponents = [set() for _ in students]
    seen_matches = set()
    for match in store.iter_student_match_summaries(target_ids):
        if match["id"] in seen_matches:
            continue
        seen_matches.add(match["id"])
        participants = {resolve(user_id) for user_id in match["participants"]}
        for index, student in enumerate(students):
            if participants & cohorts[index]:
                count_match(student["matches"], match)
                if match["match_kind"] == "multiplayer" and match["status"] != "waiting_for_players":
                    opponents[index].update(participants - cohorts[index])
            if participants & descendants[index]:
                count_match(student["recruits_matches"], match)
    for index, student in enumerate(students):
        student["other_players"] = len(opponents[index])

    score_totals = Counter()
    for row in report_headers(store):
        reporter = resolve(row.get("reporter_user_id"))
        for index, student in enumerate(students):
            if reporter not in cohorts[index]:
                continue
            reports = student["reports"]
            reports["total"] += 1
            status = row.get("status", "open")
            reports["status_counts"][status] = reports["status_counts"].get(status, 0) + 1
            score = row.get("score")
            if type(score) is not int or not 0 <= score <= 10:
                continue
            reports["assessed"] += 1
            score_totals[index] += score
            sample = report_sample(row)
            reports["top"] = sorted([*reports["top"], sample],
                                    key=lambda report: (-report["score"], report["id"]))[:3]
            reports["lowest"] = sorted([*reports["lowest"], sample],
                                       key=lambda report: (report["score"], report["id"]))[:3]
    for index, student in enumerate(students):
        reports = student["reports"]
        reports["unassessed"] = reports["total"] - reports["assessed"]
        if reports["assessed"]:
            reports["average_score"] = round(score_totals[index] / reports["assessed"], 2)

    notes = ["A platform account matches more than one course member by name: "
             + ", ".join(names) + ". Review the account matches before comparing totals."
             for names in account_owners.values() if len(names) > 1]
    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "roster_source_url": ROSTER_SHEET_URL, "roster_fetched_at": roster_fetched_at,
        "cache_seconds": CACHE_SECONDS, "students": students, "notes": list(dict.fromkeys(notes)),
        "methodology": {
            "account_matching": "Exact roster email or a whole first/last-name token, ignoring case and accents. "
                                "Merged accounts and their historical IDs are included. Name matches are heuristic; "
                                "one ambiguous account can appear for more than one course member.",
            "matches": "Started cloud matches (ongoing or over), counted once per course member across all their "
                       "accounts. Waiting lobbies are shown separately. Other players are distinct human multiplayer "
                       "accounts, resolving merges and excluding this member's accounts. Unsynced device saves and "
                       "deleted matches are unavailable.",
            "referrals": "Recorded inviter links, transitively through all generations. Merged accounts count once; "
                         "the member's own accounts are excluded. Recruited-player matches count each started match "
                         "once even when several recruits played it. Untracked word-of-mouth invitations are unavailable.",
            "bug_reports": "Private bug reports attributed by reporter user ID, including merged aliases. Average "
                           "and highest/lowest examples use only assessed scores (0–10); zero counts, unassessed "
                           "reports do not. Legacy feedback is separate.",
        },
    }


class DashboardCache:
    def __init__(self):
        self.lock = threading.Lock()
        self.roster = None
        self.roster_at = 0
        self.roster_fetched_at = None
        self.payload = None
        self.payload_at = 0

    def get(self, store):
        with self.lock:
            now = time.monotonic()
            if self.payload is not None and now - self.payload_at < CACHE_SECONDS:
                return self.payload
            if self.roster is None or now - self.roster_at >= ROSTER_CACHE_SECONDS:
                try:
                    roster = fetch_roster()
                except (OSError, ValueError, UnicodeError, csv.Error):
                    raise HTTPException(503, "The course roster could not be loaded. Try again shortly.") from None
                self.roster = roster
                self.roster_at = time.monotonic()
                self.roster_fetched_at = dt.datetime.now(dt.timezone.utc).isoformat()
            try:
                payload = build_dashboard(store, self.roster, roster_fetched_at=self.roster_fetched_at)
            except ValueError:
                raise HTTPException(503, "The student leaderboard could not be computed. No partial totals are shown.") from None
            self.payload, self.payload_at = payload, time.monotonic()
            return payload


def make_router(platform_dependency, master_dependency):
    router = APIRouter(dependencies=[Depends(master_dependency)], include_in_schema=False)
    cache = DashboardCache()

    @router.get("/admin/students")
    def students_page():
        return FileResponse(Path(__file__).parent / "static" / "students.html")

    @router.get("/admin/students/data")
    def students_data(platform=Depends(platform_dependency)):
        return cache.get(platform._store)

    return router
