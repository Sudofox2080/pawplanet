// 好友页 · 搜索结果 / 待处理请求 / 我发出的请求 / 我的好友
import {
  h, api, state, avatarEl, pageHead, emptyState, loadingBlock, btn,
  sectionCard, toast, handleError, navigate, debounce, timeAgo, confirmModal,
} from '../lib.js';

const levelNum = (lv) => {
  if (lv && typeof lv === 'object') return lv.level || 1;
  const n = Number(lv);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

const nameOf = (u) => (u && (u.display || u.handle)) || '这位朋友';

export default async function friendsView(ctx) {
  const me = ctx.user || state.user || null;
  const page = h('div.friends-page', {});
  page.appendChild(pageHead('好友', '一起记录毛孩子的日常，互相看看彼此的家', [
    h('a.btn.ghost.sm', { href: '#/explore' }, '去发现更多人'),
    btn('刷新', () => ctx.rerender(), { variant: 'ghost', sm: true }),
  ]));

  const data = { friends: [], incoming: [], outgoing: [] };
  const busy = new Set();
  let loadingFriends = false;

  /* ---------- 搜索 ---------- */
  const input = h('input', {
    type: 'search',
    placeholder: '搜昵称、@handle 或宠物名',
    'aria-label': '搜索用户或宠物',
    autocomplete: 'off',
  });
  const results = h('div.friends-results', { hidden: true });
  const searchCard = h('div.card.friends-search', {},
    h('div.friends-search-head', {},
      h('h3', {}, '找朋友'),
      h('span.small.muted', {}, '输入名字就能找到人和毛孩子')
    ),
    input,
    results
  );
  page.appendChild(searchCard);

  function resultRow(u) {
    const add = h('button.btn.primary.sm', { type: 'button' }, '加好友');
    add.addEventListener('click', () => addFriend(u, add));
    return h('div.friends-result', {},
      avatarEl(u, 40),
      h('div.friends-result-main', {},
        h('div.friends-result-name', {}, nameOf(u)),
        h('div.friends-result-sub', {}, '@' + (u.handle || '') + ' · Lv.' + levelNum(u.level))
      ),
      add
    );
  }

  function renderSearch(d) {
    const users = (d && Array.isArray(d.users)) ? d.users : [];
    const pets = (d && Array.isArray(d.pets)) ? d.pets : [];
    if (!users.length && !pets.length) {
      results.replaceChildren(h('div.friends-none', {}, '没找到匹配的人和毛孩子，换个词试试'));
      return;
    }
    const kids = [];
    if (users.length) kids.push(h('div.friends-result-list', {}, users.map(resultRow)));
    if (pets.length) {
      kids.push(h('div.friends-pets', {},
        h('div.small.muted', {}, '相关的毛孩子'),
        h('div.chip-row', {}, pets.map((p) => h('button.chip', {
          type: 'button',
          onclick: () => { if (p.owner && p.owner.handle) navigate('#/u/' + p.owner.handle); },
        }, '🐾 ' + (p.name || '') + (p.owner && p.owner.display ? ' · ' + p.owner.display + ' 家的' : ''))))
      ));
    }
    results.replaceChildren(...kids);
  }

  async function runSearch() {
    const q = String(input.value || '').trim();
    if (!q) { results.hidden = true; results.replaceChildren(); return; }
    results.hidden = false;
    results.replaceChildren(h('div.small.muted', {}, '正在找…'));
    try {
      const d = await api.get('/api/search?q=' + encodeURIComponent(q));
      if (String(input.value || '').trim() !== q) return;
      renderSearch(d);
    } catch (e) {
      if (String(input.value || '').trim() !== q) return;
      handleError(e);
      results.replaceChildren(h('div.friends-none', {}, '搜索没成功，稍后再试'));
    }
  }
  input.addEventListener('input', debounce(runSearch, 300));

  /* ---------- 加好友 ---------- */
  async function addFriend(u, button) {
    if (busy.has('add:' + u.id)) return;
    busy.add('add:' + u.id);
    button.disabled = true;
    try {
      const r = await api.post('/api/friends/request', { handle: u.handle });
      if (r && r.status === 'accepted') {
        toast('你们已经是好友了', 'ok');
        button.textContent = '已加好友';
        await refresh();
      } else {
        toast('好友请求已发出，等对方回应', 'ok');
        button.textContent = '已申请';
        await refresh();
      }
    } catch (e) {
      if (e.code === 'already_friends') { toast('你们已经是好友了', 'ok'); button.textContent = '已是好友'; }
      else if (e.code === 'pending') { toast('已经发过请求了，等对方回应', 'ok'); button.textContent = '等待中'; }
      else if (e.code === 'self') { toast('这是你自己呀', 'err'); button.disabled = false; }
      else if (e.code === 'not_found') { toast('没有找到这个用户', 'err'); button.disabled = false; }
      else { handleError(e); button.disabled = false; }
    } finally {
      busy.delete('add:' + u.id);
    }
  }

  /* ---------- 请求与好友动作 ---------- */
  async function act(key, button, fn, okMsg) {
    if (busy.has(key)) return;
    busy.add(key);
    button.disabled = true;
    try {
      await fn();
      if (okMsg) toast(okMsg, 'ok');
      await refresh();
    } catch (e) {
      handleError(e);
      button.disabled = false;
    } finally {
      busy.delete(key);
    }
  }

  const acceptOne = (u, button) => act('accept:' + u.id, button, () => api.post('/api/friends/accept', { userId: u.id }), '已经是好友了');
  const rejectOne = (u, button) => act('reject:' + u.id, button, () => api.post('/api/friends/reject', { userId: u.id }), '已经忽略了这条请求');
  const withdrawOne = (u, button) => act('withdraw:' + u.id, button, () => api.del('/api/friends/' + encodeURIComponent(u.id)), '请求已撤回');

  async function removeFriend(u, button) {
    const yes = await confirmModal('删除后就不再是好友，聊天以外的东西都还在，确定吗？', { okText: '删除好友', danger: true });
    if (!yes) return;
    await act('remove:' + u.id, button, () => api.del('/api/friends/' + encodeURIComponent(u.id)), '已经删除好友');
  }

  /* ---------- 区块 ---------- */
  function incomingSection() {
    const list = data.incoming || [];
    const body = list.length
      ? h('div.friends-req-list', {}, list.map((row) => {
          const u = row.user || {};
          const ok = h('button.btn.primary.sm', { type: 'button' }, '接受');
          const no = h('button.btn.ghost.sm', { type: 'button' }, '忽略');
          ok.addEventListener('click', () => { no.disabled = true; acceptOne(u, ok); });
          no.addEventListener('click', () => { ok.disabled = true; rejectOne(u, no); });
          return h('div.friends-req', {},
            avatarEl(u, 44),
            h('div.friends-req-main', {},
              h('div.friends-req-name', {}, nameOf(u)),
              h('div.friends-req-sub', {}, '@' + (u.handle || '') + ' · Lv.' + levelNum(u.level) + (row.createdAt ? ' · ' + timeAgo(row.createdAt) + '发来' : ''))
            ),
            h('div.friends-req-actions', {}, no, ok)
          );
        }))
      : h('div.friends-none', {}, '暂时没有人申请加你，先去搜搜老朋友吧');
    return sectionCard('待处理请求', list.length ? h('span.friends-badge', {}, String(list.length)) : null, body);
  }

  function outgoingSection() {
    const list = data.outgoing || [];
    const body = list.length
      ? h('div.friends-req-list', {}, list.map((row) => {
          const u = row.user || {};
          const undo = h('button.btn.ghost.sm', { type: 'button' }, '撤销');
          undo.addEventListener('click', () => withdrawOne(u, undo));
          return h('div.friends-req', {},
            avatarEl(u, 40),
            h('div.friends-req-main', {},
              h('div.friends-req-name', {}, nameOf(u)),
              h('div.friends-req-sub', {}, '等待中 · ' + (row.createdAt ? timeAgo(row.createdAt) + '发出' : '已发出'))
            ),
            h('div.friends-req-actions', {}, undo)
          );
        }))
      : h('div.friends-none', {}, '没有正在等待的请求');
    return sectionCard('我发出的请求', null, body);
  }

  function friendCard(u) {
    const home = h('button.btn.ghost.sm', { type: 'button' }, '看主页');
    home.addEventListener('click', () => navigate('#/u/' + u.handle));
    const del = h('button.btn.ghost.sm.danger', { type: 'button' }, '删除好友');
    del.addEventListener('click', () => removeFriend(u, del));
    const stats = u.stats || {};
    return h('div.friends-card', {},
      h('div.friends-card-head', {},
        avatarEl(u, 52),
        h('div.friends-card-id', {},
          h('div.friends-card-name', {}, nameOf(u)),
          h('div.friends-card-handle', {}, '@' + (u.handle || ''))
        )
      ),
      u.bio ? h('div.friends-card-bio', {}, u.bio) : null,
      h('div.friends-card-stats', {},
        h('span', {}, 'Lv.' + levelNum(u.level)),
        h('span', {}, (Number(stats.posts) || 0) + ' 条动态'),
        h('span', {}, (Number(stats.pets) || 0) + ' 只毛孩子')
      ),
      h('div.friends-card-actions', {}, home, del)
    );
  }

  function friendsSection() {
    const list = data.friends || [];
    const body = list.length
      ? h('div.friends-grid', {}, list.map(friendCard))
      : emptyState('🤝', '还没有好友，用上面的搜索框找找看', h('a.btn.primary.sm', { href: '#/explore' }, '去发现'));
    return sectionCard('我的好友', list.length ? h('span.small.muted', {}, list.length + ' 位') : null, body);
  }

  const sections = h('div.stack', {}, loadingBlock('正在读取好友…'));
  page.appendChild(sections);

  function render() {
    sections.replaceChildren(incomingSection(), outgoingSection(), friendsSection());
  }

  async function refresh() {
    if (loadingFriends) return;
    loadingFriends = true;
    try {
      const d = await api.get('/api/friends');
      data.friends = (d && d.friends) || [];
      data.incoming = (d && d.incoming) || [];
      data.outgoing = (d && d.outgoing) || [];
      render();
    } catch (e) {
      handleError(e);
      sections.replaceChildren(h('div.card', {},
        emptyState('😿', '好友列表没读出来', btn('重新加载', () => ctx.rerender(), { variant: 'ghost', sm: true }))
      ));
    } finally {
      loadingFriends = false;
    }
  }

  if (!me) {
    sections.replaceChildren(h('div.card', {}, emptyState('🙈', '登录后才能加好友', h('a.btn.primary.sm', { href: '#/login' }, '去登录'))));
    return page;
  }

  await refresh();
  return page;
}
