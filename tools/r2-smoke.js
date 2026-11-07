'use strict';
// 冒烟测试：验证「远程素材」这条链路（URL 展开 / 反查 / /media 代理）是否通。
// 会在库里插一行临时素材，跑完删掉。用法：node tools/r2-smoke.js [key]
const db = require('../lib/db');
const M = require('../lib/media');
const S = require('../lib/storage');

const key = process.argv[2] || 'media/im_5404c14ab8cb9f8b22.jpg';

db.run(
  `INSERT OR REPLACE INTO assets (id, user_id, kind, name, file, mime, w, h, size, created_at, remote)
   VALUES ('smoke_remote', NULL, 'sticker', 'smoke', ?, 'image/jpeg', 600, 600, 228627, ?, 1)`,
  key, db.nowISO()
);

const row = db.get('SELECT * FROM assets WHERE id = ?', 'smoke_remote');
const url = S.urlFor(row);
console.log('storage.urlFor      ', url);
console.log('media.assetUrl(id)  ', M.assetUrl('smoke_remote'));
console.log('media.assetId(url)  ', M.assetId(url));
console.log('media.assetId(/media/key)', M.assetId('/media/' + key));

const base = process.env.SITE || 'http://127.0.0.1:4780';
(async () => {
  try {
    const r = await fetch(base + '/media/' + key, { redirect: 'manual' });
    console.log('/media/<key>       ', r.status, r.headers.get('location') || r.headers.get('content-type'));
  } catch (e) {
    console.log('/media/<key>        请求失败', e.message);
  }
  db.run("DELETE FROM assets WHERE id = 'smoke_remote'");
  console.log('临时素材已清理');
})();
