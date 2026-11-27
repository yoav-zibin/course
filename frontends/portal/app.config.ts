import type { ExpoConfig } from 'expo/config';
const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || process.env.EAS_PROJECT_ID;
const googleServicesFile = process.env.BUILDPLAY_GOOGLE_SERVICES_FILE;
const iosPushEnabled = Boolean(projectId && process.env.BUILDPLAY_IOS_PUSH_ENABLED === '1');
const androidVersionCodeValue = process.env.BUILDPLAY_ANDROID_VERSION_CODE ?? '2';
const androidVersionCode = Number(androidVersionCodeValue);
if (!/^[1-9]\d*$/.test(androidVersionCodeValue) || !Number.isSafeInteger(androidVersionCode) || androidVersionCode > 2100000000) {
  throw new Error('BUILDPLAY_ANDROID_VERSION_CODE must be a positive integer no greater than 2100000000');
}
const config: ExpoConfig = {
  name: 'BuildPlay', slug: 'buildplay', version: '2.0.0', scheme: 'buildplay',
  orientation: 'default', userInterfaceStyle: 'dark', icon: './assets/icon.png',
  ios: { bundleIdentifier: process.env.IOS_PORTAL_BUNDLE_ID || 'edu.columbia.gameportal.starter', supportsTablet: true,
    associatedDomains: ['applinks:buildplay.fun'],
    buildNumber: process.env.GITHUB_RUN_NUMBER ? `${process.env.GITHUB_RUN_NUMBER}.${process.env.GITHUB_RUN_ATTEMPT || '1'}` : '1',
    infoPlist: { ITSAppUsesNonExemptEncryption: false, FIREBASE_ANALYTICS_COLLECTION_ENABLED: false,
      FirebaseAutomaticScreenReportingEnabled: false, GOOGLE_ANALYTICS_IDFV_COLLECTION_ENABLED: false,
      GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_PERSONALIZATION_SIGNALS: false } },
  android: { package: process.env.BUILDPLAY_VARIANT === 'debug' ? 'fun.buildplay.debug' : 'fun.buildplay',
    intentFilters: [{action: 'VIEW', autoVerify: true,
      category: ['BROWSABLE', 'DEFAULT'],
      data: [{scheme: 'https', host: 'buildplay.fun', pathPrefix: '/invite/'}]}],
    ...(googleServicesFile ? {googleServicesFile} : {}),
    adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: '#10141f' }, allowBackup: false, versionCode: androidVersionCode },
  web: { bundler: 'metro', output: 'single', favicon: './assets/icon.png', name: 'BuildPlay' },
  experiments: { baseUrl: '/static/app' },
  plugins: [['expo-secure-store', {configureAndroidBackup:false}], 'expo-status-bar',
    ['expo-notifications', {defaultChannel: 'matches', enableRemoteNotifications: iosPushEnabled,
      mode: process.env.BUILDPLAY_APNS_ENVIRONMENT === 'development' ? 'development' : 'production'}], './plugins/withPortalNative'],
  extra: { apiUrl: process.env.EXPO_PUBLIC_API_URL || 'https://buildplay.fun',
    ...(projectId ? {eas: {projectId}} : {}),
    nativePushConfigured: {android: Boolean(projectId && googleServicesFile), ios: iosPushEnabled}},
};
export default config;
