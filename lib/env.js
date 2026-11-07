'use strict';
// 极简 .env 读取（零依赖）。放在项目根或 DATA_DIR 下都行，已存在的环境变量优先。
// 支持 KEY=VALUE、# 注释、值两侧引号；不做变量替换。
const fs = require('fs');
const path = require('path');

const CANDIDATES = [
  process.env.ENV_FILE,
  path.join(__dirname, '..', '.env'),
  process.env.DATA_DIR ? path.join(process.env.DATA_DIR, '.env') : null,
].filter(Boolean);

let loaded = null;
for (const file of CANDIDATES) {
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 1) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
  loaded = file;
  break;
}

module.exports = { loaded };
