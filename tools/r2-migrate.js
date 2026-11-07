'use strict';
// 把已有的本地图片搬到 R2（迁移历史数据）。默认 dry-run。
// 用法：node tools/r2-migrate.js [--apply] [--delete-local]（DATA_DIR 默认 ./data）
require('../lib/env');
const fs = require('fs');
const path = require('path');
const dbm = require('../lib/db');
const S = require('../lib/storage');
const R2 = require('../lib/r2');

const { get, all, run, UPLOAD_DIR } = dbm;
const apply = process.argv.includes('--apply');
const deleteLocal = process.argv.includes('--delete-local');

const EXT_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm',
};

(async () => {
  if (!S.ready()) {
    console.error('R2 没配好：需要 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET');
    process.exit(1);
  }
  const rows = all('SELECT * FROM assets WHERE remote = 0 OR remote IS NULL ORDER BY created_at');
  console.log(`待迁移素材 ${rows.length} 个（本地目录 ${UPLOAD_DIR}）`);
  if (!rows.length) return;

  let ok = 0;
  let skip = 0;
  let fail = 0;
  for (const a of rows) {
    const local = path.join(UPLOAD_DIR, a.file);
    if (!fs.existsSync(local)) {
      console.log('  跳过（本地文件不存在）', a.id, a.file);
      skip++;
      continue;
    }
    const ext = (path.extname(a.file).slice(1) || 'jpg').toLowerCase();
    const mime = a.mime || EXT_MIME[ext] || 'application/octet-stream';
    const owner = a.user_id ? get('SELECT handle FROM users WHERE id = ?', a.user_id) : null;
    const key = S.keyFor({ kind: a.kind, handle: owner && owner.handle, id: a.id, ext });
    const size = fs.statSync(local).size;

    if (!apply) {
      console.log(`  [dry] ${a.kind.padEnd(7)} ${a.file} → ${key} (${size} B)`);
      ok++;
      continue;
    }
    try {
      const buf = fs.readFileSync(local);
      await S.put(key, buf, mime);
      const pub = S.publicUrl(key);
      if (pub) {
        const head = await fetch(pub, { method: 'HEAD' });
        if (!head.ok) throw new Error(`公开地址不可访问 ${head.status}`);
      }
      run('UPDATE assets SET file = ?, remote = 1 WHERE id = ?', key, a.id);
      if (deleteLocal) { try { fs.unlinkSync(local); } catch (_) {} }
      console.log('  ✓', a.kind, a.file, '→', key, pub || '(无公开域名)');
      ok++;
    } catch (e) {
      console.error('  ✗', a.file, e.message);
      fail++;
    }
  }
  console.log(`\n${apply ? '迁移完成' : 'dry-run'}：成功 ${ok} / 跳过 ${skip} / 失败 ${fail}`);
  if (!apply) console.log('确认后加 --apply 真跑；加 --delete-local 会顺手删掉本地副本。');
  if (R2.cfg().publicBase) console.log('公开域名：', R2.cfg().publicBase);
})();
