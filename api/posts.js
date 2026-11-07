'use strict';
const { get, run, all, nowISO, normVis } = require('../lib/db');
const { bad, rid } = require('../lib/http');
const A = require('../lib/auth');
const F = require('../lib/feed');

function savePostAssets(postId, list) {
  let i = 0;
  for (const it of list || []) {
    const id = String(typeof it === 'string' ? it : it.id);
    const a = F.assetById(id);
    if (!a) throw bad('bad_asset', '图片不存在：' + id);
    const layout = JSON.stringify((typeof it === 'object' && it.layout) || {});
    // 同一张图重复提交时（比如只改了布局），要把 layout 覆盖成最新的
    run(
      `INSERT INTO post_assets (post_id, asset_id, sort, layout) VALUES (?,?,?,?)
       ON CONFLICT(post_id, asset_id) DO UPDATE SET sort = excluded.sort, layout = excluded.layout`,
      postId, id, i, layout
    );
    i++;
  }
  return i;
}

module.exports = (r) => {
  r.get('/api/feed', async (ctx) => {
    const q = ctx.query;
    const tab = ['all', 'friends', 'mine', 'like'].includes(q.tab) ? q.tab : 'all';
    if ((tab === 'friends' || tab === 'mine' || tab === 'like') && !ctx.user) throw bad('unauthorized', '请先登录', 401);
    ctx.ok(F.listFeed({
      viewer: ctx.user, tab, petId: q.petId || null,
      cursor: q.cursor || null, limit: q.limit,
    }));
  });

  r.get('/api/hot', async (ctx) => {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const rows = all(
      `SELECT p.*, (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) * 3
        + (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) * 2 AS heat
       FROM posts p
       WHERE p.created_at >= ? AND p.repost_of IS NULL
         AND (p.visibility = 'public' OR p.user_id = ?)
       ORDER BY heat DESC, p.created_at DESC LIMIT 12`,
      since, ctx.user ? ctx.user.id : ''
    );
    const tags = all(`SELECT SUBSTR(body, 1, 0) AS x FROM posts LIMIT 1`); // 占位，标签由前端归纳
    void tags;
    ctx.ok({ items: rows.map((x) => F.postOut(x, ctx.user ? ctx.user.id : null)) });
  });

  r.post('/api/posts', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const b = await ctx.json();
    const id = rid();
    const created = nowISO();
    run(
      `INSERT INTO posts (id, user_id, pet_id, body, visibility, source_type, source_id, repost_of, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,NULL,?,?)`,
      id, u.id, b.petId || null, String(b.body || '').slice(0, 2000), normVis(b.visibility),
      b.sourceType ? String(b.sourceType) : null, b.sourceId ? String(b.sourceId) : null, created, created
    );
    const n = savePostAssets(id, b.assets);
    if (!n && !String(b.body || '').trim()) throw bad('empty_post', '至少写点什么或者放张图');
    let gained = F.bump(u.id, 'post_create', 1);
    if (n) gained = gained.concat(F.bump(u.id, 'photo_upload', Math.min(n, 3)));
    const hasLayers = (b.assets || []).some((a) => a && a.layout && ((a.layout.layers || []).length || (a.layout.frame && a.layout.frame.style && a.layout.frame.style !== 'none')));
    if (hasLayers) gained = gained.concat(F.bump(u.id, 'sticker_use', 1));
    ctx.ok({ post: F.postOut(get('SELECT * FROM posts WHERE id = ?', id), u.id), gained });
  });

  r.get('/api/posts/:id', async (ctx) => {
    const p = get('SELECT * FROM posts WHERE id = ?', ctx.params.id);
    if (!p) throw bad('not_found', '动态不存在', 404);
    if (!F.canView(p.user_id, p.visibility, ctx.user && ctx.user.id)) throw bad('forbidden', '没有权限看这条', 403);
    const post = F.postOut(p, ctx.user ? ctx.user.id : null);
    const comments = all(
      `SELECT c.*, u.handle, u.display, u.avatar, u.level FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? ORDER BY c.created_at ASC`, p.id
    ).map((c) => ({
      id: c.id, body: c.body, parentId: c.parent_id, createdAt: c.created_at,
      canDelete: !!ctx.user && (ctx.user.id === c.user_id || ctx.user.id === p.user_id),
      user: { id: c.user_id, handle: c.handle, display: c.display, avatar: c.avatar, level: c.level },
    }));
    ctx.ok({ post, comments });
  });

  r.patch('/api/posts/:id', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const p = get('SELECT * FROM posts WHERE id = ?', ctx.params.id);
    if (!p || p.user_id !== u.id) throw bad('not_found', '动态不存在', 404);
    const b = await ctx.json();
    const sets = [], params = [];
    if (b.body !== undefined) { sets.push('body = ?'); params.push(String(b.body).slice(0, 2000)); }
    if (b.visibility !== undefined) { sets.push('visibility = ?'); params.push(normVis(b.visibility)); }
    if (b.petId !== undefined) { sets.push('pet_id = ?'); params.push(b.petId || null); }
    sets.push('updated_at = ?'); params.push(nowISO());
    run(`UPDATE posts SET ${sets.join(', ')} WHERE id = ?`, ...params, p.id);
    // 允许改配图与合成布局：传了 assets 就整体替换，避免残留旧图层
    if (Array.isArray(b.assets)) {
      run('DELETE FROM post_assets WHERE post_id = ?', p.id);
      savePostAssets(p.id, b.assets);
    }
    ctx.ok({ post: F.postOut(get('SELECT * FROM posts WHERE id = ?', p.id), u.id) });
  });

  r.delete('/api/posts/:id', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const p = get('SELECT * FROM posts WHERE id = ?', ctx.params.id);
    if (!p || p.user_id !== u.id) throw bad('not_found', '动态不存在', 404);
    run('DELETE FROM posts WHERE id = ?', p.id);
    ctx.ok({});
  });

  r.post('/api/posts/:id/like', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const p = get('SELECT * FROM posts WHERE id = ?', ctx.params.id);
    if (!p) throw bad('not_found', '动态不存在', 404);
    if (!F.canView(p.user_id, p.visibility, u.id)) throw bad('forbidden', '没有权限', 403);
    const has = get('SELECT 1 AS x FROM likes WHERE post_id = ? AND user_id = ?', p.id, u.id);
    if (has) run('DELETE FROM likes WHERE post_id = ? AND user_id = ?', p.id, u.id);
    else {
      run('INSERT INTO likes (post_id, user_id, created_at) VALUES (?,?,?)', p.id, u.id, nowISO());
      F.notify(p.user_id, u.id, 'like', p.id, `${u.display} 赞了你的动态`);
      F.bump(u.id, 'like_give', 1);
    }
    const likes = get('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?', p.id).n;
    ctx.ok({ liked: !has, likes });
  });

  r.get('/api/posts/:id/comments', async (ctx) => {
    const p = get('SELECT * FROM posts WHERE id = ?', ctx.params.id);
    if (!p) throw bad('not_found', '动态不存在', 404);
    const rows = all(
      `SELECT c.*, u.handle, u.display, u.avatar, u.level FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? ORDER BY c.created_at ASC`, p.id
    );
    ctx.ok({
      items: rows.map((c) => ({
        id: c.id, body: c.body, parentId: c.parent_id, createdAt: c.created_at,
        canDelete: !!ctx.user && (ctx.user.id === c.user_id || ctx.user.id === p.user_id),
        user: { id: c.user_id, handle: c.handle, display: c.display, avatar: c.avatar, level: c.level },
      })),
    });
  });

  r.post('/api/posts/:id/comments', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const p = get('SELECT * FROM posts WHERE id = ?', ctx.params.id);
    if (!p) throw bad('not_found', '动态不存在', 404);
    if (!F.canView(p.user_id, p.visibility, u.id)) throw bad('forbidden', '没有权限', 403);
    const b = await ctx.json();
    const body = String(b.body || '').trim().slice(0, 500);
    if (!body) throw bad('empty_comment', '说点什么吧');
    const id = rid();
    run('INSERT INTO comments (id, post_id, user_id, parent_id, body, created_at) VALUES (?,?,?,?,?,?)',
      id, p.id, u.id, b.parentId || null, body, nowISO());
    F.notify(p.user_id, u.id, 'comment', p.id, `${u.display} 评论了你的动态`);
    if (b.parentId) {
      const parent = get('SELECT * FROM comments WHERE id = ?', b.parentId);
      if (parent) F.notify(parent.user_id, u.id, 'reply', p.id, `${u.display} 回复了你`);
    }
    const gained = F.bump(u.id, 'comment_give', 1);
    ctx.ok({ id, gained });
  });

  r.delete('/api/comments/:id', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const c = get('SELECT * FROM comments WHERE id = ?', ctx.params.id);
    if (!c) throw bad('not_found', '评论不存在', 404);
    const p = get('SELECT * FROM posts WHERE id = ?', c.post_id);
    if (c.user_id !== u.id && (!p || p.user_id !== u.id)) throw bad('forbidden', '没有权限', 403);
    run('DELETE FROM comments WHERE id = ?', c.id);
    ctx.ok({});
  });

  r.post('/api/posts/:id/repost', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const src = get('SELECT * FROM posts WHERE id = ?', ctx.params.id);
    if (!src) throw bad('not_found', '动态不存在', 404);
    if (!F.canView(src.user_id, src.visibility, u.id)) throw bad('forbidden', '没有权限', 403);
    if (get('SELECT 1 AS x FROM posts WHERE repost_of = ? AND user_id = ?', src.id, u.id)) throw bad('already', '你已经转发过了', 409);
    const b = await ctx.json();
    const id = rid();
    const created = nowISO();
    run(
      `INSERT INTO posts (id, user_id, pet_id, body, visibility, source_type, source_id, repost_of, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      id, u.id, null, String(b.body || '').slice(0, 500), normVis(b.visibility || 'public'),
      'post', src.id, src.id, created, created
    );
    F.notify(src.user_id, u.id, 'repost', id, `${u.display} 转发了你的动态`);
    F.bump(u.id, 'repost_give', 1);
    ctx.ok({ post: F.postOut(get('SELECT * FROM posts WHERE id = ?', id), u.id) });
  });
};
