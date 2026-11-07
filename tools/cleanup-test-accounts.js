'use strict';
// 清理测试账号及其全部内容（服务端执行）。默认 dry-run，加 --apply 才真正删除。
// 用法：node tools/cleanup-test-accounts.js --handles alice,bob [--apply]
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB = path.join(DATA_DIR, 'app.db');
const UPLOADS = path.join(DATA_DIR, 'uploads');

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const hi = argv.indexOf('--handles');
const handles = (hi >= 0 ? argv[hi + 1] : 'alice,bob').split(',').map((s) => s.trim()).filter(Boolean);

const db = new DatabaseSync(DB);
db.exec('PRAGMA foreign_keys = ON');

const targets = handles.map((h) => db.prepare('SELECT * FROM users WHERE handle = ?').get(h)).filter(Boolean);
const missing = handles.filter((h) => !targets.some((t) => t.handle === h));
if (missing.length) console.log('跳过（不存在）：', missing.join(', '));
if (!targets.length) { console.log('没有要清理的账号'); process.exit(0); }

const ids = targets.map((t) => t.id);
const ph = ids.map(() => '?').join(',');
const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);

console.log('目标账号：');
for (const t of targets) console.log(' -', t.handle, '|', t.display, '|', t.created_at);

// ---- 统计将受影响的数据 ----
const stats = {};
stats.posts = all(`SELECT id, body FROM posts WHERE user_id IN (${ph})`, ...ids);
stats.commentsOnTheirPosts = all(`SELECT id FROM comments WHERE post_id IN (SELECT id FROM posts WHERE user_id IN (${ph}))`, ...ids);
stats.commentsByThem = all(`SELECT id FROM comments WHERE user_id IN (${ph})`, ...ids);
stats.likesOnTheirPosts = all(`SELECT post_id, user_id FROM likes WHERE post_id IN (SELECT id FROM posts WHERE user_id IN (${ph}))`, ...ids);
stats.likesByThem = all(`SELECT post_id FROM likes WHERE user_id IN (${ph})`, ...ids);
stats.assets = all(`SELECT id, file FROM assets WHERE user_id IN (${ph})`, ...ids);
stats.pets = all(`SELECT id, name FROM pets WHERE user_id IN (${ph})`, ...ids);
stats.records = all(`SELECT id FROM records WHERE user_id IN (${ph})`, ...ids);
stats.diary = all(`SELECT id FROM diary WHERE user_id IN (${ph})`, ...ids);
stats.friendReq = all(`SELECT * FROM friendships WHERE a_id IN (${ph}) OR b_id IN (${ph})`, ...ids);
stats.notifs = all(`SELECT id FROM notifications WHERE user_id IN (${ph}) OR actor_id IN (${ph})`, ...ids);

// 他们的资产是否被别人的内容引用（引用到就不该删文件，只摘链接）
const borrowed = all(
  `SELECT DISTINCT asset_id FROM post_assets WHERE asset_id IN (SELECT id FROM assets WHERE user_id IN (${ph}))
     AND post_id NOT IN (SELECT id FROM posts WHERE user_id IN (${ph}))`, ...ids, ...ids
);
const borrowedIds = new Set(borrowed.map((b) => b.asset_id));

console.log('\n将要删除：');
console.log('  动态', stats.posts.length, '条：', stats.posts.map((p) => String(p.body).slice(0, 18) || '(空)').join(' / '));
console.log('  评论', stats.commentsOnTheirPosts.length + stats.commentsByThem.length, '条（含别人在他们动态下的回复）');
console.log('  点赞', stats.likesOnTheirPosts.length + stats.likesByThem.length, '条');
console.log('  宠物', stats.pets.length, '只：', stats.pets.map((p) => p.name).join('、'));
console.log('  记录', stats.records.length, '条 · 日记', stats.diary.length, '篇');
console.log('  素材', stats.assets.length, '个（其中被他人内容借用', borrowedIds.size, '个，只摘引用不删文件）');
console.log('  好友关系', stats.friendReq.length, '条 · 通知', stats.notifs.length, '条');
console.log('  会话 / 经验 / 任务进度全部清空');

if (!apply) {
  console.log('\n（dry-run，未改动任何数据；确认后加 --apply 执行）');
  process.exit(0);
}

// ---- 备份 ----
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(DATA_DIR, `backup-before-cleanup-${stamp}`);
fs.mkdirSync(backup, { recursive: true });
db.exec(`VACUUM INTO '${path.join(backup, 'app.db').replace(/'/g, "''")}'`);
console.log('\n已备份数据库到', backup);

const removedFiles = [];
db.exec('BEGIN');
try {
  const del = (sql, ...a) => db.prepare(sql).run(...a);

  // 1) 别人对他们动态的点赞 / 评论 / 通知
  del(`DELETE FROM likes WHERE post_id IN (SELECT id FROM posts WHERE user_id IN (${ph}))`, ...ids);
  del(`DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE user_id IN (${ph}))`, ...ids);
  // 2) 他们自己发的点赞 / 评论
  del(`DELETE FROM likes WHERE user_id IN (${ph})`, ...ids);
  del(`DELETE FROM comments WHERE user_id IN (${ph})`, ...ids);
  // 3) 帖子（先解开转发引用，避免外键卡住）
  del(`UPDATE posts SET repost_of = NULL WHERE repost_of IN (SELECT id FROM posts WHERE user_id IN (${ph}))`, ...ids);
  del(`DELETE FROM post_assets WHERE post_id IN (SELECT id FROM posts WHERE user_id IN (${ph}))`, ...ids);
  del(`DELETE FROM posts WHERE user_id IN (${ph})`, ...ids);
  // 4) 记录 / 日记
  del(`DELETE FROM record_assets WHERE record_id IN (SELECT id FROM records WHERE user_id IN (${ph}))`, ...ids);
  del(`DELETE FROM records WHERE user_id IN (${ph})`, ...ids);
  del(`DELETE FROM diary_assets WHERE diary_id IN (SELECT id FROM diary WHERE user_id IN (${ph}))`, ...ids);
  del(`DELETE FROM diary WHERE user_id IN (${ph})`, ...ids);
  // 5) 素材：被他人借用的只摘引用，其余连文件一起删
  for (const a of stats.assets) {
    if (borrowedIds.has(a.id)) {
      del('DELETE FROM post_assets WHERE asset_id = ?', a.id);
      del('DELETE FROM record_assets WHERE asset_id = ?', a.id);
      del('DELETE FROM diary_assets WHERE asset_id = ?', a.id);
      del('DELETE FROM assets WHERE id = ?', a.id);
      removedFiles.push({ file: a.file, kept: true });
    } else {
      del('DELETE FROM post_assets WHERE asset_id = ?', a.id);
      del('DELETE FROM record_assets WHERE asset_id = ?', a.id);
      del('DELETE FROM diary_assets WHERE asset_id = ?', a.id);
      del('DELETE FROM assets WHERE id = ?', a.id);
      removedFiles.push({ file: a.file, kept: false });
    }
  }
  // 6) 宠物 / 关系 / 通知 / 会话 / 经验 / 任务
  del(`DELETE FROM pets WHERE user_id IN (${ph})`, ...ids);
  del(`DELETE FROM friendships WHERE a_id IN (${ph}) OR b_id IN (${ph})`, ...ids);
  del(`DELETE FROM notifications WHERE user_id IN (${ph}) OR actor_id IN (${ph})`, ...ids);
  del(`DELETE FROM sessions WHERE user_id IN (${ph})`, ...ids);
  del(`DELETE FROM xp_log WHERE user_id IN (${ph})`, ...ids);
  del(`DELETE FROM task_progress WHERE user_id IN (${ph})`, ...ids);
  // 7) 账号
  del(`DELETE FROM users WHERE id IN (${ph})`, ...ids);

  db.exec('COMMIT');
  console.log('数据库清理完成');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('清理失败，已回滚：', e.message);
  process.exit(1);
}

// 8) 删文件
let files = 0;
for (const r of removedFiles) {
  if (r.kept) continue;
  const p = path.join(UPLOADS, r.file);
  try { fs.unlinkSync(p); files++; } catch (_) {}
}
console.log('删除上传文件', files, '个');

// 9) 兜底：清掉指向已删除素材的引用与空帖
const orphanLinks = db.prepare('DELETE FROM post_assets WHERE asset_id NOT IN (SELECT id FROM assets)').run();
const emptyPosts = db.prepare('DELETE FROM posts WHERE user_id NOT IN (SELECT id FROM users)').run();
console.log('兜底：孤儿图片引用', Number(orphanLinks.changes), '条，孤儿动态', Number(emptyPosts.changes), '条');

console.log('\n剩余：');
for (const t of ['users', 'pets', 'posts', 'records', 'diary', 'assets', 'likes', 'comments', 'friendships', 'notifications', 'sessions']) {
  console.log(' ', t, db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c);
}
