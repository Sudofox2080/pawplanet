'use strict';
// 检查 index.html 里引用的 css / js 是否都存在
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((u) => /\.(css|js)$/.test(u) && !/^https?:/.test(u));
let bad = 0;
for (const ref of refs) {
  const p = path.join(root, ref.replace(/^\//, '').split('?')[0]);
  const ok = fs.existsSync(p);
  if (!ok) bad++;
  console.log((ok ? 'OK      ' : 'MISSING ') + ref);
}
// views 里被 import 的模块
const views = path.join(root, 'views');
for (const f of fs.readdirSync(views).filter((x) => x.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(views, f), 'utf8');
  for (const m of src.matchAll(/from '(\.\.?\/[^']+)'/g)) {
    const p = path.resolve(views, m[1]);
    if (!fs.existsSync(p)) { console.log('MISSING import ' + m[1] + ' in views/' + f); bad++; }
  }
}
// router 指向的视图
const router = fs.readFileSync(path.join(root, 'router.js'), 'utf8');
for (const m of router.matchAll(/view: '([a-z_]+)'/g)) {
  const p = path.join(views, m[1] + '.js');
  if (!fs.existsSync(p)) { console.log('MISSING view ' + m[1]); bad++; }
}
console.log(bad ? bad + ' 个缺失' : '全部存在');
