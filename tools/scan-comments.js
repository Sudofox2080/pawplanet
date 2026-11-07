'use strict';
// 扫描 Kotlin/Java 源码里的块注释配平，定位未闭合的 /* 起始行
const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('用法: node tools/scan-comments.js <file>');
  process.exit(2);
}
const t = fs.readFileSync(file, 'utf8');
let depth = 0;
let line = 1;
const opens = [];
let quote = null;
const raw = process.argv.includes('--raw');

for (let i = 0; i < t.length; i++) {
  const c = t[i];
  const n = t[i + 1];
  if (c === '\n') line++;
  if (quote) {
    if (c === '\\') { i++; continue; }
    if (c === quote) quote = null;
    continue;
  }
  if (c === '"' || c === "'") { quote = c; continue; }
  if (!raw && c === '/' && n === '/') {
    while (i < t.length && t[i] !== '\n') i++;
    line++;
    continue;
  }
  if (c === '/' && n === '*') {
    if (depth === 0) opens.push(line);
    depth++;
    i++;
    continue;
  }
  if (c === '*' && n === '/') {
    depth--;
    i++;
    continue;
  }
}
console.log('depth=' + depth);
console.log('未闭合起点: ' + (opens.join(', ') || '无'));
