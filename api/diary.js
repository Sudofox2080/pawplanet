'use strict';
const { get, run, all, nowISO, normVis } = require('../lib/db');
const { bad, rid } = require('../lib/http');
const A = require('../lib/auth');
const F = require('../lib/feed');

function assetsOf(ids) {
  const out = [];
  for (const id of ids || []) {
    const a = F.assetById(String(id));
    if (!a) throw bad('bad_asset', '图片不存在：' + id);
    out.push(a.id);
  }
  return out;
}

module.exports = (r) => {
  r.get('/api/diary', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const q = ctx.query;
    const lim = Math.min(100, parseInt(q.limit, 10) || 40);
    const params = [u.id];
    let extra = '';
    if (q.month) { extra += ' AND d.date LIKE ?'; params.push(`${q.month}%`); }
    const rows = all(`SELECT * FROM diary d WHERE d.user_id = ?${extra} ORDER BY d.date DESC, d.created_at DESC LIMIT ${lim}`, ...params);
    ctx.ok({ items: rows.map(F.diaryOut), moods: ['开心', '平静', '想念', '担心', '感动', '疲惫'] });
  });

  r.post('/api/diary', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const b = await ctx.json();
    const content = String(b.content || '').slice(0, 8000);
    const title = String(b.title || '').trim().slice(0, 60) || (content.slice(0, 18) + (content.length > 18 ? '…' : '') || '无题');
    const id = rid();
    const date = b.date ? String(b.date).slice(0, 10) : nowISO().slice(0, 10);
    run(
      `INSERT INTO diary (id, user_id, pet_id, title, content, mood, date, visibility, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      id, u.id, b.petId || null, title, content, String(b.mood || '').slice(0, 12), date,
      normVis(b.visibility), nowISO(), nowISO()
    );
    const ids = assetsOf(b.assets);
    ids.forEach((aid, i) => run('INSERT OR IGNORE INTO diary_assets (diary_id, asset_id, sort) VALUES (?,?,?)', id, aid, i));
    const gained = F.bump(u.id, 'diary_write', 1);
    ctx.ok({ entry: F.diaryOut(get('SELECT * FROM diary WHERE id = ?', id)), gained });
  });

  r.patch('/api/diary/:id', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const d = get('SELECT * FROM diary WHERE id = ?', ctx.params.id);
    if (!d || d.user_id !== u.id) throw bad('not_found', '日记不存在', 404);
    const b = await ctx.json();
    const sets = [], params = [];
    if (b.title !== undefined) { sets.push('title = ?'); params.push(String(b.title).slice(0, 60)); }
    if (b.content !== undefined) { sets.push('content = ?'); params.push(String(b.content).slice(0, 8000)); }
    if (b.mood !== undefined) { sets.push('mood = ?'); params.push(String(b.mood).slice(0, 12)); }
    if (b.date !== undefined) { sets.push('date = ?'); params.push(String(b.date).slice(0, 10)); }
    if (b.visibility !== undefined) { sets.push('visibility = ?'); params.push(normVis(b.visibility)); }
    if (b.petId !== undefined) { sets.push('pet_id = ?'); params.push(b.petId || null); }
    if (sets.length) {
      sets.push('updated_at = ?'); params.push(nowISO());
      run(`UPDATE diary SET ${sets.join(', ')} WHERE id = ?`, ...params, d.id);
    }
    if (Array.isArray(b.assets)) {
      run('DELETE FROM diary_assets WHERE diary_id = ?', d.id);
      assetsOf(b.assets).forEach((aid, i) => run('INSERT OR IGNORE INTO diary_assets (diary_id, asset_id, sort) VALUES (?,?,?)', d.id, aid, i));
    }
    ctx.ok({ entry: F.diaryOut(get('SELECT * FROM diary WHERE id = ?', d.id)) });
  });

  r.delete('/api/diary/:id', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const d = get('SELECT * FROM diary WHERE id = ?', ctx.params.id);
    if (!d || d.user_id !== u.id) throw bad('not_found', '日记不存在', 404);
    run('DELETE FROM diary WHERE id = ?', d.id);
    ctx.ok({});
  });

  r.get('/api/users/:handle/diary', async (ctx) => {
    const owner = get('SELECT * FROM users WHERE handle = ?', String(ctx.params.handle).toLowerCase());
    if (!owner) throw bad('not_found', '没有这个用户', 404);
    const isSelf = !!ctx.user && ctx.user.id === owner.id;
    const isFriend = !!ctx.user && F.canView(owner.id, 'friends', ctx.user.id);
    const vis = isSelf ? "'public','friends','private'" : isFriend ? "'public','friends'" : "'public'";
    const rows = all(`SELECT * FROM diary WHERE user_id = ? AND visibility IN (${vis}) ORDER BY date DESC, created_at DESC LIMIT 60`, owner.id);
    const items = rows.map(F.diaryOut);
    const moods = [...new Set(items.map((i) => i.mood).filter(Boolean))];
    ctx.ok({ items, moods });
  });
};
