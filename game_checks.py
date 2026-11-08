"""Named verification checks run on every game import: extend CHECKS without
changing the import endpoint. (Formerly builder_checks; the AI generation and
review prompts that used to live here are gone with the Builder.)"""
from game_platform import game_text
from game_platform.game_contract import probe_leaving, probe_move_agreement, verify_examples
from game_platform.game_testing import test_server_code


def examples(code, server, spec, rules):
    results = verify_examples(server, spec['tests'])
    return {'passed': all(item['passed'] for item in results), 'details': results}


def settlement_probes(code, server, spec, rules):
    try:
        failures = probe_leaving(server, spec['tests'],
                                 allowed_player_counts=rules.allowed_player_counts,
                                 allows_leave_mid_match=rules.allows_leave_mid_match)
    except Exception as exc:  # a probe crash is a failed check, never a crashed build
        failures = [f'settlement probes could not run: {exc}']
    return {'passed': not failures, 'details': failures}


def move_agreement(code, server, spec, rules):
    try:
        failures = probe_move_agreement(server, spec['tests'])
    except Exception as exc:  # a probe crash is a failed check, never a crashed build
        failures = [f'move agreement probes could not run: {exc}']
    return {'passed': not failures, 'details': failures}


def localization(code, server, spec, rules):
    errors = game_text.lint(code, server)
    if 'applyLocale(' not in code:
        errors.append('Missing applyLocale(message) integration')
    return {'passed': not errors, 'details': errors}


def random_walks(code, server, spec, rules):
    from game_platform.game_testing import format_report
    test_schemas = spec['tests']
    game_schemas = {
        'state': test_schemas['state_schema'],
        'move': test_schemas['move_schema'],
        'view': test_schemas['view_schema'],
    }
    report = test_server_code(
        server,
        game_schemas=game_schemas,
        rules=rules,
        contract=test_schemas,
        budget_seconds=3,
        max_walks=1000,
    )
    return {'passed': report.passed, 'details': format_report(report)}


CHECKS = (('approved_examples', examples), ('settlement_probes', settlement_probes), ('move_agreement', move_agreement), ('localization', localization), ('random_walks', random_walks))


def run_checks(code, server, spec, rules, progress=lambda name: None, *, skip=()):
    results = {}
    for name, check in CHECKS:
        if name in skip: continue
        progress(name)
        results[name] = check(code, server, spec, rules)
    return results
