from game_platform.tests.helpers import TEST_DECLARATIVE_UI
import datetime as dt

from game_platform.models import GameRules
from fastapi.testclient import TestClient

from game_platform.api import create_app
from game_platform.json_file_store import JsonFileStore
from game_platform.models import Experiment, ExperimentAssignment, ExperimentEvent, ExperimentVariant
from game_platform.service import GamePlatform
from game_platform.tests.helpers import Api, ECHO_SERVER_CODE, TEST_GAME_SCHEMAS


def test_accounts_do_not_create_ui_experiments_or_assignments() -> None:
    api = Api()
    user_id = api.new_user("alice")
    platform = api.client.app.state.platform
    assert [item.id for item in platform.list_experiments()] == ["ad-campaigns"]
    assert platform._store.list_experiment_assignments() == []
    assert platform._store.list_experiment_events() == []
    assert set(platform.experiment_stats()) == {"generated_at", "campaign_experiment"}
    assert api.request("GET", "/users/me/experiments/skin", as_user=user_id).status_code == 404
    assert api.request(
        "POST", "/admin/experiments/skin-variants",
        json={"name": "Retired", "key": "retired"},
    ).status_code == 405
    schema = api.client.app.openapi()
    assert not any("skin" in route for route in schema["paths"])
    assert "SkinAssignmentOut" not in schema["components"]["schemas"]


def test_signup_experiment_events_do_not_consume_generated_ids() -> None:
    ids = iter(("user-1", "game-1"))
    platform = GamePlatform(new_id=lambda: next(ids))
    user = platform.create_user(display_name="alice", campaign_code="students-a")
    assert len(platform._store.list_experiment_events()) == 1

    game = platform.create_game(

        name="game",
        description="",
        rules=GameRules(
            allowed_player_counts=(1,),
            allows_leave_mid_match=False,
            allows_join_mid_match=False,
        ),
        code="",
        server_code=ECHO_SERVER_CODE,
        game_schemas=TEST_GAME_SCHEMAS,
        import_package={"declarative_ui": TEST_DECLARATIVE_UI},
    )

    assert game.id == "game-1"


def test_match_start_tracking_uses_match_timestamp_without_advancing_clock() -> None:
    now = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
    clock_reads = 0

    def clock() -> dt.datetime:
        nonlocal clock_reads, now
        clock_reads += 1
        now += dt.timedelta(minutes=1)
        return now

    ids = iter(("user-1", "game-1", "match-1"))
    platform = GamePlatform(clock=clock, new_id=lambda: next(ids))
    user = platform.create_user(display_name="alice", campaign_code="students-a")
    game = platform.create_game(

        name="game",
        description="",
        rules=GameRules(
            allowed_player_counts=(1,),
            allows_leave_mid_match=False,
            allows_join_mid_match=False,
        ),
        code="",
        server_code=ECHO_SERVER_CODE,
        game_schemas=TEST_GAME_SCHEMAS,
        import_package={"declarative_ui": TEST_DECLARATIVE_UI},
    )
    match = platform.create_match(
        caller_id=user.id, game_id=game.id, num_computer_opponents=0
    )
    started = platform.start_match(caller_id=user.id, match_id=match.id)
    match_start_event = next(
        event
        for event in platform._store.list_experiment_events()
        if event.kind == "match_start"
    )

    assert clock_reads == 5
    assert match_start_event.occurred_at == started.updated_at
    assert platform._store.get_user(user.id).updated_at == started.updated_at


def test_retired_experiment_data_loads_safely_and_stays_inert(tmp_path) -> None:
    path = tmp_path / "historical.json"
    store = JsonFileStore(path)
    api = Api(store=store)
    user_id = api.new_user("existing account")
    now = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
    variant = ExperimentVariant(id="old-variant", name="Historical", key="historical")
    historical = Experiment(
        id="ui-skins", kind="skin", name="Retired experiment", active=True,
        variants=(variant,), created_at=now, updated_at=now,
    )
    assignment = ExperimentAssignment(
        user_id=user_id, experiment_id=historical.id, variant_id=variant.id,
        assigned_at=now,
    )
    event = ExperimentEvent(
        id="historical-signup", experiment_id=historical.id, variant_id=variant.id,
        kind="signup", user_id=user_id, occurred_at=now,
    )
    store.put_experiment(historical)
    store.put_experiment_assignment(assignment)
    store.put_experiment_event(event)
    store.close()

    restarted = JsonFileStore(path)
    restarted_api = Api(store=restarted)
    platform = restarted_api.client.app.state.platform
    platform.record_new_user(user_id=user_id, campaign_code=None, occurred_at=now)
    platform.record_match_start(
        user_id=user_id, match_id="later-match", occurred_at=now + dt.timedelta(days=8),
    )
    assert [item.id for item in platform.list_experiments()] == ["ad-campaigns"]
    assert set(platform.experiment_stats()) == {"generated_at", "campaign_experiment"}
    assert next(item for item in restarted.list_experiments() if item.id == historical.id) == historical
    assert restarted.list_experiment_assignments() == [assignment]
    assert restarted.list_experiment_events() == [event]
    assert restarted_api.request(
        "PATCH", "/admin/experiments/ui-skins", json={"active": False},
    ).status_code == 404
    assert restarted_api.request(
        "DELETE", "/admin/experiments/ui-skins/variants/old-variant",
    ).status_code == 404
    restarted.close()


def test_campaign_funnel_and_seven_day_returning_users() -> None:
    api = Api()
    click = api.client.get("/c/students-a", follow_redirects=False)
    assert click.status_code == 302
    assert click.headers["location"] == "/portal?campaign=students-a"

    signup = api.client.post(
        "/users",
        headers={"X-Campaign-Code": "students-a"},
        json={"display_name": "campaign user"},
    )
    assert signup.status_code == 201
    user_id = signup.json()["id"]
    api.passwords_by_user_id[user_id] = signup.json()["password"]

    game_id = api.new_game(owner=user_id)
    api.new_match(
        owner=user_id,
        game_id=game_id,
        num_computer_opponents=1,
        start=True,
    )
    account = api.client.app.state.platform._store.get_user(user_id)
    assert account is not None
    api.client.app.state.platform._clock = lambda: (
        account.created_at + dt.timedelta(days=8)
    )
    api.new_match(
        owner=user_id,
        game_id=game_id,
        num_computer_opponents=1,
        start=True,
    )

    stats = api.ok("GET", "/admin/experiments")
    campaign = next(
        item
        for item in stats["campaign_experiment"]["variants"]
        if item["key"] == "students-a"
    )
    assert campaign["clicks"] == 1
    assert campaign["signups"] == 1
    assert campaign["match_starts"] == 2
    assert campaign["users_started_match"] == 1
    assert campaign["returning_active_users"] == 1
    assert campaign["signup_rate"] == 100
    assert campaign["return_rate"] == 100


def test_admin_can_create_campaign_variants() -> None:
    api = Api()
    campaign = api.ok(
        "POST",
        "/admin/experiments/campaign-links",
        json={"name": "Student D", "key": "students-d"},
    )
    assert campaign["url"].endswith("/c/students-d")
    assert campaign["budget_usd"] == 100
    spent = api.ok(
        "PATCH",
        f"/admin/experiments/campaign-links/{campaign['variant_id']}",
        json={"spend_usd": 73.5},
    )
    assert spent["spend_usd"] == 73.5
    assert api.request(
        "PATCH",
        f"/admin/experiments/campaign-links/{campaign['variant_id']}",
        json={"spend_usd": 101},
    ).status_code == 422


def test_admin_can_delete_variants_and_their_experiment_data() -> None:
    api = Api()
    platform = api.client.app.state.platform
    user_id = api.new_user("campaign user")
    experiment, variant = platform.add_experiment_variant(
        experiment_id="ad-campaigns", name="Temporary campaign", key="temporary-campaign",
        budget_usd=100,
    )
    platform._store.put_experiment_assignment(
        ExperimentAssignment(
            user_id=user_id, experiment_id=experiment.id, variant_id=variant.id,
            assigned_at=dt.datetime.now(dt.timezone.utc),
        )
    )
    platform.record_new_user(user_id=user_id, campaign_code=variant.key)
    api.client.get("/c/temporary-campaign")
    route = f"/admin/experiments/{experiment.id}/variants/{variant.id}"
    assert api.request("DELETE", route).status_code == 204
    assert platform._store.get_experiment_assignment(
        user_id=user_id, experiment_id=experiment.id,
    ) is None
    assert not any(
        event.variant_id == variant.id
        for event in platform._store.list_experiment_events()
    )
    campaign_stats = api.ok("GET", "/admin/experiments")["campaign_experiment"]
    assert all(item["variant_id"] != variant.id for item in campaign_stats["variants"])
    assert api.request("DELETE", route).status_code == 404


def test_experiment_records_survive_json_store_restart(tmp_path) -> None:
    path = tmp_path / "data.json"
    store = JsonFileStore(path)
    api = Api(store=store)
    api.client.get("/c/students-b")
    signup = api.client.post(
        "/users",
        headers={"X-Campaign-Code": "students-b"},
        json={"display_name": "persisted user"},
    )
    assert signup.status_code == 201
    store.close()

    restarted = JsonFileStore(path)
    stats = Api(store=restarted).ok("GET", "/admin/experiments")
    restarted.close()
    campaign = next(
        item
        for item in stats["campaign_experiment"]["variants"]
        if item["key"] == "students-b"
    )
    assert campaign["clicks"] == 1
    assert campaign["signups"] == 1


def test_deleting_a_user_removes_user_level_experiment_data() -> None:
    api = Api()
    signup = api.client.post(
        "/users",
        headers={"X-Campaign-Code": "students-c"},
        json={"display_name": "deleted user"},
    )
    user_id = signup.json()["id"]
    before = api.ok("GET", "/admin/experiments")
    assert next(
        item
        for item in before["campaign_experiment"]["variants"]
        if item["key"] == "students-c"
    )["signups"] == 1

    api.ok("DELETE", f"/admin/users/{user_id}")
    after = api.ok("GET", "/admin/experiments")
    assert next(
        item
        for item in after["campaign_experiment"]["variants"]
        if item["key"] == "students-c"
    )["signups"] == 0


def test_experiment_admin_endpoints_require_master_password() -> None:
    client = TestClient(create_app(GamePlatform(), master_password="secret"))
    assert client.get("/admin/experiments").status_code == 401
    assert client.get(
        "/admin/experiments", auth=("admin", "secret")
    ).status_code == 200
    assert client.post(
        "/admin/experiments/campaign-links",
        auth=("admin", "secret"),
        json={"name": "New campaign", "key": "new-campaign"},
    ).status_code == 201
    assert client.delete(
        "/admin/experiments/ad-campaigns/variants/missing"
    ).status_code == 401
    assert client.delete(
        "/admin/experiments/ad-campaigns/variants/missing",
        auth=("admin", "secret"),
    ).status_code == 404
