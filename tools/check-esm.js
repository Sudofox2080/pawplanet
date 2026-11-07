'use strict';
// 语法检查工具：把 ESM 文件复制成 .mjs 再 node --check
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const files = process.argv.slice(2);
if (!files.length) { console.error('用法: node tools/check-esm.js <file...>'); process.exit(2); }
let bad = 0;
for (const f of files) {
  const abs = path.resolve(f);
  const tmp = path.join(os.tmpdir(), 'chk-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.mjs');
  fs.copyFileSync(abs, tmp);
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  fs.unlinkSync(tmp);
  if (r.status !== 0) { bad++; console.log('SYNTAX FAIL ' + f + '\n' + (r.stderr || '').split('\n').slice(0, 6).join('\n')); }
  else console.log('ok ' + f);
}
process.exit(bad ? 1 : 0);
