import type { ExpoConfig } from 'expo/config';
const config: ExpoConfig = {
  name: 'BuildPlay', slug: 'buildplay', version: '2.0.0', scheme: 'buildplay',
  orientation: 'default', userInterfaceStyle: 'dark', icon: './assets/icon.png',
  ios: { bundleIdentifier: process.env.IOS_PORTAL_BUNDLE_ID || 'edu.columbia.gameportal.starter', supportsTablet: true,
    buildNumber: process.env.GITHUB_RUN_NUMBER ? `${process.env.GITHUB_RUN_NUMBER}.${process.env.GITHUB_RUN_ATTEMPT || '1'}` : '1',
    infoPlist: { ITSAppUsesNonExemptEncryption: false } },
  android: { package: process.env.BUILDPLAY_VARIANT === 'debug' ? 'com.dapillah.gameportal.debug' : 'com.dapillah.gameportal',
    adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: '#10141f' }, allowBackup: false, versionCode: 2 },
  web: { bundler: 'metro', output: 'single', favicon: './assets/icon.png', name: 'BuildPlay' },
  experiments: { baseUrl: '/static/app' },
  plugins: [['expo-secure-store', {configureAndroidBackup:false}], 'expo-status-bar', './plugins/withPortalNative'],
  extra: { apiUrl: process.env.EXPO_PUBLIC_API_URL || 'https://buildplay.fun' },
};
export default config;
