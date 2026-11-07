'use strict';
// 数据层：node:sqlite（Node 22 内置），零第三方依赖
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 4000');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  display TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  avatar TEXT,
  cover TEXT,
  password TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_seen TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ua TEXT
);
CREATE TABLE IF NOT EXISTS pets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  species TEXT NOT NULL DEFAULT 'dog',
  breed TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  birthday TEXT,
  avatar TEXT,
  cover TEXT,
  bio TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'public',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS diary (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  mood TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id TEXT,
  body TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'public',
  source_type TEXT,
  source_id TEXT,
  repost_of TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  file TEXT NOT NULL,
  mime TEXT NOT NULL,
  w INTEGER NOT NULL DEFAULT 0,
  h INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  remote INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS post_assets (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  layout TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (post_id, asset_id)
);
CREATE TABLE IF NOT EXISTS record_assets (
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (record_id, asset_id)
);
CREATE TABLE IF NOT EXISTS diary_assets (
  diary_id TEXT NOT NULL REFERENCES diary(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (diary_id, asset_id)
);
CREATE TABLE IF NOT EXISTS likes (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS friendships (
  a_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  b_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  requester_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (a_id, b_id)
);
CREATE TABLE IF NOT EXISTS tasks (
  code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  desc TEXT NOT NULL DEFAULT '',
  period TEXT NOT NULL DEFAULT 'daily',
  target INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 10,
  icon TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS task_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_code TEXT NOT NULL,
  period_key TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  PRIMARY KEY (user_id, task_code, period_key)
);
CREATE TABLE IF NOT EXISTS xp_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id TEXT,
  type TEXT NOT NULL,
  object_id TEXT,
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_user ON records(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_diary_user ON diary(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_assets_user ON assets(user_id, kind);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);
`;

db.exec(SCHEMA);

// ---------- 轻量迁移：老库补列 ----------
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
// assets.remote：图片是否已经搬到对象存储（1 时 file 是 R2 的 key，不再是本地文件名）
ensureColumn('assets', 'remote', 'remote INTEGER NOT NULL DEFAULT 0');

// ---------- 查询 helper ----------
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
const tx = (fn) => {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw e;
  }
};

// ---------- 时间与周期 ----------
const TZ_OFFSET = 8 * 3600 * 1000; // 全站以 Asia/Shanghai 计日
const nowISO = () => new Date().toISOString();

function periodKey(period) {
  if (period === 'once') return 'once';
  const t = new Date(Date.now() + TZ_OFFSET);
  const y = t.getUTCFullYear();
  const mo = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  if (period === 'daily') return `${y}-${mo}-${d}`;
  const date = new Date(Date.UTC(y, t.getUTCMonth(), t.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function todayKey() {
  return periodKey('daily');
}

// ---------- 等级 ----------
const TITLES = [
  [50, '宇宙级毛家长'], [40, '传说铲屎官'], [30, '星球守护者'],
  [20, '治愈系大佬'], [15, '毛孩子摄影师'], [10, '星球居民'],
  [6, '记录达人'], [3, '遛狗学徒'], [1, '新手铲屎官'],
];
const MAX_LEVEL = 60;
const xpForLevel = (n) => 50 * Math.pow(Math.max(1, n) - 1, 2);

function levelInfo(xp) {
  const total = Math.max(0, Math.floor(xp || 0));
  let level = 1;
  while (level < MAX_LEVEL && total >= xpForLevel(level + 1)) level++;
  const base = xpForLevel(level);
  const next = level >= MAX_LEVEL ? base : xpForLevel(level + 1);
  const need = Math.max(1, next - base);
  const into = total - base;
  const title = (TITLES.find(([lv]) => level >= lv) || TITLES[TITLES.length - 1])[1];
  return {
    level,
    title,
    xp: total,
    intoLevel: into,
    needLevel: need,
    nextXp: next,
    progress: Math.min(1, into / need),
    levelUpXp: Math.max(0, next - total),
  };
}

// ---------- 可见性 ----------
const VISIBILITIES = ['public', 'friends', 'private'];
const normVis = (v) => (VISIBILITIES.includes(v) ? v : 'public');

// SQL 片段：给定帖子/记录表别名与用户占位符
function visibilityClause(alias, viewerParam, friendParam) {
  return `(${alias}.visibility = 'public'
    OR (${viewerParam} IS NOT NULL AND ${alias}.user_id = ${viewerParam})
    OR (${alias}.visibility = 'friends' AND ${friendParam} = 1))`;
}

function areFriends(a, b) {
  if (!a || !b || a === b) return false;
  const [x, y] = a < b ? [a, b] : [b, a];
  const row = get('SELECT status FROM friendships WHERE a_id = ? AND b_id = ?', x, y);
  return !!(row && row.status === 'accepted');
}

module.exports = {
  db, all, get, run, tx,
  DATA_DIR, UPLOAD_DIR,
  nowISO, periodKey, todayKey,
  levelInfo, xpForLevel, MAX_LEVEL, TITLES,
  VISIBILITIES, normVis, visibilityClause, areFriends,
};
