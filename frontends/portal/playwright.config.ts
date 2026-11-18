import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root=path.resolve(__dirname,'../..');
const localPython=path.join(root,'.venv/bin/python');
const python=process.env.E2E_PYTHON||(existsSync(localPython)?localPython:'python3');

export default defineConfig({
  testDir:path.join(__dirname,'e2e'), fullyParallel:true, timeout:45000, retries:process.env.CI?1:0,
  reporter:process.env.CI?[['github'],['html',{outputFolder:path.join(root,'playwright-report'),open:'never'}]]:'list',
  use:{baseURL:process.env.PORTAL_E2E_URL||'http://127.0.0.1:8128',trace:'retain-on-failure'},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 7']}}],
  webServer:process.env.PORTAL_E2E_URL?undefined:{command:`"${python}" "${path.join(root,'e2e/start-server.py')}"`,url:'http://127.0.0.1:8128/health',reuseExistingServer:!process.env.CI,env:{E2E_PORT:'8128'}},
});
