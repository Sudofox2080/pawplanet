'use strict';
const { get, run, nowISO, levelInfo, all } = require('../lib/db');
const { bad, rid } = require('../lib/http');
const A = require('../lib/auth');
const F = require('../lib/feed');
const M = require('../lib/media');

const avatarOK = (id) => {
  if (!id) return null;
  const aid = M.assetId(id);
  const a = aid ? F.assetById(aid) : null;
  if (!a || !['avatar', 'cover', 'photo', 'sticker'].includes(a.kind)) throw bad('bad_asset', '图片不存在');
  return aid;
};

module.exports = (r) => {
  r.post('/api/auth/register', async (ctx) => {
    const { handle, password, display } = await ctx.json();
    const h = String(handle || '').trim().toLowerCase();
    if (!A.HANDLE_RE.test(h)) throw bad('bad_handle', '用户名需 3-20 位，只能是字母、数字、下划线');
    if (String(password || '').length < 6) throw bad('bad_password', '密码至少 6 位');
    if (get('SELECT 1 AS x FROM users WHERE handle = ?', h)) throw bad('handle_taken', '这个用户名已经被占了', 409);
    const id = rid();
    run(
      'INSERT INTO users (id, handle, display, bio, password, xp, level, created_at) VALUES (?,?,?,?,?,?,?,?)',
      id, h, String(display || handle || h).slice(0, 24) || h, '', A.hashPassword(password), 0, 1, nowISO()
    );
    A.createSession(ctx.res, id, ctx.req.headers['user-agent']);
    const u = get('SELECT * FROM users WHERE id = ?', id);
    ctx.ok({ user: A.publicUser(u, { level: levelInfo(u.xp) }) });
  });

  r.post('/api/auth/login', async (ctx) => {
    const { handle, password } = await ctx.json();
    const wait = A.lockedFor(ctx.ip);
    if (wait > 0) throw bad('rate_limited', `尝试太频繁，${Math.ceil(wait / 60000)} 分钟后再试`, 429);
    const u = get('SELECT * FROM users WHERE handle = ?', String(handle || '').trim().toLowerCase());
    if (!u || !A.verifyPassword(password, u.password)) {
      A.noteFail(ctx.ip);
      throw bad('bad_credentials', '用户名或密码不对', 401);
    }
    A.noteSuccess(ctx.ip);
    A.createSession(ctx.res, u.id, ctx.req.headers['user-agent']);
    ctx.ok({ user: A.publicUser(u) });
  });

  r.post('/api/auth/logout', async (ctx) => {
    A.destroySession(ctx.req, ctx.res);
    ctx.ok({});
  });

  r.get('/api/auth/me', async (ctx) => {
    if (!ctx.user) return ctx.ok({ user: null });
    const u = ctx.user;
    const unread = get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', u.id).n;
    const tasks = F.tasksFor(u.id);
    ctx.ok({
      user: A.publicUser(u, { stats: F.userStats(u.id) }),
      level: levelInfo(u.xp),
      tasksDone: tasks.filter((t) => t.done).length,
      tasksTotal: tasks.length,
      notificationsUnread: unread,
    });
  });

  r.get('/api/me', async (ctx) => {
    const u = A.requireUser(ctx.user);
    ctx.ok({ user: A.publicUser(u, { stats: F.userStats(u.id) }), level: levelInfo(u.xp) });
  });

  r.patch('/api/me', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const b = await ctx.json();
    const sets = [];
    const params = [];
    if (b.display !== undefined) {
      const d = String(b.display).trim().slice(0, 24);
      if (!d) throw bad('bad_display', '昵称不能为空');
      sets.push('display = ?'); params.push(d);
    }
    if (b.bio !== undefined) { sets.push('bio = ?'); params.push(String(b.bio).slice(0, 300)); }
    if (b.avatar !== undefined) { sets.push('avatar = ?'); params.push(avatarOK(b.avatar)); }
    if (b.cover !== undefined) { sets.push('cover = ?'); params.push(avatarOK(b.cover)); }
    if (!sets.length) throw bad('nothing', '没有要更新的字段');
    run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...params, u.id);
    const fresh = get('SELECT * FROM users WHERE id = ?', u.id);
    if (fresh.avatar && fresh.bio) F.bump(u.id, 'profile_complete', 1);
    ctx.ok({ user: A.publicUser(fresh, { stats: F.userStats(u.id) }) });
  });

  r.post('/api/me/password', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const { old, next } = await ctx.json();
    if (!A.verifyPassword(old, u.password)) throw bad('bad_credentials', '原密码不对', 401);
    if (String(next || '').length < 6) throw bad('bad_password', '新密码至少 6 位');
    run('UPDATE users SET password = ? WHERE id = ?', A.hashPassword(next), u.id);
    run('DELETE FROM sessions WHERE user_id = ?', u.id);
    A.createSession(ctx.res, u.id, ctx.req.headers['user-agent']);
    ctx.ok({});
  });

  // 用户主页
  r.get('/api/users/:handle', async (ctx) => {
    const u = get('SELECT * FROM users WHERE handle = ?', String(ctx.params.handle).toLowerCase());
    if (!u) throw bad('not_found', '没有这个用户', 404);
    const isSelf = !!ctx.user && ctx.user.id === u.id;
    const rel = { isSelf, isFriend: false, outgoing: false, incoming: false, blocked: false };
    if (ctx.user && !isSelf) {
      const [a, b] = ctx.user.id < u.id ? [ctx.user.id, u.id] : [u.id, ctx.user.id];
      const f = get('SELECT * FROM friendships WHERE a_id = ? AND b_id = ?', a, b);
      if (f) {
        if (f.status === 'accepted') rel.isFriend = true;
        else if (f.status === 'blocked') rel.blocked = true;
        else if (f.requester_id === ctx.user.id) rel.outgoing = true;
        else rel.incoming = true;
      }
    }
    const pets = all('SELECT * FROM pets WHERE user_id = ? ORDER BY created_at ASC', u.id).map((p) => ({
      id: p.id, name: p.name, species: p.species, breed: p.breed, gender: p.gender,
      birthday: p.birthday, avatar: M.assetUrl(p.avatar), avatarId: p.avatar,
      cover: M.assetUrl(p.cover), coverId: p.cover, bio: p.bio, createdAt: p.created_at,
    }));
    ctx.ok({
      user: A.publicUser(u, { stats: F.userStats(u.id) }),
      level: levelInfo(u.xp),
      pets,
      authenticated: !!ctx.user,
      relation: rel,
      counts: {
        posts: get(
          `SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND visibility IN (${
            rel.isSelf ? "'public','friends','private'" : rel.isFriend ? "'public','friends'" : "'public'"
          })`, u.id
        ).n,
      },
    });
  });

  r.get('/api/users/:handle/posts', async (ctx) => {
    const u = get('SELECT id FROM users WHERE handle = ?', String(ctx.params.handle).toLowerCase());
    if (!u) throw bad('not_found', '没有这个用户', 404);
    const q = ctx.query;
    const data = F.listFeed({
      viewer: ctx.user, handleUser: u.id, tab: 'all',
      petId: q.petId || null, cursor: q.cursor || null, limit: q.limit,
    });
    ctx.ok(data);
  });

  r.get('/api/search', async (ctx) => {
    const q = String(ctx.query.q || '').trim();
    if (!q) return ctx.ok({ users: [], pets: [] });
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const users = all(
      'SELECT id, handle, display, avatar, level FROM users WHERE display LIKE ? OR handle LIKE ? LIMIT 8',
      like, like
    ).map((u) => ({ ...u, avatar: M.assetUrl(u.avatar) }));
    const pets = all(
      'SELECT p.id, p.name, p.avatar, p.species, p.user_id, u.handle, u.display FROM pets p JOIN users u ON u.id = p.user_id WHERE p.name LIKE ? LIMIT 8',
      like
    ).map((p) => ({
      id: p.id, name: p.name, avatar: M.assetUrl(p.avatar), species: p.species,
      owner: { id: p.user_id, handle: p.handle, display: p.display },
    }));
    ctx.ok({ users, pets });
  });

  // 站点公开统计（首页展示用）
  r.get('/api/stats', async (ctx) => {
    const one = (sql) => (get(sql) || {}).n || 0;
    ctx.ok({
      users: one('SELECT COUNT(*) AS n FROM users'),
      pets: one('SELECT COUNT(*) AS n FROM pets'),
      posts: one('SELECT COUNT(*) AS n FROM posts'),
      records: one('SELECT COUNT(*) AS n FROM records'),
      entries: one('SELECT COUNT(*) AS n FROM diary'),
      photos: one("SELECT COUNT(*) AS n FROM assets WHERE kind = 'photo'"),
    });
  });

  // 通知
  r.get('/api/notifications', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const rows = all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', u.id);
    const items = rows.map((n) => ({
      id: n.id, type: n.type, objectId: n.object_id, text: n.text,
      createdAt: n.created_at, read: !!n.read_at, actor: F.userBrief(n.actor_id),
    }));
    ctx.ok({ items, unread: items.filter((i) => !i.read).length });
  });

  r.post('/api/notifications/read', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const b = await ctx.json();
    if (b.all) run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowISO(), u.id);
    else if (Array.isArray(b.ids)) {
      for (const id of b.ids) run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?', nowISO(), String(id), u.id);
    }
    ctx.ok({});
  });
};
