'use strict';
const { get, all, levelInfo, xpForLevel, TITLES } = require('../lib/db');
const A = require('../lib/auth');
const F = require('../lib/feed');

module.exports = (r) => {
  r.get('/api/tasks', async (ctx) => {
    const tasks = F.tasksFor(ctx.user ? ctx.user.id : null);
    const u = ctx.user;
    const level = levelInfo(u ? u.xp : 0);
    const ladder = [];
    for (let i = 1; i <= 12; i++) {
      const req = xpForLevel(i);
      ladder.push({ level: i, xp: req, title: (TITLES.find(([lv]) => i >= lv) || TITLES[TITLES.length - 1])[1] });
    }
    ctx.ok({
      tasks,
      level,
      ladder,
      todayXp: u ? F.todayXp(u.id) : 0,
      streak: u ? F.streakOf(u.id) : 0,
      doneToday: u ? tasks.filter((t) => t.period === 'daily' && t.done).length : 0,
      totalToday: tasks.filter((t) => t.period === 'daily').length,
    });
  });

  // 兼容端点：任务达标自动发奖，这里只回状态
  r.post('/api/tasks/claim', async (ctx) => {
    A.requireUser(ctx.user);
    const b = await ctx.json().catch(() => ({}));
    const tasks = F.tasksFor(ctx.user.id);
    const t = tasks.find((x) => x.code === (b.code || ''));
    if (!t) throw Object.assign(new Error('任务不存在'), { status: 404, code: 'not_found' });
    ctx.ok({ task: t, alreadyAuto: true });
  });

  r.get('/api/leaderboard', async (ctx) => {
    const rows = all('SELECT id, handle, display, avatar, level, xp FROM users ORDER BY xp DESC LIMIT 10');
    ctx.ok({ items: rows });
  });
};
