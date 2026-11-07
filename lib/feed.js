'use strict';
// 社交序列化、可见性、XP 与任务推进
const { all, get, run, nowISO, periodKey, levelInfo, normVis } = require('./db');
const { rid } = require('./http');
const { assetUrl } = require('./media');
const S = require('./storage');

const assetOut = (a) => a ? {
  id: a.id,
  kind: a.kind,
  url: S.urlFor(a),
  thumb: S.urlFor(a),
  w: a.w,
  h: a.h,
  mime: a.mime,
  name: a.name,
  remote: !!a.remote,
} : null;

const assetById = (id) => (id ? get('SELECT * FROM assets WHERE id = ?', id) : null);
const assetsOut = (id) => {
  const a = assetById(id);
  return a ? assetOut(a) : null;
};

const userBrief = (id) => {
  if (!id) return null;
  const u = get('SELECT id, handle, display, avatar, level FROM users WHERE id = ?', id);
  return u ? { id: u.id, handle: u.handle, display: u.display, avatar: assetUrl(u.avatar), avatarId: u.avatar, level: u.level } : null;
};

const petBrief = (id) => {
  if (!id) return null;
  const p = get('SELECT id, name, avatar, species FROM pets WHERE id = ?', id);
  return p ? { id: p.id, name: p.name, avatar: assetUrl(p.avatar), avatarId: p.avatar, species: p.species } : null;
};

// 好友 id 子查询（两个占位符 = 同一个 userId）
const FRIEND_IDS_SQL = `(SELECT b_id FROM friendships WHERE a_id = ? AND status = 'accepted'
  UNION SELECT a_id FROM friendships WHERE b_id = ? AND status = 'accepted')`;

function canView(ownerId, visibility, viewerId) {
  const vis = normVis(visibility);
  if (vis === 'public') return true;
  if (!viewerId) return false;
  if (ownerId === viewerId) return true;
  if (vis === 'friends') {
    const r = get(
      `SELECT 1 AS ok FROM friendships WHERE status='accepted'
       AND ((a_id = ? AND b_id = ?) OR (b_id = ? AND a_id = ?))`,
      ownerId, viewerId, ownerId, viewerId
    );
    return !!r;
  }
  return false;
}

// ---------- 帖子 ----------
// 把 layout 里的 assetId 展开成可直接渲染的 url（图层与相框）
function expandLayout(layout) {
  if (!layout || typeof layout !== 'object') return {};
  const out = { frame: null, layers: [] };
  if (layout.frame && layout.frame.assetId) {
    const a = assetById(layout.frame.assetId);
    out.frame = {
      assetId: layout.frame.assetId,
      style: layout.frame.style || 'none',
      url: a ? S.urlFor(a) : null,
      w: a ? a.w : 0,
      h: a ? a.h : 0,
    };
  } else if (layout.frame && layout.frame.style) {
    out.frame = { assetId: null, style: layout.frame.style, url: null, w: 0, h: 0 };
  }
  for (const l of Array.isArray(layout.layers) ? layout.layers : []) {
    const a = assetById(l.assetId);
    if (!a) continue;
    out.layers.push({
      assetId: l.assetId,
      url: S.urlFor(a),
      // 贴纸原图尺寸：前端据此按真实宽高比摆放，避免被拉成方形
      w: a.w,
      h: a.h,
      x: Number(l.x) || 0,
      y: Number(l.y) || 0,
      scale: Number(l.scale) || 0.2,
      rotate: Number(l.rotate) || 0,
      opacity: l.opacity == null ? 1 : Number(l.opacity),
    });
  }
  return out;
}

function postAssets(postId) {
  const rows = all(
    `SELECT a.*, pa.layout, pa.sort FROM post_assets pa JOIN assets a ON a.id = pa.asset_id
     WHERE pa.post_id = ? ORDER BY pa.sort ASC`, postId
  );
  return rows.map((r) => ({ ...assetOut(r), layout: expandLayout(safeJSON(r.layout, {})) }));
}

function safeJSON(s, fb) {
  try { return JSON.parse(s || ''); } catch { return fb; }
}

const SOURCE_LABEL = {
  record: '来自记录', diary: '来自日记', post: '动态', editor: '贴纸作品',
};

function postOut(row, viewerId) {
  if (!row) return null;
  const likes = get('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?', row.id).n;
  const comments = get('SELECT COUNT(*) AS n FROM comments WHERE post_id = ?', row.id).n;
  const liked = viewerId ? !!get('SELECT 1 AS x FROM likes WHERE post_id = ? AND user_id = ?', row.id, viewerId) : false;
  const reposted = viewerId ? !!get('SELECT 1 AS x FROM posts WHERE repost_of = ? AND user_id = ?', row.id, viewerId) : false;
  const preview = all(
    `SELECT c.id, c.body, c.created_at, u.id AS uid, u.handle, u.display, u.avatar, u.level
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.post_id = ? ORDER BY c.created_at ASC LIMIT 2`, row.id
  ).map((c) => ({
    id: c.id,
    body: c.body,
    createdAt: c.created_at,
    user: { id: c.uid, handle: c.handle, display: c.display, avatar: assetUrl(c.avatar), avatarId: c.avatar, level: c.level },
  }));
  let repostOf = null;
  if (row.repost_of) {
    const src = get('SELECT * FROM posts WHERE id = ?', row.repost_of);
    if (src) {
      repostOf = {
        id: src.id,
        body: src.body,
        user: userBrief(src.user_id),
        assets: postAssets(src.id).slice(0, 1),
        createdAt: src.created_at,
      };
    }
  }
  return {
    id: row.id,
    user: userBrief(row.user_id),
    body: row.body || '',
    visibility: row.visibility,
    createdAt: row.created_at,
    pet: petBrief(row.pet_id),
    assets: postAssets(row.id),
    likes,
    comments,
    liked,
    reposted,
    repostOf,
    source: row.source_type ? { type: row.source_type, id: row.source_id, label: SOURCE_LABEL[row.source_type] || '动态' } : null,
    tag: row.source_type === 'record' ? recordTypeLabel(row.source_id) : '',
    commentsPreview: preview,
  };
}

function recordTypeLabel(recordId) {
  if (!recordId) return '';
  const r = get('SELECT type FROM records WHERE id = ?', recordId);
  return r ? ({ walk: '遛狗', deworm: '驱虫', medical: '病例', vaccine: '疫苗', weight: '体重', bath: '洗澡', train: '训练' }[r.type] || '记录') : '';
}

function feedRows({ viewer, tab = 'all', petId = null, handleUser = null, limit = 12, cursor = null }) {
  const viewerId = viewer ? viewer.id : null;
  const lim = Math.min(40, Math.max(1, parseInt(limit, 10) || 12));
  const where = [];
  const params = [];
  if (handleUser) {
    where.push('p.user_id = ?');
    params.push(handleUser);
    if (viewerId !== handleUser) {
      where.push(`(p.visibility = 'public' OR (p.visibility = 'friends' AND p.user_id IN ${FRIEND_IDS_SQL}))`);
      params.push(viewerId, viewerId);
    }
  } else if (viewerId) {
    where.push(`(p.visibility = 'public' OR p.user_id = ? OR (p.visibility = 'friends' AND p.user_id IN ${FRIEND_IDS_SQL}))`);
    params.push(viewerId, viewerId, viewerId);
  } else {
    where.push(`p.visibility = 'public'`);
  }
  if (tab === 'friends' && viewerId) {
    where.push(`p.user_id IN ${FRIEND_IDS_SQL}`);
    params.push(viewerId, viewerId);
  } else if (tab === 'mine' && viewerId) {
    where.push('p.user_id = ?');
    params.push(viewerId);
  } else if (tab === 'like' && viewerId) {
    where.push('p.id IN (SELECT post_id FROM likes WHERE user_id = ?)');
    params.push(viewerId);
  }
  if (petId) {
    where.push('p.pet_id = ?');
    params.push(petId);
  }
  if (cursor) {
    where.push('p.created_at < ?');
    params.push(cursor);
  }
  const sql = `SELECT p.* FROM posts p WHERE ${where.join(' AND ')}
    ORDER BY p.created_at DESC LIMIT ${lim + 1}`;
  return all(sql, ...params);
}

function listFeed(opts) {
  const rows = feedRows(opts);
  const lim = Math.min(40, Math.max(1, parseInt(opts.limit, 10) || 12));
  const hasMore = rows.length > lim;
  const items = rows.slice(0, lim).map((r) => postOut(r, opts.viewer ? opts.viewer.id : null));
  return { items, nextCursor: hasMore && items.length ? items[items.length - 1].createdAt : null };
}

// ---------- XP / 任务 ----------
function award(userId, amount, reason, ref = null) {
  if (!userId || !amount) return null;
  const u = get('SELECT id, xp, level FROM users WHERE id = ?', userId);
  if (!u) return null;
  const xp = Math.max(0, (u.xp || 0) + amount);
  const lv = levelInfo(xp);
  run('UPDATE users SET xp = ?, level = ? WHERE id = ?', xp, lv.level, userId);
  run('INSERT INTO xp_log (id, user_id, amount, reason, ref, created_at) VALUES (?,?,?,?,?,?)',
    rid(), userId, amount, reason, ref, nowISO());
  return { xp, level: lv.level, leveledUp: lv.level > (u.level || 1), info: lv };
}

function bump(userId, event, amount = 1) {
  if (!userId) return [];
  const tasks = all('SELECT * FROM tasks WHERE event = ? AND active = 1', event);
  const gained = [];
  for (const t of tasks) {
    const pk = periodKey(t.period);
    const cur = get('SELECT * FROM task_progress WHERE user_id=? AND task_code=? AND period_key=?', userId, t.code, pk);
    if (cur && cur.done_at) continue;
    if (cur && cur.progress >= t.target) continue;
    const next = Math.min(t.target, (cur ? cur.progress : 0) + amount);
    if (cur) {
      run('UPDATE task_progress SET progress = ? WHERE user_id=? AND task_code=? AND period_key=?',
        next, userId, t.code, pk);
    } else {
      run('INSERT INTO task_progress (user_id, task_code, period_key, progress) VALUES (?,?,?,?)',
        userId, t.code, pk, next);
    }
    if (next >= t.target) {
      run('UPDATE task_progress SET done_at = ? WHERE user_id=? AND task_code=? AND period_key=?',
        nowISO(), userId, t.code, pk);
      const res = award(userId, t.xp, 'task:' + t.code, t.code);
      gained.push({ code: t.code, title: t.title, xp: t.xp, level: res && res.level, leveledUp: res && res.leveledUp });
    }
  }
  return gained;
}

function tasksFor(userId) {
  const tasks = all('SELECT * FROM tasks WHERE active = 1 ORDER BY sort ASC, code ASC');
  return tasks.map((t) => {
    const pk = periodKey(t.period);
    const p = userId ? get('SELECT * FROM task_progress WHERE user_id=? AND task_code=? AND period_key=?', userId, t.code, pk) : null;
    const progress = p ? Math.min(p.progress, t.target) : 0;
    return {
      code: t.code, title: t.title, desc: t.desc, period: t.period, target: t.target,
      xp: t.xp, icon: t.icon, progress, done: !!(p && p.done_at), periodKey: pk,
    };
  });
}

const localKey = (iso) => {
  const t = new Date(new Date(iso).getTime() + 8 * 3600e3);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};

function todayXp(userId) {
  const key = periodKey('daily');
  const rows = all('SELECT amount, created_at FROM xp_log WHERE user_id = ?', userId);
  return rows.reduce((s, r) => (localKey(r.created_at) === key ? s + r.amount : s), 0);
}

// 连续打卡天数：按当日是否有 XP 记录
function streakOf(userId) {
  const rows = all('SELECT DISTINCT created_at FROM xp_log WHERE user_id = ? ORDER BY created_at DESC', userId);
  const days = new Set(rows.map((r) => localKey(r.created_at)));
  let n = 0;
  let cur = new Date(Date.now() + 8 * 3600e3);
  for (let i = 0; i < 400; i++) {
    const key = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}-${String(cur.getUTCDate()).padStart(2, '0')}`;
    if (days.has(key)) n++;
    else if (i > 0) break;
    else if (i === 0) { /* 今天还没记录，继续看昨天 */ }
    cur = new Date(cur.getTime() - 86400000);
  }
  return n;
}

// ---------- 通知 ----------
function notify(userId, actorId, type, objectId, text) {
  if (!userId || userId === actorId) return;
  run('INSERT INTO notifications (id, user_id, actor_id, type, object_id, text, created_at) VALUES (?,?,?,?,?,?,?)',
    rid(), userId, actorId || null, type, objectId || null, text || '', nowISO());
}

// ---------- 统计 ----------
function userStats(userId) {
  return {
    posts: get('SELECT COUNT(*) AS n FROM posts WHERE user_id = ?', userId).n,
    friends: get(`SELECT COUNT(*) AS n FROM friendships WHERE status='accepted' AND (a_id=? OR b_id=?)`, userId, userId).n,
    records: get('SELECT COUNT(*) AS n FROM records WHERE user_id = ?', userId).n,
    entries: get('SELECT COUNT(*) AS n FROM diary WHERE user_id = ?', userId).n,
    pets: get('SELECT COUNT(*) AS n FROM pets WHERE user_id = ?', userId).n,
  };
}

function recordOut(r) {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    note: r.note,
    ts: r.ts,
    data: safeJSON(r.data, {}),
    visibility: r.visibility,
    petId: r.pet_id,
    pet: petBrief(r.pet_id),
    assets: all('SELECT a.* FROM record_assets ra JOIN assets a ON a.id = ra.asset_id WHERE ra.record_id = ? ORDER BY ra.sort', r.id).map(assetOut),
    createdAt: r.created_at,
  };
}

function diaryOut(r) {
  const assets = all('SELECT a.* FROM diary_assets da JOIN assets a ON a.id = da.asset_id WHERE da.diary_id = ? ORDER BY da.sort', r.id).map(assetOut);
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    mood: r.mood,
    date: r.date,
    visibility: r.visibility,
    petId: r.pet_id,
    pet: petBrief(r.pet_id),
    assets,
    excerpt: (r.content || '').slice(0, 90),
    createdAt: r.created_at,
  };
}

module.exports = {
  assetOut, assetById, assetsOut, userBrief, petBrief,
  canView, postOut, listFeed, feedRows, postAssets,
  award, bump, tasksFor, todayXp, streakOf, notify, userStats,
  recordOut, diaryOut, safeJSON, FRIEND_IDS_SQL, recordTypeLabel,
};
