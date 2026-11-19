#!/usr/bin/env node
// react-native-svg's Android mCTM order differs from the drawing Canvas for
// nested transforms. Keep this workaround limited to accessibility rectangles.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const portal=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const patch=JSON.parse(readFileSync(path.join(portal,'patches/react-native-svg-15.16.0-accessibility.json'),'utf8'));
const sha256=source=>createHash('sha256').update(source).digest('hex');

export function applyAccessibilityPatch(packageRoot=path.join(portal,'node_modules/react-native-svg')) {
  const metadata=JSON.parse(readFileSync(path.join(packageRoot,'package.json'),'utf8'));
  if(metadata.name!==patch.package||metadata.version!==patch.version)throw new Error('Review the SVG accessibility patch before changing react-native-svg version');
  const pending=[];
  for(const file of patch.files){
    const target=path.join(packageRoot,file.path),source=readFileSync(target,'utf8'),hash=sha256(source);
    if(hash===file.after_sha256)continue;
    if(hash!==file.before_sha256)throw new Error(`Unrecognized react-native-svg source: ${file.path}; review accessibility patch`);
    let changed=source;
    for(const replacement of file.replacements){
      if(changed.split(replacement.before).length!==2)throw new Error(`SVG patch context is ambiguous: ${file.path}`);
      changed=changed.replace(replacement.before,replacement.after);
    }
    if(sha256(changed)!==file.after_sha256)throw new Error(`SVG patch output mismatch: ${file.path}`);
    pending.push([target,changed]);
  }
  // Validate every source before writing any file, so dependency drift fails
  // closed without leaving a partially patched installation.
  for(const [target,changed] of pending)writeFileSync(target,changed);
  return pending.length;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const count=applyAccessibilityPatch(process.argv[2]);
  console.log(`react-native-svg ${patch.version}: accessibility-only Canvas bounds patch ready (${count} files updated)`);
}
