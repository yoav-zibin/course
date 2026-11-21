import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// The web-build job installs the Portal's dependencies, including esbuild.
const {build}=createRequire(path.join(root,'frontends/portal/package.json'))('esbuild');
await build({entryPoints:[path.join(root,'tools/site-bug-capture-entry.ts')],outfile:path.join(root,'static/app/site-bug-capture.js'),
  bundle:true,minify:true,format:'iife',platform:'browser',target:['es2022']});
