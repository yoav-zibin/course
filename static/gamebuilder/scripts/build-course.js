const fs = require('node:fs');
const path = require('node:path');
require('./build.js');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const script = p => read(p).replace(/<\/script/gi, '<\\/script');
const page = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Game Builder</title>' +
  '<link rel="stylesheet" href="/static/common.css?v=2">' +
  '<script src="/static/common.js"></script><script src="/static/auth.js"></script>' +
  '<script>window.__gbCloud=true;\n' + script('src/course-package.js') + '\n' +
  script('src/course-cloud.js') + '</script></head><body>' + read('dist/gamebuilder.html') +
  '</body></html>';
fs.writeFileSync(path.join(root, '..', 'builder.html'), page);
// Keep old preview/bookmark links working through the same existing entry point.
fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Game Builder</title><meta http-equiv="refresh" content="0;url=/builder"></head><body><a href="/builder">Open Game Builder</a></body></html>');
console.log('Built static/builder.html and the legacy preview redirect');
