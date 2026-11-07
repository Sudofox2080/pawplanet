// 任务页 · 等级大卡 / 每日-每周-一次性任务 / 等级阶梯 / 排行榜
import {
  h, api, state, pageHead, emptyState, loadingBlock, avatarEl, xpBar, btn,
  statBlock, sectionCard, toast, handleError, navigate,
} from '../lib.js';

const GROUPS = [
  { key: 'daily', label: '每日任务', hint: '每天零点刷新，做完就发经验' },
  { key: 'weekly', label: '每周任务', hint: '本周内累计，周一重新开始' },
  { key: 'once', label: '一次性任务', hint: '完成一次就永久记下' },
];

const FALLBACK_LEVEL = {
  level: 1, title: '新手铲屎官', xp: 0, intoLevel: 0, needLevel: 50, nextXp: 50, progress: 0, levelUpXp: 50,
};

const levelNum = (lv) => {
  if (lv && typeof lv === 'object') return lv.level || 1;
  const n = Number(lv);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

function progressBar(progress, target) {
  const pct = target > 0 ? Math.min(100, Math.round((Math.min(progress, target) / target) * 100)) : 0;
  return h('div.tasks-bar', {}, h('i', { style: { width: pct + '%' } }));
}

function taskItem(t, me) {
  const done = !!(me && t.done);
  const progress = Math.min(Number(t.progress) || 0, Number(t.target) || 0);
  const left = Math.max(0, (Number(t.target) || 0) - progress);
  return h('button.tasks-item' + (done ? '.is-done' : ''), {
    type: 'button',
    onclick: () => toast(done
      ? '这个任务本期已经做完了，下个周期再来'
      : '任务达标会自动发经验，不用手动领取', done ? '' : 'ok'),
  },
  h('span.tasks-icon', { 'aria-hidden': 'true' }, t.icon || '🐾'),
  h('div.tasks-main', {},
    h('div.tasks-line', {},
      h('span.tasks-title', {}, t.title || ''),
      h('span.tasks-xp', {}, '+' + (Number(t.xp) || 0) + ' XP')
    ),
    t.desc ? h('div.tasks-desc', {}, t.desc) : null,
    progressBar(progress, Number(t.target) || 1),
    h('div.tasks-meta', {},
      h('span.tasks-count', {}, progress + ' / ' + (Number(t.target) || 0)),
      h('span.tasks-state' + (done ? '.is-ok' : ''), {}, done ? '已完成' : '还剩 ' + left + ' 次')
    )
  ),
  done ? h('span.tasks-check', { 'aria-hidden': 'true' }, '✓') : null
  );
}

function heroCard(data, me) {
  const level = data.level && typeof data.level === 'object' ? data.level : FALLBACK_LEVEL;
  return h('div.tasks-hero', {},
    h('div.tasks-hero-main', {},
      h('div.tasks-eyebrow', {}, '当前等级'),
      h('div.tasks-lv-row', {},
        h('span.tasks-lv', {}, 'Lv.' + levelNum(level)),
        h('span.tasks-title-chip', {}, level.title || '新手铲屎官')
      ),
      h('div.tasks-xp-wrap', {}, xpBar(level, { showText: false })),
      h('div.tasks-xp-line', {},
        h('span', {}, (level.intoLevel || 0) + ' / ' + (level.needLevel || 50) + ' XP'),
        h('span', {}, level.levelUpXp > 0
          ? '再攒 ' + level.levelUpXp + ' XP 升到 Lv.' + (levelNum(level) + 1)
          : '已经是满级铲屎官了')
      )
    ),
    h('div.tasks-hero-stats', {},
      statBlock('今日经验', '+' + (Number(data.todayXp) || 0)),
      statBlock('连续记录', (Number(data.streak) || 0) + ' 天'),
      statBlock('今日完成', (Number(data.doneToday) || 0) + ' / ' + (Number(data.totalToday) || 0))
    )
  );
}

function ladderCard(list, level) {
  const now = levelNum(level);
  const near = (list || []).filter((s) => Math.abs(s.level - now) <= 3);
  const steps = near.length ? near : (list || []).slice(0, 7);
  const track = h('div.tasks-ladder');
  for (const s of steps) {
    const stateCls = s.level === now ? '.is-now' : s.level < now ? '.is-past' : '';
    track.appendChild(h('div.tasks-step' + stateCls, {},
      h('div.tasks-step-lv', {}, 'Lv.' + s.level),
      h('div.tasks-step-xp', {}, (Number(s.xp) || 0) + ' XP'),
      h('div.tasks-step-title', {}, s.title || '')
    ));
  }
  if (!steps.length) {
    return sectionCard('等级阶梯', null, emptyState('🪜', '等级表还没准备好'));
  }
  requestAnimationFrame(() => {
    const el = track.querySelector('.is-now');
    if (!el) return;
    track.scrollLeft = Math.max(0, el.offsetLeft - track.clientWidth / 2 + el.offsetWidth / 2);
  });
  return sectionCard('等级阶梯', h('span.small.muted', {}, '等级越高，能解锁的东西越多'), track);
}

function boardCard(items, me) {
  const medals = ['🥇', '🥈', '🥉'];
  const body = (items && items.length)
    ? h('div.tasks-board', {}, items.slice(0, 10).map((u, i) => h('button.tasks-board-row' + (me && u.id === me.id ? '.is-me' : ''), {
        type: 'button',
        onclick: () => navigate('#/u/' + u.handle),
      },
      h('span.tasks-rank' + (i < 3 ? '.is-medal' : ''), i < 3 ? { 'aria-label': '第 ' + (i + 1) + ' 名' } : null, i < 3 ? medals[i] : String(i + 1)),
      avatarEl(u, 34),
      h('div.tasks-board-main', {},
        h('div.tasks-board-name', {}, u.display || u.handle || ''),
        h('div.tasks-board-handle', {}, '@' + (u.handle || ''))
      ),
      h('div.tasks-board-right', {},
        h('div.tasks-board-lv', {}, 'Lv.' + levelNum(u.level)),
        h('div.small.muted', {}, (Number(u.xp) || 0) + ' XP')
      )
    )))
    : emptyState('🏆', '排行榜还空着，来当第一个吧');
  return sectionCard('经验排行榜', h('span.small.muted', {}, '前 10 名'), body);
}

function groupCard(group, items, me) {
  const doneCount = items.filter((t) => me && t.done).length;
  const extra = h('span.tasks-group-count', {}, me ? '已完成 ' + doneCount + ' / ' + items.length : items.length + ' 个');
  return h('div.card.tasks-group', {},
    h('div.tasks-group-head', {},
      h('div', {},
        h('h3', {}, group.label),
        h('div.small.muted', {}, group.hint)
      ),
      extra
    ),
    items.length
      ? h('div.tasks-list', {}, items.map((t) => taskItem(t, me)))
      : emptyState('🐾', '这一组暂时没有任务')
  );
}

export default async function tasksView(ctx) {
  const me = ctx.user || state.user || null;

  const page = h('div.tasks-page', {});

  const headActions = [
    me
      ? h('a.btn.ghost.sm', { href: '#/u/' + me.handle }, '我的主页')
      : h('a.btn.primary.sm', { href: '#/login' }, '登录'),
    btn('刷新', () => ctx.rerender(), { variant: 'ghost', sm: true }),
  ];
  page.appendChild(pageHead('任务', '做点小事，攒经验，慢慢把 Lv 养上去', headActions));

  if (!me) {
    page.appendChild(h('div.tasks-guest', {},
      h('div.tasks-guest-text', {},
        h('div.tasks-guest-title', {}, '登录后才能积累经验'),
        h('div.small.muted', {}, '未登录也能看看任务清单，登录之后完成动作就会自动记进度、发经验。')
      ),
      h('a.btn.primary.sm', { href: '#/login' }, '去登录')
    ));
  }

  const body = h('div.stack', {}, loadingBlock('正在读取任务…'));
  page.appendChild(body);

  let data = null;
  let board = null;
  try {
    const [t, b] = await Promise.all([
      api.get('/api/tasks'),
      api.get('/api/leaderboard').catch((e) => { handleError(e); return { items: [] }; }),
    ]);
    data = t;
    board = b;
  } catch (e) {
    handleError(e);
    body.replaceChildren(h('div.card', {},
      emptyState('😿', '任务没读出来，稍后再试', btn('重新加载', () => ctx.rerender(), { variant: 'ghost', sm: true }))
    ));
    return page;
  }

  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const level = data.level && typeof data.level === 'object' ? data.level : FALLBACK_LEVEL;

  body.replaceChildren(
    heroCard(data, me),
    ...GROUPS.map((g) => groupCard(g, tasks.filter((t) => t.period === g.key), me)),
    ladderCard(Array.isArray(data.ladder) ? data.ladder : [], level),
    boardCard((board && board.items) || [], me)
  );

  return page;
}
