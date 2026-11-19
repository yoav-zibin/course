#!/usr/bin/env node
/** Add linker sections to the generated app target for Simulator SDKs only. */
const fs = require('node:fs');
const path = require('node:path');

const FLAGS = [
  '"-Xlinker"', '"-sectcreate"', '"-Xlinker"', '"__TEXT"', '"-Xlinker"', '"__entitlements"',
  '"-Xlinker"', '"$(BUILDPLAY_SIMULATOR_ENTITLEMENTS_XML)"',
  '"-Xlinker"', '"-sectcreate"', '"-Xlinker"', '"__TEXT"', '"-Xlinker"', '"__ents_der"',
  '"-Xlinker"', '"$(BUILDPLAY_SIMULATOR_ENTITLEMENTS_DER)"',
];
const unquote = value => String(value).replace(/^"|"$/g, '');
const quoted = value => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

function configureProject(project, directory) {
  const application = project.getTarget('com.apple.product-type.application');
  if (!application || unquote(application.target.name) !== 'BuildPlay') throw new Error('Expected the BuildPlay application target');
  const list = project.pbxXCConfigurationList()[application.target.buildConfigurationList];
  if (!list || !Array.isArray(list.buildConfigurations) || !list.buildConfigurations.length) throw new Error('Missing application build configurations');
  const all = project.pbxXCBuildConfigurationSection();
  const configurations = list.buildConfigurations.map(ref => all[ref.value]);
  for (const configuration of configurations) {
    if (!configuration?.buildSettings || unquote(configuration.buildSettings.PRODUCT_BUNDLE_IDENTIFIER) !== 'edu.columbia.gameportal.starter') {
      throw new Error('Simulator preparation requires the starter app identity');
    }
  }
  if (/[\r\n\0]/.test(directory)) throw new Error('Invalid generated entitlement directory');
  for (const configuration of configurations) {
    const settings = configuration.buildSettings;
    const key = '"OTHER_LDFLAGS[sdk=iphonesimulator*]"';
    const existing = settings[key] ?? settings['OTHER_LDFLAGS[sdk=iphonesimulator*]'] ?? settings.OTHER_LDFLAGS ?? ['"$(inherited)"'];
    let flags = Array.isArray(existing) ? [...existing] : [existing];
    // Repeated preparation is idempotent; preserve all original linker flags.
    if (!flags.some(value => String(value).includes('BUILDPLAY_SIMULATOR_ENTITLEMENTS_XML'))) flags.push(...FLAGS);
    settings[key] = flags;
    delete settings['OTHER_LDFLAGS[sdk=iphonesimulator*]'];
    settings['"BUILDPLAY_SIMULATOR_ENTITLEMENTS_XML[sdk=iphonesimulator*]"'] = quoted(path.join(directory, 'BuildPlay-Simulated.xcent'));
    settings['"BUILDPLAY_SIMULATOR_ENTITLEMENTS_DER[sdk=iphonesimulator*]"'] = quoted(path.join(directory, 'BuildPlay-Simulated.xcent.der'));
  }
  return configurations.length;
}

if (require.main === module) {
  const [projectPath, inputDirectory] = process.argv.slice(2);
  if (!projectPath || !inputDirectory) throw new Error('Usage: configure-ios-simulator-entitlements.js PROJECT.pbxproj DIRECTORY');
  const directory = path.resolve(inputDirectory);
  for (const file of ['BuildPlay-Simulated.xcent', 'BuildPlay-Simulated.xcent.der']) {
    if (!fs.statSync(path.join(directory, file)).isFile()) throw new Error('Prepare both simulated entitlement files first');
  }
  const project = require('xcode').project(path.resolve(projectPath));
  project.parseSync();
  const count = configureProject(project, directory);
  fs.writeFileSync(projectPath, project.writeSync());
  process.stdout.write(`Prepared simulator-only linker sections for ${count} BuildPlay configurations\n`);
}

module.exports = { configureProject };
