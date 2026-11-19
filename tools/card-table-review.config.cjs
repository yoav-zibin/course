const {defineConfig}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),venv=path.join(root,'.venv/bin/python');
const python=process.env.CARD_TABLE_PYTHON||(fs.existsSync(venv)?venv:'python3');
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
module.exports=defineConfig({testDir:__dirname,testMatch:'card-table-review.spec.ts',reporter:'list',workers:2,outputDir:process.env.CARD_TABLE_SCREENSHOTS||path.join(root,'test-results/card-tables'),use:{launchOptions:fs.existsSync(chrome)?{executablePath:chrome}:{}},projects:[{name:'desktop',use:{viewport:{width:1280,height:900}}},{name:'phone',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}],webServer:[{command:`"${python}" tools/preview_card_tables.py --port 8173`,cwd:root,url:'http://127.0.0.1:8173/',reuseExistingServer:true},{command:`"${python}" tools/preview_card_catalog.py --port 8174`,cwd:root,url:'http://127.0.0.1:8174/portal',reuseExistingServer:true}]});
