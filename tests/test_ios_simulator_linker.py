"""Simulator permissions belong in app-only linker sections, never device flags."""
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / 'frontends/portal/scripts'
spec = importlib.util.spec_from_file_location('prepare_simulator', SCRIPTS / 'prepare-ios-simulator-entitlements.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


def test_xml_and_der_are_generated_from_one_private_simulator_identity(tmp_path):
    calls = []
    def run(arguments, **options):
        calls.append((arguments, options))
        assert plistlib.loads(Path(arguments[arguments.index('-i') + 1]).read_bytes()) == {
            'application-identifier': 'TESTTEAM00.edu.columbia.gameportal.starter',
            'keychain-access-groups': ['TESTTEAM00.edu.columbia.gameportal.starter'],
        }
        Path(arguments[arguments.index('-o') + 1]).write_bytes(b'der')
    xml, der = prepare.prepare(tmp_path / 'path with spaces', 'edu.columbia.gameportal.starter', run=run)
    assert xml.is_file() and der.read_bytes() == b'der'
    assert calls[0][0][:4] == ['/usr/bin/derq', 'query', '-f', 'xml']
    assert calls[0][0][-1] == '--raw'
    assert calls[0][1] == {'check': True, 'timeout': 60}


def test_unresolved_identity_cannot_generate_entitlements(tmp_path):
    with pytest.raises(ValueError, match='resolved simulator'):
        prepare.prepare(tmp_path / 'unused', '$(PRODUCT_BUNDLE_IDENTIFIER)', run=lambda *a, **kw: pytest.fail('must not execute'))
    assert not (tmp_path / 'unused').exists()


def test_project_change_is_app_target_simulator_only_and_idempotent():
    javascript = r'''
const {configureProject}=require(process.env.CONFIGURE_SCRIPT);
const configurations={
 appDebug:{buildSettings:{PRODUCT_BUNDLE_IDENTIFIER:'"edu.columbia.gameportal.starter"',OTHER_LDFLAGS:['"$(inherited)"','"-ObjC"']}},
 appRelease:{buildSettings:{PRODUCT_BUNDLE_IDENTIFIER:'"edu.columbia.gameportal.starter"',OTHER_LDFLAGS:['"$(inherited)"','"-lc++"']}},
 project:{buildSettings:{OTHER_LDFLAGS:['"project-flag"']}},
 pods:{buildSettings:{PRODUCT_BUNDLE_IDENTIFIER:'"org.cocoapods.Expo"',OTHER_LDFLAGS:['"pod-flag"']}}
};
const original=JSON.parse(JSON.stringify(configurations));
const project={getTarget:()=>({target:{name:'BuildPlay',buildConfigurationList:'application'}}),
 pbxXCConfigurationList:()=>({application:{buildConfigurations:[{value:'appDebug'},{value:'appRelease'}]}}),
 pbxXCBuildConfigurationSection:()=>configurations};
configureProject(project,'/tmp/derived files');
const once=JSON.stringify(configurations);
configureProject(project,'/tmp/derived files');
if(JSON.stringify(configurations)!==once)throw Error('not idempotent');
process.stdout.write(JSON.stringify({original,configurations}));
'''
    result = subprocess.run(['node', '-e', javascript], env={**os.environ, 'CONFIGURE_SCRIPT': str(SCRIPTS / 'configure-ios-simulator-entitlements.js')}, capture_output=True, text=True, check=True)
    data = json.loads(result.stdout)
    old, new = data['original'], data['configurations']
    assert new['pods'] == old['pods'] and new['project'] == old['project']
    for name in ['appDebug', 'appRelease']:
        before, after = old[name]['buildSettings'], new[name]['buildSettings']
        assert all(after[key] == value for key, value in before.items())
        added = set(after) - set(before)
        assert len(added) == 3 and all('[sdk=iphonesimulator*]' in key for key in added)
        flags = after['"OTHER_LDFLAGS[sdk=iphonesimulator*]"']
        assert flags[:len(before['OTHER_LDFLAGS'])] == before['OTHER_LDFLAGS']
        assert flags.count('"__entitlements"') == 1 and flags.count('"__ents_der"') == 1
        assert any('derived files' in str(value) for value in after.values())
