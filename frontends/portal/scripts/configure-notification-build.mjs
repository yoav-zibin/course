import {mkdirSync, writeFileSync, appendFileSync} from 'node:fs';
import path from 'node:path';

// Optional CI credentials: ordinary standalone/simulator builds remain possible
// before an Expo project and platform delivery credentials have been configured.
const raw = process.env.BUILDPLAY_ANDROID_GOOGLE_SERVICES_JSON;
if (raw) {
  let config;
  try {config = JSON.parse(raw);} catch {throw new Error('Android notification config must be valid JSON.');}
  const appId = process.env.BUILDPLAY_VARIANT === 'debug' ? 'fun.buildplay.debug' : 'fun.buildplay';
  if (!config?.project_info?.project_number || !Array.isArray(config.client) || !config.client.some(client => client.client_info?.android_client_info?.package_name === appId)) {
    throw new Error(`Android notification config must contain a Firebase client for ${appId}.`);
  }
  if (!process.env.RUNNER_TEMP || !process.env.GITHUB_ENV) throw new Error('CI credential output paths are missing.');
  const directory = path.join(process.env.RUNNER_TEMP, 'buildplay-notifications');
  mkdirSync(directory, {recursive: true, mode: 0o700});
  const filename = path.join(directory, 'google-services.json');
  writeFileSync(filename, JSON.stringify(config), {mode: 0o600});
  appendFileSync(process.env.GITHUB_ENV, `BUILDPLAY_GOOGLE_SERVICES_FILE=${filename}\n`);
}
