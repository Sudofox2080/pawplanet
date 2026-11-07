'use strict';
const { get, run, all } = require('../lib/db');
const { bad } = require('../lib/http');
const A = require('../lib/auth');
const F = require('../lib/feed');
const { saveUpload } = require('../lib/upload');
const Storage = require('../lib/storage');

module.exports = (r) => {
  r.post('/api/upload', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const { fields, files } = await ctx.form();
    const kind = String(fields.kind || 'photo');
    if (!['photo', 'avatar', 'cover', 'sticker', 'frame'].includes(kind)) throw bad('bad_kind', '未知的上传类型');
    const asset = await saveUpload(files.file, { userId: u.id, kind });
    const gained = kind === 'photo' ? F.bump(u.id, 'photo_upload', 1) : [];
    ctx.ok({ asset, gained });
  });

  r.get('/api/assets', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const kinds = String(ctx.query.kind || 'sticker,frame').split(',').filter(Boolean);
    const placeholders = kinds.map(() => '?').join(',');
    const rows = all(
      `SELECT * FROM assets WHERE user_id = ? AND kind IN (${placeholders}) ORDER BY created_at DESC LIMIT 200`,
      u.id, ...kinds
    );
    ctx.ok({ items: rows.map(F.assetOut) });
  });

  r.patch('/api/assets/:id', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const a = get('SELECT * FROM assets WHERE id = ?', ctx.params.id);
    if (!a || a.user_id !== u.id) throw bad('not_found', '素材不存在', 404);
    const b = await ctx.json();
    if (b.name != null) run('UPDATE assets SET name = ? WHERE id = ?', String(b.name).slice(0, 60), a.id);
    ctx.ok({ asset: F.assetOut(get('SELECT * FROM assets WHERE id = ?', a.id)) });
  });

  // 删除素材：同时把引用它的合成布局里的图层/相框摘掉，
  // 这样已发布的帖子不会出现「贴纸位置还在、图却打不开」的半坏状态。
  r.delete('/api/assets/:id', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const a = get('SELECT * FROM assets WHERE id = ?', ctx.params.id);
    if (!a || a.user_id !== u.id) throw bad('not_found', '素材不存在', 404);
    let cleaned = 0;
    const rows = all("SELECT * FROM post_assets WHERE layout LIKE ?", '%' + a.id + '%');
    for (const row of rows) {
      let layout = {};
      try { layout = JSON.parse(row.layout || '{}'); } catch (_) { layout = {}; }
      let touched = false;
      if (layout.frame && layout.frame.assetId === a.id) { layout.frame = { assetId: null, style: 'none' }; touched = true; }
      if (Array.isArray(layout.layers)) {
        const before = layout.layers.length;
        layout.layers = layout.layers.filter((l) => l && l.assetId !== a.id);
        if (layout.layers.length !== before) touched = true;
      }
      if (touched) {
        run('UPDATE post_assets SET layout = ? WHERE post_id = ? AND asset_id = ?',
          JSON.stringify(layout), row.post_id, row.asset_id);
        cleaned += 1;
      }
    }
    // 引用关系本身也一并解除，避免帖子仍挂着一个已经消失的素材行
    run('DELETE FROM post_assets WHERE asset_id = ?', a.id);
    run('DELETE FROM assets WHERE id = ?', a.id);
    // 对象存储里的文件也要删掉，否则 R2 会一直囤着没人引用的图
    if (a.remote) await Storage.del(a.file);
    else {
      const fs = require('fs');
      const path = require('path');
      const { UPLOAD_DIR } = require('../lib/db');
      try { fs.unlinkSync(path.join(UPLOAD_DIR, a.file)); } catch (_) {}
    }
    ctx.ok({ cleaned });
  });
};
