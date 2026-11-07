// 发现页：搜毛家长、搜毛孩子；没搜索词的时候看热门
import {
  h, api, state, avatarEl, emptyState, loadingBlock, toast,
  timeAgo, speciesOf, navigate, debounce, handleError,
} from '../lib.js';

const looksLikeUrl = (v) => typeof v === 'string'
  && (/^(https?:)?\/\//.test(v) || v.startsWith('/') || v.startsWith('data:') || v.startsWith('blob:'));
const picUrl = (v) => (looksLikeUrl(v) ? v : null);

function face(o, size) {
  const name = (o && (o.display || o.name || o.handle)) || '？';
  return avatarEl({ name, avatar: picUrl(o && o.avatar) }, size);
}

const ICON_SEARCH = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.2"/><path d="M15.2 15.2 20 20"/></svg>';

export default async function search(ctx) {
  const me = ctx.user || state.user || null;
  const startQ = (ctx.query && ctx.query.q) || '';
  let q = startQ;
  let seq = 0;
  let lastCommitted = null;

  const root = h('div.search');

  /* ---------- 顶部 ---------- */
  const input = h('input', {
    type: 'search',
    class: 'search-input',
    placeholder: '搜名字、账号，或者一只猫的名字',
    autocomplete: 'off',
    value: startQ,
  });
  const clearBtn = h('button.search-clear', { type: 'button', title: '清空', hidden: !startQ }, '×');

  const bar = h('div.search-bar', {},
    h('span.search-bar-icon', { html: ICON_SEARCH }),
    input,
    clearBtn
  );

  const body = h('div.search-body');

  root.appendChild(h('section.search-hero', {},
    h('h1.search-title', {}, '发现'),
    h('p.search-lead', {}, '在星球上找到气味相投的家长，和一只让你多看两眼的小家伙。'),
    bar
  ));
  root.appendChild(body);

  /* ---------- 搜索 ---------- */
  function syncUrl(value) {
    const hash = value ? '#/explore?q=' + encodeURIComponent(value) : '#/explore';
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  async function runSearch(value) {
    const mine = ++seq;
    lastCommitted = value;
    syncUrl(value);
    clearBtn.hidden = !value;
    if (!value) { renderIdle(); return; }

    body.replaceChildren(loadingBlock('正在星球上找…'));
    try {
      const d = await api.get('/api/search?q=' + encodeURIComponent(value));
      if (mine !== seq) return;
      renderResults((d && d.users) || [], (d && d.pets) || [], value);
    } catch (e) {
      if (mine !== seq) return;
      body.replaceChildren(h('div.search-idle', {},
        emptyState('🔍', '搜索暂时没响应，过一会儿再试试'),
        h('div.search-tips', {}, h('a.search-tip', { href: '#/feed' }, '先去广场逛逛'))
      ));
      handleError(e);
    }
  }

  function renderResults(users, pets, value) {
    const parts = [];
    if (!users.length && !pets.length) {
      parts.push(h('div.search-idle', {},
        emptyState('🐾', '没找到和「' + value + '」有关的家长或毛孩子', h('a.search-tip', { href: '#/explore' }, '清空换个词'))
      ));
      body.replaceChildren(...parts);
      return;
    }

    if (users.length) {
      parts.push(h('section.search-sec', {},
        h('header.search-sec-head', {},
          h('h2.search-sec-title', {}, '毛家长'),
          h('span.search-count', {}, users.length + ' 位')
        ),
        h('div.search-grid', {}, ...users.map(userCard))
      ));
    }
    if (pets.length) {
      parts.push(h('section.search-sec', {},
        h('header.search-sec-head', {},
          h('h2.search-sec-title', {}, '毛孩子'),
          h('span.search-count', {}, pets.length + ' 只')
        ),
        h('div.search-grid', {}, ...pets.map(petCard))
      ));
    }
    body.replaceChildren(...parts);
  }

  /* ---------- 卡片 ---------- */
  function userCard(u) {
    const self = me && me.id === u.id;
    const card = h('div.search-user', {},
      face(u, 46),
      h('div.search-user-main', {},
        h('div.search-user-name', {}, u.display || u.handle),
        h('div.search-user-handle', {},
          '@' + u.handle,
          typeof u.level === 'number' ? h('span.search-user-lv', {}, 'Lv.' + u.level) : null
        )
      ),
      addBtn(u, self)
    );
    card.addEventListener('click', () => navigate('#/u/' + encodeURIComponent(u.handle)));
    return card;
  }

  function addBtn(u, self) {
    if (self) return h('span.search-user-self', {}, '你');
    if (!me) return null;
    const b = h('button.search-add', { type: 'button' }, '加好友');
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (b.disabled) return;
      b.disabled = true;
      b.textContent = '发送中…';
      try {
        const d = await api.post('/api/friends/request', { handle: u.handle });
        if (d && d.status === 'accepted') {
          b.textContent = '已是好友';
          toast('你们本来就想加对方，直接成好友了', 'ok');
        } else {
          b.textContent = '已发送';
          toast('好友请求发出去了', 'ok');
        }
      } catch (err) {
        const code = err && err.code;
        if (code === 'already_friends') { b.textContent = '已是好友'; toast('你们已经是好友了', 'ok'); }
        else if (code === 'pending') { b.textContent = '已发送'; toast('请求已经发过了，等对方回应', 'ok'); }
        else if (code === 'self') { b.textContent = '你'; toast('那是你自己', 'err'); }
        else {
          b.disabled = false;
          b.textContent = '加好友';
          handleError(err);
        }
      }
    });
    return b;
  }

  function petCard(p) {
    const sp = speciesOf(p.species);
    const owner = p.owner || {};
    const card = h('div.search-pet', {},
      face(p, 46),
      h('div.search-pet-main', {},
        h('div.search-pet-name', {}, p.name),
        h('div.search-pet-meta', {},
          sp.emoji + ' ' + sp.label,
          owner.handle ? h('span.search-pet-owner', {}, ' · ' + (owner.display || owner.handle)) : null
        )
      )
    );
    if (owner.handle) card.addEventListener('click', () => navigate('#/u/' + encodeURIComponent(owner.handle)));
    return card;
  }

  /* ---------- 没搜索词：热门 ---------- */
  const hotBox = h('div.search-hot');

  async function renderIdle() {
    body.replaceChildren(h('section.search-sec', {},
      h('header.search-sec-head', {},
        h('h2.search-sec-title', {}, '星球上正热乎的'),
        h('a.search-more', { href: '#/hot' }, '看更多')
      ),
      hotBox,
      h('div.search-tips', {},
        h('span.search-tips-label', {}, '试试搜'),
        ...[['豆豆', '豆豆'], ['柯基', '柯基'], ['爱丽丝', '爱丽丝']].map(([label, term]) =>
          h('button.search-tip', { type: 'button', onclick: () => { input.value = term; q = term; runSearch(term); } }, label))
      )
    ));

    hotBox.replaceChildren(loadingBlock('看看大家在发什么…'));
    try {
      const d = await api.get('/api/hot');
      const items = (d && d.items) || [];
      if (!items.length) {
        hotBox.replaceChildren(emptyState('🌱', '星球还安静着，发第一条动态就是元老了', h('a.search-tip', { href: '#/feed' }, '去广场看看')));
        return;
      }
      hotBox.replaceChildren(h('div.search-hot-list', {}, ...items.slice(0, 6).map(hotRow)));
    } catch (e) {
      // 热门拿不到不是错误，静默退成引导文案
      hotBox.replaceChildren(h('p.search-quiet', {}, '热门暂时没拉到。上面搜个名字，或者去广场看看大家最近的日常。'));
    }
  }

  function hotRow(post) {
    const u = post.user || {};
    const thumbSrc = post.assets && post.assets.length
      ? (post.assets[0].thumb || post.assets[0].url || null)
      : null;
    return h('a.search-hot-item', { href: '#/post/' + encodeURIComponent(post.id) },
      h('div.search-hot-main', {},
        h('div.search-hot-head', {},
          face(u, 28),
          h('span.search-hot-name', {}, u.display || u.handle || '有人'),
          u.handle ? h('span.search-hot-handle', {}, '@' + u.handle) : null,
          h('span.search-hot-time', {}, timeAgo(post.createdAt))
        ),
        h('p.search-hot-body', {}, post.body || '（只有图片）'),
        h('div.search-hot-meta', {},
          '♥ ' + (post.likes || 0),
          ' · ' + (post.comments || 0) + ' 条评论',
          post.pet && post.pet.name ? ' · ' + post.pet.name : ''
        )
      ),
      thumbSrc ? h('div.search-hot-thumb', {}, h('img', { src: thumbSrc, alt: '', loading: 'lazy' })) : null
    );
  }

  /* ---------- 输入联动 ---------- */
  // 防抖回调读的是「此刻输入框里的值」，这样清空之后残留的计时器不会把旧词又搜回来
  const debounced = debounce(() => {
    const v = input.value.trim();
    if (v === lastCommitted) return;
    runSearch(v);
  }, 260);

  input.addEventListener('input', () => {
    q = input.value.trim();
    clearBtn.hidden = !input.value;
    debounced(q);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      q = input.value.trim();
      runSearch(q);
    }
    if (e.key === 'Escape') {
      input.value = '';
      q = '';
      runSearch('');
    }
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    q = '';
    runSearch('');
    input.focus();
  });

  // 首屏：有 q 直接搜，没有就热门
  if (startQ) runSearch(startQ);
  else { q = ''; renderIdle(); }
  setTimeout(() => { input.focus(); if (startQ) input.setSelectionRange(startQ.length, startQ.length); }, 40);

  return root;
}
