'use strict';
const { get, run, all, nowISO } = require('../lib/db');
const { bad } = require('../lib/http');
const A = require('../lib/auth');
const F = require('../lib/feed');

const pair = (x, y) => (x < y ? [x, y] : [y, x]);
const friendCard = (id) => {
  const u = get('SELECT id, handle, display, avatar, level, bio FROM users WHERE id = ?', id);
  if (!u) return null;
  return {
    ...u,
    stats: {
      posts: get('SELECT COUNT(*) AS n FROM posts WHERE user_id = ?', id).n,
      pets: get('SELECT COUNT(*) AS n FROM pets WHERE user_id = ?', id).n,
    },
  };
};

module.exports = (r) => {
  r.get('/api/friends', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const accepted = all(
      `SELECT * FROM friendships WHERE status='accepted' AND (a_id = ? OR b_id = ?) ORDER BY updated_at DESC`,
      u.id, u.id
    );
    const friends = accepted.map((f) => friendCard(f.a_id === u.id ? f.b_id : f.a_id)).filter(Boolean);
    const incoming = all(
      `SELECT * FROM friendships WHERE status='pending' AND requester_id <> ? AND (a_id = ? OR b_id = ?)`,
      u.id, u.id, u.id
    );
    const outgoing = all(`SELECT * FROM friendships WHERE status='pending' AND requester_id = ?`, u.id);
    ctx.ok({
      friends,
      incoming: incoming.map((f) => ({ id: f.requester_id, user: friendCard(f.requester_id), createdAt: f.created_at })),
      outgoing: outgoing.map((f) => ({ id: f.a_id === u.id ? f.b_id : f.a_id, user: friendCard(f.a_id === u.id ? f.b_id : f.a_id), createdAt: f.created_at })),
    });
  });

  r.post('/api/friends/request', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const b = await ctx.json();
    const key = String(b.handle || b.userId || '').replace(/^@/, '').trim();
    const target = get('SELECT * FROM users WHERE handle = ?', key.toLowerCase()) || get('SELECT * FROM users WHERE id = ?', key);
    if (!target) throw bad('not_found', '没有这个用户', 404);
    if (target.id === u.id) throw bad('self', '不能加自己', 400);
    const [a, c] = pair(u.id, target.id);
    const exist = get('SELECT * FROM friendships WHERE a_id = ? AND b_id = ?', a, c);
    if (exist) {
      if (exist.status === 'accepted') throw bad('already_friends', '你们已经是好友了', 409);
      if (exist.requester_id === u.id) throw bad('pending', '已经发过请求了，等对方回应', 409);
      // 对方已经请求过我 → 直接成为好友
      run('UPDATE friendships SET status = ?, updated_at = ? WHERE a_id = ? AND b_id = ?', 'accepted', nowISO(), a, c);
      F.notify(target.id, u.id, 'friend', u.id, `${u.display} 通过了你的好友请求`);
      const gained = F.bump(u.id, 'friend_accept', 1);
      return ctx.ok({ status: 'accepted', gained });
    }
    run('INSERT INTO friendships (a_id, b_id, status, requester_id, created_at, updated_at) VALUES (?,?,?,?,?,?)',
      a, c, 'pending', u.id, nowISO(), nowISO());
    F.notify(target.id, u.id, 'friend_request', u.id, `${u.display} 想加你为好友`);
    ctx.ok({ status: 'pending' });
  });

  r.post('/api/friends/accept', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const b = await ctx.json();
    const other = String(b.userId || '');
    const [a, c] = pair(u.id, other);
    const f = get('SELECT * FROM friendships WHERE a_id = ? AND b_id = ?', a, c);
    if (!f || f.status !== 'pending') throw bad('not_found', '没有待处理的请求', 404);
    if (f.requester_id === u.id) throw bad('self', '这是你自己发出的请求');
    run('UPDATE friendships SET status = ?, updated_at = ? WHERE a_id = ? AND b_id = ?', 'accepted', nowISO(), a, c);
    F.notify(other, u.id, 'friend', u.id, `${u.display} 通过了你的好友请求`);
    const gained = F.bump(u.id, 'friend_accept', 1).concat(F.bump(other, 'friend_accept', 1))
      .filter((g, i, arr) => arr.findIndex((x) => x.code === g.code) === i);
    ctx.ok({ status: 'accepted', gained });
  });

  r.post('/api/friends/reject', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const b = await ctx.json();
    const [a, c] = pair(u.id, String(b.userId || ''));
    run('DELETE FROM friendships WHERE a_id = ? AND b_id = ? AND status = ?', a, c, 'pending');
    ctx.ok({});
  });

  r.delete('/api/friends/:userId', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const [a, c] = pair(u.id, ctx.params.userId);
    run('DELETE FROM friendships WHERE a_id = ? AND b_id = ?', a, c);
    ctx.ok({});
  });
};
