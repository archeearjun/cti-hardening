import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Optional recovery of the frozen Apps Script app, not the maintained app.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist-gas');
fs.mkdirSync(output, {recursive:true});
for (const file of ['Code.gs','Index.html','Tests.gs'])
  fs.copyFileSync(path.join(root,'archive/apps-script',file),path.join(output,file));
fs.writeFileSync(path.join(output,'README.txt'),
  'Frozen Apps Script reference from e236eff (2026-09-30).\n'+
  'This is not the current Cloudflare app and does not receive its future changes.\n');
console.log('Exported the frozen Apps Script snapshot to dist-gas/. Cloudflare source was not changed.');
