"""Declarative packages must expose server messages for localization."""

import copy

import pytest

from game_platform import game_text
from game_platform.config import TranslationConfig
from game_platform.declarative_ui import client_document
from game_platform.models import GameRules
from game_platform.service import InvalidRequestError
from game_platform.tests.helpers import Api, ECHO_SERVER_CODE, TEST_GAME_SCHEMAS, TEST_DECLARATIVE_UI

SERVER = ECHO_SERVER_CODE.replace('throw new InvalidMove();', "throw new InvalidMove('Choose one');")


def package(*, strings):
    spec = copy.deepcopy(TEST_DECLARATIVE_UI)
    spec['strings'] = strings
    return spec


def create(platform, spec):
    return platform.create_game(
        caller_id='author', name='Portable game', description='',
        rules=GameRules(allowed_player_counts=(2,), allows_leave_mid_match=False,
                        allows_join_mid_match=False),
        code=client_document(spec), server_code=SERVER,
        game_schemas=TEST_GAME_SCHEMAS, import_package={'declarative_ui': spec})


def test_translation_is_required_by_default():
    assert TranslationConfig().require_strings is True


def test_declarative_server_messages_require_string_templates():
    api = Api(require_game_strings=True)
    with pytest.raises(InvalidRequestError, match='cannot be translated'):
        create(api.platform, package(strings={}))
    spec = package(strings={'server_choose': 'Choose one'})
    assert game_text.lint(client_document(spec), SERVER) == []
    assert create(api.platform, spec).import_package['declarative_ui'] == spec


def test_declarative_code_changes_require_complete_package_but_metadata_can_change():
    api = Api(require_game_strings=True)
    owner = api.new_user('Author')
    spec = package(strings={'server_choose': 'Choose one'})
    game = api.platform.create_game(
        caller_id=owner, name='Portable game', description='',
        rules=GameRules(allowed_player_counts=(2,), allows_leave_mid_match=False,
                        allows_join_mid_match=False),
        code=client_document(spec), server_code=SERVER,
        game_schemas=TEST_GAME_SCHEMAS, import_package={'declarative_ui': spec})
    broken = api.request('PATCH', f'/games/{game.id}', as_user=owner,
                         json={'code': '<html>Legacy code</html>'})
    assert broken.status_code == 400
    assert 'POST /games/declarative' in broken.json()['detail']
    assert api.ok('GET', f'/games/{game.id}')['version'] == 1
    assert api.ok('PATCH', f'/games/{game.id}', as_user=owner,
                  json={'description': 'New description'})['version'] == 2


def test_disabling_localization_check_keeps_declarative_package_requirement():
    api = Api(require_game_strings=False)
    assert create(api.platform, package(strings={})).is_declarative
    with pytest.raises(InvalidRequestError, match='HTML games are read-only'):
        api.platform.create_game(
            caller_id='author', name='Old game', description='',
            rules=GameRules(allowed_player_counts=(2,), allows_leave_mid_match=False,
                            allows_join_mid_match=False),
            code='<html>Legacy code</html>', server_code=SERVER,
            game_schemas=TEST_GAME_SCHEMAS)
