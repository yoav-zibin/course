import pytest

from game_platform.testing import Api


@pytest.fixture
def api() -> Api:
    return Api()
