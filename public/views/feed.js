// 广场 / 热门 信息流
import {
  h, api, state, pageHead, emptyState, loadingBlock, avatarEl, toast, handleError, navigate, debounce,
} from '../lib.js';
import { postCard } from './_postcard.js';

const TABS = [
  { key: 'all', label: '全部', icon: '🌏', auth: false },
  { key: 'friends', label: '好友', icon: '🤝', auth: true },
  { key: 'hot', label: '热门', icon: '🔥', auth: false },
  { key: 'mine', label: '我的', icon: '🐾', auth: true },
  { key: 'like', label: '我赞过', icon: '❤️', auth: true },
];

export default async function feedView(ctx) {
  const initialTab = ctx.query.tab === 'hot' ? 'hot' : (ctx.query.tab || 'all');
  let tab = TABS.some((t) => t.key === initialTab) ? initialTab : 'all';
  let items = [];
  let cursor = null;
  let loading = false;
  let done = false;
  let petFilter = ctx.query.petId || '';

  const listEl = h('div.feed-list.stack');
  const sentinel = h('div.feed-sentinel');
  const endNote = h('div.feed-end.small.muted', {}, '');

  const tabRow = h('div.chip-row.feed-tabs');
  const renderTabs = () => {
    tabRow.replaceChildren(...TABS
      .filter((t) => !t.auth || state.user)
      .map((t) => h('button.chip' + (t.key === tab ? '.is-active' : ''), {
        onclick: () => { if (tab === t.key) return; tab = t.key; renderTabs(); reload(); },
      }, t.icon + ' ' + t.label)));
  };
  renderTabs();

  const composer = state.user ? h('div.card.composer-teaser', {},
    avatarEl(state.user, 40),
    h('a.composer-fake', { href: '#/create' }, '分享今天和毛孩子的瞬间…'),
    h('a.btn.primary.sm', { href: '#/create' }, '＋ 发布')
  ) : h('div.card.feed-guest', {},
    h('div.stack.sm', {},
      h('h3', {}, '登录后就能发动态、加好友、攒经验'),
      h('div.small.muted', {}, '看看大家家的毛孩子也不错。'),
      h('div.row', {},
        h('a.btn.primary.sm', { href: '#/register' }, '免费注册'),
        h('a.btn.ghost.sm', { href: '#/login' }, '已有账号')
      )
    )
  );

  async function loadMore() {
    if (loading || done) return;
    loading = true;
    try {
      let data;
      if (tab === 'hot') {
        const r = await api.get('/api/hot');
        items = items.concat(r.items || []);
        done = true;
      } else {
        const qs = new URLSearchParams({ tab, limit: '12' });
        if (cursor) qs.set('cursor', cursor);
        if (petFilter) qs.set('petId', petFilter);
        data = await api.get('/api/feed?' + qs.toString());
        items = items.concat(data.items || []);
        cursor = data.nextCursor;
        if (!cursor || !data.items || !data.items.length) done = true;
      }
      render();
    } catch (e) {
      handleError(e);
      done = true;
      endNote.textContent = '加载失败，点这里重试';
      endNote.style.cursor = 'pointer';
      endNote.onclick = () => { done = false; endNote.textContent = ''; loadMore(); };
    } finally {
      loading = false;
    }
  }

  function render() {
    listEl.replaceChildren();
    if (!items.length) {
      listEl.appendChild(emptyState('🌾',
        tab === 'friends' ? '好友圈还静悄悄，去加几个好友吧' :
        tab === 'mine' ? '你还没有发过动态' :
        tab === 'like' ? '还没有点赞过任何动态' : '这里还没有内容',
        state.user && tab !== 'like' ? h('a.btn.sm.primary', { href: '#/create' }, '去发第一条') : h('a.btn.sm.ghost', { href: '#/explore' }, '去发现毛家长')
      ));
      endNote.textContent = '';
      return;
    }
    for (const post of items) {
      listEl.appendChild(postCard(post, {
        onDeleted: (p) => { items = items.filter((x) => x.id !== p.id); render(); },
        onReposted: () => reload(),
      }));
    }
  }

  async function reload() {
    items = []; cursor = null; done = false; endNote.textContent = '';
    listEl.replaceChildren(loadingBlock());
    await loadMore();
    if (!done) observe();
  }

  let io = null;
  function observe() {
    if (io) io.disconnect();
    io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin: '600px' });
    io.observe(sentinel);
  }

  const root = h('div.feed-page', {},
    pageHead(tab === 'hot' ? '热门' : '广场',
      '毛孩子的今天，都在这里',
      state.user ? [h('a.btn.ghost.sm', { href: '#/explore' }, '🔍 找人')] : [h('a.btn.ghost.sm', { href: '#/register' }, '加入爪爪星球')]
    ),
    tabRow,
    composer,
    listEl,
    sentinel,
    endNote
  );

  await loadMore();
  if (!done) observe();
  // 页面切换后清理观察器
  const mo = new MutationObserver(() => {
    if (!document.body.contains(root)) { if (io) io.disconnect(); mo.disconnect(); }
  });
  mo.observe(document.getElementById('view'), { childList: true });

  return root;
}
