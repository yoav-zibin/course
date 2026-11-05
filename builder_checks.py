"""Named verification checks: extend CHECKS without changing the build worker."""
from game_platform import game_text
from game_platform.builder_validation import verify_examples
from game_platform.game_testing import test_server_code


def examples(code, server, spec, rules):
    results = verify_examples(server, spec['tests'])
    return {'passed': all(item['passed'] for item in results), 'details': results}


def localization(code, server, spec, rules):
    errors = game_text.lint(code)
    if 'applyLocale(' not in code:
        errors.append('Missing applyLocale(message) integration')
    return {'passed': not errors, 'details': errors}


def random_walks(code, server, spec, rules):
    report = test_server_code(server, rules=rules, contract=spec['tests'], budget_seconds=3, max_walks=1000)
    return {'passed': report.passed, 'details': str(report.failures)}


CHECKS = (('approved_examples', examples), ('localization', localization), ('random_walks', random_walks))
REVIEW_BRIEFS = (
    ('rules', 'Check setup, legal moves, turn order and terminal conditions against the approved rules.'),
    ('privacy', 'Check hidden information and spectator views; detect information leaks in viewFor.'),
    ('computers', 'Check computerMove legality, strategy and seeded deterministic randomness.'),
    ('settlement', 'Check joining, leaving, payouts and conservation of the pot.'),
)


def run_checks(code, server, spec, rules, progress=lambda name: None, *, skip=()):
    results = {}
    for name, check in CHECKS:
        if name in skip: continue
        progress(name)
        results[name] = check(code, server, spec, rules)
    return results
