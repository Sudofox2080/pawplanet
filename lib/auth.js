'use strict';
const crypto = require('crypto');
const { get, run, nowISO } = require('./db');
const { rid, bad, parseCookies, setCookie } = require('./http');
const { assetUrl } = require('./media');

const COOKIE = 'pp_sid';
const SESSION_DAYS = 30;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(pw, stored) {
  try {
    const [algo, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const calc = crypto.scryptSync(String(pw), salt, 64);
    const want = Buffer.from(hash, 'hex');
    return calc.length === want.length && crypto.timingSafeEqual(calc, want);
  } catch {
    return false;
  }
}

function createSession(res, userId, ua) {
  const token = crypto.randomBytes(32).toString('hex');
  const created = nowISO();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  run(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, ua) VALUES (?,?,?,?,?)',
    token, userId, created, expires, String(ua || '').slice(0, 200)
  );
  setCookie(res, COOKIE, token, SESSION_DAYS * 86400);
  run('UPDATE users SET last_seen = ? WHERE id = ?', created, userId);
  return token;
}

function destroySession(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) run('DELETE FROM sessions WHERE id = ?', token);
  setCookie(res, COOKIE, '', 0);
}

function userFromReq(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const row = get(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
    token, nowISO()
  );
  return row || null;
}

function userById(id) {
  if (!id) return null;
  return get('SELECT * FROM users WHERE id = ?', id) || null;
}

function requireUser(user) {
  if (!user) throw bad('unauthorized', '请先登录', 401);
  return user;
}

// 登录限流：同一 IP 10 分钟内失败 8 次锁 15 分钟
const fails = new Map();
function noteFail(ip) {
  const rec = fails.get(ip) || { n: 0, until: 0, at: Date.now() };
  rec.n += 1;
  rec.at = Date.now();
  if (rec.n >= 8) rec.until = Date.now() + 15 * 60 * 1000;
  fails.set(ip, rec);
  if (fails.size > 5000) fails.clear();
}
function noteSuccess(ip) {
  fails.delete(ip);
}
function lockedFor(ip) {
  const rec = fails.get(ip);
  if (!rec) return 0;
  if (rec.until > Date.now()) return rec.until - Date.now();
  if (Date.now() - rec.at > 10 * 60 * 1000) fails.delete(ip);
  return 0;
}

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

function publicUser(u, extra = {}) {
  if (!u) return null;
  return {
    id: u.id,
    handle: u.handle,
    display: u.display,
    bio: u.bio || '',
    avatar: assetUrl(u.avatar),
    avatarId: u.avatar || null,
    cover: assetUrl(u.cover),
    coverId: u.cover || null,
    level: u.level || 1,
    xp: u.xp || 0,
    createdAt: u.created_at,
    ...extra,
  };
}

module.exports = {
  COOKIE, hashPassword, verifyPassword, createSession, destroySession,
  userFromReq, userById, requireUser, publicUser,
  noteFail, noteSuccess, lockedFor, HANDLE_RE, rid,
};
