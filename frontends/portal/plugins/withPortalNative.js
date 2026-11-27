const fs = require('node:fs');
const path = require('node:path');
const { AndroidConfig, IOSConfig, withAndroidManifest, withAppBuildGradle, withDangerousMod, withMainApplication, withPodfile, withXcodeProject } = require('expo/config-plugins');

/** Preserve the former app's no-backup policy and permit an existing debug key. */
module.exports = function withPortalNative(config) {
  // Firebase can discover the default plist before configure() runs. Only the
  // signed-in Analytics Worklet opens this named production client resource.
  const iosClient = process.env.BUILDPLAY_IOS_GOOGLE_SERVICES_FILE;
  if (iosClient) config = withXcodeProject(config, config => {
    const root = config.modRequest.projectRoot;
    const group = IOSConfig.XcodeUtils.getProjectName(root);
    const filename = 'BuildPlayFirebase.plist';
    fs.copyFileSync(iosClient, path.join(IOSConfig.Paths.getSourceRoot(root), filename));
    const filepath = group + '/' + filename;
    if (!config.modResults.hasFile(filepath)) {
      config.modResults = IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath, groupName: group, project: config.modResults, isBuildFile: true,
      });
    }
    return config;
  });
  // FirebaseCoreInternal imports this Objective-C module from Swift when Expo
  // links pods statically. Keep other pods on the Expo template's defaults.
  config = withPodfile(config, config => {
    const pod = "pod 'GoogleUtilities', :modular_headers => true";
    if (!config.modResults.contents.includes(pod)) {
      config.modResults.contents = config.modResults.contents.replace(/^(\s*)use_expo_modules!/m, (_, indent) =>
        indent + pod + '\n' + indent + 'use_expo_modules!');
    }
    return config;
  });
  // Saves live in the app sandbox; the portal does not need shared storage or
  // permission to draw over other applications from the development template.
  config = AndroidConfig.Permissions.withBlockedPermissions(config, [
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'android.permission.SYSTEM_ALERT_WINDOW',
    'com.google.android.gms.permission.AD_ID',
    'android.permission.ACCESS_ADSERVICES_AD_ID',
    'android.permission.ACCESS_ADSERVICES_ATTRIBUTION',
  ]);
  config = withMainApplication(config, config => {
    const base = 'com.buildplay.legacyportal.PortalApplication()';
    let source = config.modResults.contents;
    if (!source.includes(base)) {
      source = source.replace(/(class MainApplication\s*:\s*)(?:android\.app\.)?Application\(\)/, '$1' + base);
      if (!source.includes(base)) throw new Error('Cannot install the Portal activity lifecycle in MainApplication.');
      config.modResults.contents = source;
    }
    return config;
  });
  config = withAndroidManifest(config, config => {
    const application = config.modResults.manifest.application?.[0];
    if (application) {
      application.$['android:allowBackup'] = 'false';
      application.$['android:fullBackupContent'] = '@xml/portal_backup_rules';
      application.$['android:dataExtractionRules'] = '@xml/portal_data_extraction_rules';
      let localHttp = false;
      try {
        const api = new URL(config.extra?.apiUrl);
        localHttp = process.env.BUILDPLAY_LOCAL_TEST === '1' && api.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]', '10.0.2.2'].includes(api.hostname);
      } catch {}
      application.$['android:usesCleartextTraffic'] = localHttp ? 'true' : 'false';
    }
    return config;
  });
  config = withDangerousMod(config, ['android', async config => {
    const directory = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'portal_backup_rules.xml'),
      '<?xml version="1.0" encoding="utf-8"?>\n<full-backup-content><exclude domain="sharedpref" path="." /></full-backup-content>\n');
    fs.writeFileSync(path.join(directory, 'portal_data_extraction_rules.xml'),
      '<?xml version="1.0" encoding="utf-8"?>\n<data-extraction-rules><cloud-backup><exclude domain="sharedpref" path="." /></cloud-backup><device-transfer><exclude domain="sharedpref" path="." /></device-transfer></data-extraction-rules>\n');
    return config;
  }]);
  return withAppBuildGradle(config, config => {
    // The Expo template's bundled development key gives reproducible future
    // debug builds. An existing installation may need its original VM key.
    if (!config.modResults.contents.includes('BUILDPLAY_ANDROID_DEBUG_KEYSTORE')) {
      config.modResults.contents = config.modResults.contents.replace(
        /storeFile file\(['"]debug\.keystore['"]\)/,
        "storeFile file(System.getenv('BUILDPLAY_ANDROID_DEBUG_KEYSTORE') ?: 'debug.keystore')"
      );
    }
    return config;
  });
};
