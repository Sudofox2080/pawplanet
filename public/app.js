// 爪爪星球 · 应用外壳
import {
  h, api, state, loadSession, subscribe, toast, modal, avatarEl, handleError,
  navigate, xpBar, timeAgo, emptyState,
} from './lib.js';
import { startRouter, linkTo, resolve } from './router.js';

const NAV = [
  { to: '#/feed', label: '广场', icon: '🏡' },
  { to: '#/hot', label: '热门', icon: '🔥' },
  { to: '#/records', label: '记录', icon: '🗂️', auth: true },
  { to: '#/journal', label: '日记', icon: '📖', auth: true },
  { to: '#/tasks', label: '任务', icon: '🏆' },
  { to: '#/friends', label: '好友', icon: '🤝', auth: true },
];

const TABS = [
  { to: '#/feed', label: '广场', icon: '🏡' },
  { to: '#/records', label: '记录', icon: '🗂️', auth: true },
  { to: '#/create', label: '发布', icon: '➕', auth: true },
  { to: '#/tasks', label: '任务', icon: '🏆' },
];

function navItem(item, { tab = false } = {}) {
  const a = linkTo(item.to, h('span.ico', {}, item.icon), h('span', {}, item.label));
  a.className = 'nav-link';
  a.dataset.to = item.to;
  return a;
}

function renderSidebar() {
  const side = document.getElementById('sidebar');
  side.replaceChildren();

  side.appendChild(h('div.brand', {},
    h('div.brand-mark', {}, '🐾'),
    h('div', {}, h('div.brand-name', {}, '爪爪星球'), h('div.brand-sub', {}, 'PAW PLANET'))
  ));

  for (const item of NAV) side.appendChild(navItem(item));

  side.appendChild(h('div', { style: { height: '10px' } }));
  side.appendChild(h('a.btn.primary.block', { href: '#/create' }, '＋ 发布动态'));

  const foot = h('div.sidebar-foot');
  if (state.user) {
    const me = linkTo('#/u/' + state.user.handle, h('div.me-card', {},
      avatarEl(state.user, 38),
      h('div.meta', {},
        h('div.name', {}, state.user.display || state.user.handle),
        h('div.lvl', {}, `Lv.${state.user.level || 1}` + (state.level ? ' · ' + state.level.title : ''))
      )
    ));
    foot.appendChild(me);
    foot.appendChild(h('div.row', { style: { gap: '6px' } },
      h('a.nav-link', { href: '#/settings', style: { padding: '8px 10px', fontSize: '13px' } }, h('span.ico', {}, '⚙️'), '设置'),
      h('a.nav-link', { href: '#/explore', style: { padding: '8px 10px', fontSize: '13px' } }, h('span.ico', {}, '🔍'), '发现')
    ));
  } else {
    foot.appendChild(h('a.btn.primary.block', { href: '#/login' }, '登录 / 注册'));
  }
  side.appendChild(foot);
  markActive();
}

function renderTabbar() {
  const bar = document.getElementById('tabbar');
  bar.replaceChildren();
  const items = TABS.filter((t) => !t.auth || state.user);
  if (state.user) {
    items.push({ to: '#/u/' + state.user.handle, label: '我', icon: '🙂' });
  } else {
    items.push({ to: '#/login', label: '登录', icon: '👤' });
  }
  for (const item of items) bar.appendChild(navItem(item, { tab: true }));
  markActive();
}

function markActive() {
  const { route } = resolve(location.hash);
  const current = '#' + (location.hash.replace(/^#/, '') || '/');
  const target = route ? '#' + (route.path === '/' ? '/' : route.path) : '';
  for (const a of document.querySelectorAll('.nav-link')) {
    const to = a.dataset.to || a.getAttribute('href') || '';
    let active = false;
    if (to === '#/feed' || to === '#/hot') active = current.startsWith(to);
    else if (to.startsWith('#/u/')) active = current.startsWith('#/u/') && state.user && to === '#/u/' + state.user.handle;
    else active = current.split('?')[0].startsWith(to.split('?')[0]);
    if (route && route.path.startsWith('/u/') && to.startsWith('#/u/')) active = current.startsWith(to);
    a.classList.toggle('is-active', !!active);
  }
}

async function renderView(target) {
  const view = document.getElementById('view');
  view.replaceChildren(h('div.boot-inline', {}, '🐾 加载中…'));
  view.setAttribute('data-view', target.route.view);
  try {
    const mod = await import('./views/' + target.route.view + '.js');
    const ctx = {
      params: target.params,
      query: target.query,
      user: state.user,
      navigate,
      refreshUser: loadSession,
      rerender: () => renderView(target),
    };
    const node = await mod.default(ctx);
    view.replaceChildren(node || h('div.empty', {}, '这个页面还没有内容'));
  } catch (e) {
    console.error(e);
    view.replaceChildren(
      h('div.stack', {},
        h('div.empty', {}, h('div.big', {}, '😿'), h('div', {}, e && e.message ? e.message : '页面加载失败')),
        h('div.row', { style: { justifyContent: 'center' } },
          h('button.btn.ghost', { onclick: () => renderView(target) }, '重试'),
          h('button.btn.ghost', { onclick: () => navigate('#/feed') }, '回广场')
        )
      )
    );
  }
  markActive();
  // 换页后把滚动位置复位，并强制一次布局测量：
  // 视图里大量图片是懒加载的，挂载完成时高度还没定型，
  // 不重新测一次就可能让长页面（比如任务页）底部被裁掉。
  window.scrollTo(0, 0);
  document.documentElement.style.setProperty('--view-h', view.offsetHeight + 'px');
  requestAnimationFrame(() => {
    document.documentElement.style.setProperty('--view-h', view.offsetHeight + 'px');
  });
}

export async function openNotifications() {
  let data;
  try { data = await api.get('/api/notifications'); } catch (e) { return handleError(e); }
  const items = data.items || [];
  const list = items.length
    ? h('div.stack.sm', {}, items.map((n) => h('div.row', { style: { alignItems: 'flex-start', gap: '10px' } },
        h('div', { style: { fontSize: '18px' } }, n.type === 'like' ? '❤️' : n.type === 'comment' ? '💬' : n.type === 'friend' ? '🤝' : n.type === 'friend_request' ? '👋' : '🔔'),
        h('div', { style: { minWidth: 0 } },
          h('div', {}, n.actor ? h('a', { href: '#/u/' + n.actor.handle, style: { fontWeight: 600 } }, n.actor.display) : null, ' ', n.text || ''),
          h('div.small.muted', {}, timeAgo(n.createdAt))
        )
      )))
    : emptyState('🔔', '还没有新消息');
  modal({
    title: '通知',
    body: list,
    actions: [h('button.btn.ghost', { onclick: () => api.post('/api/notifications/read', { all: true }).then(() => { state.unread = 0; refreshChrome(); }) }, '全部已读')],
  });
}

function refreshChrome() {
  renderSidebar();
  renderTabbar();
}

async function boot() {
  await loadSession();
  refreshChrome();
  subscribe(() => refreshChrome());
  document.getElementById('boot')?.classList.add('is-gone');
  document.getElementById('shell').hidden = false;
  setTimeout(() => document.getElementById('boot')?.remove(), 400);
  startRouter(renderView);

  // 通知铃（桌面右下悬浮）
  const bell = h('button.bell-fab', { title: '通知', onclick: openNotifications }, '🔔');
  document.body.appendChild(bell);
  const syncBell = () => {
    bell.classList.toggle('has-unread', state.unread > 0);
    bell.dataset.count = state.unread > 9 ? '9+' : String(state.unread || '');
  };
  syncBell();
  subscribe(syncBell);
  window.addEventListener('hashchange', markActive);
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('boot').replaceChildren(h('div.empty', {}, '🐾 启动失败：' + e.message));
});
