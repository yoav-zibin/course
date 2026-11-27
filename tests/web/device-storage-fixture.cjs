const fs = require('node:fs');
const path = require('node:path');

exports.source = fs.readFileSync(path.join(__dirname, '../../static/shared/device-storage.js'), 'utf8');
