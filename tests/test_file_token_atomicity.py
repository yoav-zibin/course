"""A file snapshot must never split a wallet payout from its settled match."""

import threading

import pytest

from game_platform.json_file_store import JsonFileStore, read_snapshot
from game_platform.service import ConflictError, GamePlatform
from game_platform.tests.helpers import Api
from game_platform.tests.test_match_pot_refunds import paid_match


class ControlledWriter(JsonFileStore):
    """Start the real writer only after the test reaches its payout boundary."""

    def __init__(self, path):
        self.start_writer = threading.Event()
        self.writer_entered_flush = threading.Event()
        self.saved = threading.Event()
        self.snapshots = []
        super().__init__(path, min_write_interval_seconds=0)

    def _write_loop(self):
        self.start_writer.wait()
        super()._write_loop()

    def flush(self):
        if threading.current_thread() is self._writer:
            self.writer_entered_flush.set()
        super().flush()

    def _save(self, snapshot):
        super()._save(snapshot)
        self.snapshots.append(snapshot)
        self.saved.set()

    def close(self):
        self.start_writer.set()
        super().close()


def test_payout_and_pot_cannot_be_saved_separately_then_credited_again(tmp_path, monkeypatch):
    path = tmp_path / "wallets.json"
    store = ControlledWriter(path)
    release_payout = threading.Event()
    first_credit = threading.Event()
    errors = []
    worker = None
    try:
        api = Api(store=store)
        match_id, alice, bob = paid_match(api)
        platform = api.platform
        store.flush()
        store.saved.clear()
        store.snapshots.clear()
        credit = platform._credit_tokens

        def pause_after_credit(user_id, amount):
            credit(user_id, amount)
            if user_id == alice and amount:
                first_credit.set()
                assert release_payout.wait(5), "test never released payout"

        monkeypatch.setattr(platform, "_credit_tokens", pause_after_credit)
        move = {"turn_indices": None, "payouts": {alice: 10, bob: 0}}

        def finish_match():
            try:
                platform.make_move(caller_id=alice, match_id=match_id,
                                   expected_move_count=0, move=move)
            except BaseException as error:
                errors.append(error)

        worker = threading.Thread(target=finish_match, daemon=True)
        worker.start()
        assert first_credit.wait(5)
        store.start_writer.set()
        assert store.writer_entered_flush.wait(5)
        saved_mid_payout = store.saved.wait(0.15)
        partial = read_snapshot(path) if saved_mid_payout else None
        partial_total = (sum(user.token_balance for user in partial.users)
                         + sum(match.token_pot for match in partial.matches)) if partial else None
        release_payout.set()
        worker.join(5)
        assert not worker.is_alive()
        assert not errors
        store.flush()
        assert not saved_mid_payout, (
            "writer saved a credited wallet while the original pot was still held",
            partial_total,
        )
        assert all(sum(user.token_balance for user in snapshot.users)
                   + sum(match.token_pot for match in snapshot.matches) == 20
                   for snapshot in store.snapshots)
    finally:
        release_payout.set()
        if worker is not None:
            worker.join(5)
        store.close()

    restarted = JsonFileStore(path)
    try:
        platform = GamePlatform(store=restarted)
        assert [restarted.get_user(uid).token_balance for uid in (alice, bob)] == [15, 5]
        assert restarted.get_match(match_id).token_pot == 0
        with pytest.raises(ConflictError):
            platform.make_move(caller_id=alice, match_id=match_id,
                               expected_move_count=0, move=move)
        assert [restarted.get_user(uid).token_balance for uid in (alice, bob)] == [15, 5]
    finally:
        restarted.close()


def test_flush_inside_operation_does_not_deadlock_with_waiting_writer(tmp_path):
    store = ControlledWriter(tmp_path / "wallets.json")
    finished = threading.Event()
    errors = []

    def operation_and_flush():
        try:
            platform = GamePlatform(store=store)
            with platform._lock:
                platform.create_user(display_name="Pending save")
                store.start_writer.set()
                assert store.writer_entered_flush.wait(5)
                # Give a writer using the old inverse order a chance to take its
                # write lock before this reentrant flush tries to acquire it.
                store.saved.wait(0.1)
                store.flush()
            finished.set()
        except BaseException as error:
            errors.append(error)
            finished.set()

    worker = threading.Thread(target=operation_and_flush, daemon=True)
    worker.start()
    assert finished.wait(5), "operation flush deadlocked with the background writer"
    worker.join(5)
    try:
        assert not errors
        assert store.operation_lock is store._lock
        assert len(read_snapshot(store._path).users) == 1
    finally:
        store.close()
