#!/usr/bin/env python3
"""Prepare Xcode-style simulated XML/DER entitlements, never host signatures."""
import argparse
from pathlib import Path
import plistlib
import re
import subprocess


SIMULATOR_PREFIX = 'TESTTEAM00'


def simulated_entitlements(identifier):
    if not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+', identifier):
        raise ValueError('Expected a resolved simulator bundle identifier')
    group = f'{SIMULATOR_PREFIX}.{identifier}'
    return {'application-identifier': group, 'keychain-access-groups': [group]}


def prepare(directory, identifier, run=subprocess.run):
    values = simulated_entitlements(identifier)
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    xml = directory / 'BuildPlay-Simulated.xcent'
    der = directory / 'BuildPlay-Simulated.xcent.der'
    xml.write_bytes(plistlib.dumps(values))
    # Xcode uses derq for the __TEXT,__ents_der companion section.
    run(['/usr/bin/derq', 'query', '-f', 'xml', '-i', str(xml), '-o', str(der), '--raw'], check=True, timeout=60)
    if not der.is_file() or not der.stat().st_size:
        raise ValueError('derq did not produce simulated DER entitlements')
    return xml, der


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('bundle_identifier')
    arguments = parser.parse_args()
    prepare(arguments.directory, arguments.bundle_identifier)
