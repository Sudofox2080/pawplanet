// 爪爪星球 · 用户主页 /u/:handle
// 数据：GET /api/users/:handle → { user, level, pets, relation, counts }
import {
  h, api, avatarEl, photoFrame, xpBar, emptyState, loadingBlock, btn, field,
  visPill, timeAgo, fmtDate, speciesOf, recordType, toast, modal,
  handleError, navigate, uploadFile, SPECIES,
} from '../lib.js';
import { openLightbox } from './_lightbox.js';

/* ---------------- 等级曲线（本地兜底） ---------------- */
const MAX_LEVEL = 60;
const LEVEL_TITLES = [
  [50, '宇宙级毛家长'], [40, '传说铲屎官'], [30, '星球守护者'], [20, '治愈系大佬'],
  [15, '毛孩子摄影师'], [10, '星球居民'], [6, '记录达人'], [3, '遛狗学徒'], [1, '新手铲屎官'],
];
const xpForLevel = (n) => 50 * Math.pow(Math.max(1, n) - 1, 2);

function titleFor(level) {
  const n = Number(level) || 1;
  for (const pair of LEVEL_TITLES) if (n >= pair[0]) return pair[1];
  return '新手铲屎官';
}

// 接口在 data.level 里给了完整等级对象；没有就按 xpForLevel 本地推
function levelInfo(user, raw) {
  const xp = Number((user && user.xp) || 0);
  if (raw && typeof raw === 'object' && typeof raw.level === 'number' && Number(raw.needLevel) > 0) {
    const need = Number(raw.needLevel);
    const into = Number(raw.intoLevel) || 0;
    return {
      level: raw.level,
      title: raw.title || titleFor(raw.level),
      xp: Number(raw.xp == null ? xp : raw.xp),
      intoLevel: into,
      needLevel: need,
      progress: typeof raw.progress === 'number' ? raw.progress : Math.min(1, into / need),
    };
  }
  let level = Math.min(MAX_LEVEL, Math.max(1, Number((user && user.level) || 1)));
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level += 1;
  const base = xpForLevel(level);
  const need = level >= MAX_LEVEL ? Math.max(1, xp - base || 1) : xpForLevel(level + 1) - base;
  const into = Math.max(0, xp - base);
  return { level, title: titleFor(level), xp, intoLevel: into, needLevel: need, progress: Math.min(1, into / need) };
}

/* ---------------- 小工具 ---------------- */
const enc = (v) => encodeURIComponent(String(v == null ? '' : v));
const people = (n) => (Number(n) || 0).toLocaleString('zh-CN');

function clip(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/* ---------------- 动态卡片 ---------------- */
function postCard(post, isSelf) {
  const assets = Array.isArray(post.assets) ? post.assets : [];
  const open = () => navigate('#/post/' + enc(post.id));
  const pet = post.pet ? speciesOf(post.pet.species) : null;

  return h('article.profile-post', {
    role: 'link',
    tabindex: '0',
    'aria-label': '查看动态详情',
    onclick: (e) => {
      // 点图片放大，点其它地方进详情
      if (e.target.closest('.photo-frame')) return;
      open();
    },
    onkeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); open(); }
    },
  },
    h('div.profile-post-head', {},
      avatarEl(post.user || {}, 42),
      h('div.profile-post-who', {},
        h('div.profile-post-name', {}, (post.user && (post.user.display || post.user.handle)) || '某位铲屎官'),
        h('div.small.muted', {}, timeAgo(post.createdAt))
      ),
      h('div.spacer'),
      isSelf ? visPill(post.visibility) : null
    ),
    post.body ? h('p.profile-post-body', {}, post.body) : null,
    assets.length
      ? h('div.profile-media' + (assets.length === 1 ? '.single' : ''), {},
          assets.slice(0, 4).map((a, i) => photoFrame(a, { rounded: true, onOpen: () => openLightbox(assets, i) })))
      : null,
    h('div.profile-post-foot', {},
      pet ? h('span.profile-post-pet', {}, pet.emoji + ' ' + post.pet.name) : null,
      h('div.spacer'),
      h('span', {}, people(post.likes) + ' 个赞'),
      h('span', {}, people(post.comments) + ' 条评论')
    )
  );
}

/* ---------------- 记录时间线 ---------------- */
function recordRow(rec) {
  const type = recordType(rec.type);
  return h('div.profile-tl-row', {},
    h('div.profile-tl-dot', { style: { background: type.color + '1F', color: type.color } }, type.emoji),
    h('div.profile-tl-main', {},
      h('div.profile-tl-title', {}, rec.title || type.label),
      h('div.small.muted', {},
        [rec.pet && rec.pet.name, timeAgo(rec.ts || rec.createdAt)].filter(Boolean).join(' · '))
    )
  );
}

function diaryRow(entry, handle) {
  const text = clip(entry.excerpt || entry.content || '', 110);
  return h('button.profile-diary', {
    type: 'button',
    onclick: () => navigate('#/u/' + enc(handle) + '/journal'),
  },
    h('div.profile-diary-top', {},
      h('div.profile-diary-title', {}, entry.title || '无题'),
      entry.mood ? h('span.profile-mood', {}, entry.mood) : null
    ),
    text ? h('div.profile-diary-text', {}, text) : null,
    h('div.small.muted', {}, fmtDate(entry.date || entry.createdAt))
  );
}

/* ---------------- 三个标签页 ---------------- */
function postsTab(ctx, handle, isSelf) {
  const wrap = h('div.profile-feed');
  const list = h('div.profile-postlist');
  const more = btn('看更早的动态', () => load(cursor), { variant: 'ghost', block: true });
  const moreBox = h('div.profile-more', { hidden: true }, more);
  wrap.append(list, moreBox);

  let cursor = null;
  let busy = false;

  async function load(c) {
    if (busy) return;
    busy = true;
    if (!c) more.disabled = true;
    let spin = null;
    if (!list.childElementCount) {
      spin = loadingBlock('正在翻动态…');
      list.appendChild(spin);
    }
    try {
      const url = '/api/users/' + enc(handle) + '/posts?limit=8' + (c ? '&cursor=' + enc(c) : '');
      const data = await api.get(url);
      if (spin) { list.replaceChildren(); spin = null; }
      const items = (data && data.items) || [];
      if (!items.length && !c) {
        list.appendChild(emptyState('📝',
          isSelf ? '还没发过动态，写一条让大家看看毛孩子吧' : '这里还没有公开的动态',
          isSelf ? btn('去发动态', () => navigate('#/create'), { variant: 'primary', sm: true }) : null));
      }
      for (const post of items) list.appendChild(postCard(post, isSelf));
      cursor = (data && data.nextCursor) || null;
      moreBox.hidden = !cursor;
    } catch (e) {
      if (spin) { list.replaceChildren(); spin = null; }
      handleError(e);
      if (!list.childElementCount) list.appendChild(h('div.empty', {}, '动态没加载出来'));
    }
    busy = false;
    more.disabled = false;
  }

  load(null);
  return wrap;
}

function recordsTab(ctx, handle) {
  const wrap = h('div.profile-tabpad');
  wrap.appendChild(loadingBlock('正在找记录…'));

  (async () => {
    try {
      const data = await api.get('/api/users/' + enc(handle) + '/records');
      const items = (data && data.items) || [];
      wrap.replaceChildren();
      if (!items.length) {
        wrap.appendChild(emptyState('🗂️', '还没有记录，遛狗、驱虫、体检都值得记下来'));
        return;
      }
      wrap.append(
        h('div.profile-note', {},
          h('span', {}, '最近 ' + items.length + ' 条'),
          btn('查看全部记录', () => navigate('#/u/' + enc(handle) + '/records'), { variant: 'ghost', sm: true })
        ),
        h('div.profile-timeline', {}, items.slice(0, 8).map(recordRow))
      );
    } catch (e) {
      wrap.replaceChildren();
      handleError(e);
      wrap.appendChild(h('div.empty', {}, '记录没加载出来'));
    }
  })();

  return wrap;
}

function diaryTab(ctx, handle) {
  const wrap = h('div.profile-tabpad');
  wrap.appendChild(loadingBlock('正在翻日记…'));

  (async () => {
    try {
      const data = await api.get('/api/users/' + enc(handle) + '/diary');
      const items = (data && data.items) || [];
      wrap.replaceChildren();
      if (!items.length) {
        wrap.appendChild(emptyState('📖', '还没有日记，今天的心情也可以写下来'));
        return;
      }
      wrap.append(
        h('div.profile-note', {},
          h('span', {}, '最近 ' + items.length + ' 篇'),
          btn('去日记本', () => navigate('#/u/' + enc(handle) + '/journal'), { variant: 'ghost', sm: true })
        ),
        h('div.profile-diarylist', {}, items.slice(0, 6).map((d) => diaryRow(d, handle)))
      );
    } catch (e) {
      wrap.replaceChildren();
      handleError(e);
      wrap.appendChild(h('div.empty', {}, '日记没加载出来'));
    }
  })();

  return wrap;
}

/* ---------------- 管理宠物弹窗 ---------------- */
function openPetsModal(ctx, pets, handle, onChanged) {
  let items = Array.isArray(pets) ? pets.slice() : [];
  let avatarUrl = '';
  let busy = false;

  const listBox = h('div.profile-petlist');
  const formBox = h('form.profile-petform', { hidden: true });

  const nameIn = h('input', { type: 'text', maxlength: '20', placeholder: '比如 豆豆', autocomplete: 'off' });
  const speciesSel = h('select', {}, SPECIES.map((s) => h('option', { value: s.value, selected: s.value === 'dog' }, s.emoji + ' ' + s.label)));
  const breedIn = h('input', { type: 'text', maxlength: '30', placeholder: '柯基、英短、垂耳兔…' });
  const genderSel = h('select', {},
    h('option', { value: '', selected: true }, '先不填'),
    h('option', { value: 'male' }, '公'),
    h('option', { value: 'female' }, '母')
  );
  const birthIn = h('input', { type: 'date' });
  const bioIn = h('input', { type: 'text', maxlength: '60', placeholder: '一句话介绍这位毛孩子' });
  const avatarIn = h('input', { type: 'file', accept: 'image/*' });
  const avatarPrev = h('div.profile-avatar-prev', {}, h('span.small.muted', {}, '未上传'));
  const saveBtn = h('button.btn.primary.sm', { type: 'submit' }, '保存');

  const drawList = () => {
    listBox.replaceChildren();
    if (!items.length) {
      listBox.appendChild(h('div.small.muted', {}, '还没有宠物，先添加一只吧'));
      return;
    }
    for (const p of items) {
      const sp = speciesOf(p.species);
      const go = () => {
        m.close();
        navigate('#/u/' + enc(handle) + '/records?petId=' + enc(p.id));
      };
      listBox.appendChild(h('div.profile-petrow', {},
        h('div.profile-petrow-emoji', {}, sp.emoji),
        h('div.profile-petrow-main', {},
          h('div.profile-petrow-name', {}, p.name),
          h('div.small.muted', {}, [sp.label, p.breed, p.birthday].filter(Boolean).join(' · '))
        ),
        btn('看记录', go, { variant: 'ghost', sm: true })
      ));
    }
  };

  avatarIn.addEventListener('change', async () => {
    const file = avatarIn.files && avatarIn.files[0];
    if (!file) return;
    avatarPrev.replaceChildren(h('span.small.muted', {}, '上传中…'));
    try {
      const data = await uploadFile(file, 'avatar');
      avatarUrl = (data && data.asset && data.asset.url) || '';
      if (!avatarUrl) { avatarPrev.replaceChildren(h('span.small.muted', {}, '没拿到图片地址')); return; }
      avatarPrev.replaceChildren(avatarEl({ display: nameIn.value || '毛孩子', avatar: avatarUrl }, 44));
      toast('头像传好了', 'ok');
    } catch (e) {
      avatarPrev.replaceChildren(h('span.small.muted', {}, '未上传'));
      handleError(e);
    }
  });

  const toggleForm = btn('＋ 新建宠物', () => {
    formBox.hidden = !formBox.hidden;
    toggleForm.textContent = formBox.hidden ? '＋ 新建宠物' : '收起表单';
    if (!formBox.hidden) nameIn.focus();
  }, { variant: 'ghost', sm: true });

  formBox.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const name = nameIn.value.trim();
    if (!name) { toast('先给毛孩子起个名字吧'); nameIn.focus(); return; }
    busy = true;
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      const payload = {
        name,
        species: speciesSel.value,
        breed: breedIn.value.trim(),
        gender: genderSel.value || '',
        birthday: birthIn.value || null,
        avatar: avatarUrl || null,
        bio: bioIn.value.trim(),
      };
      const data = await api.post('/api/pets', payload);
      const pet = (data && data.pet) || null;
      if (pet) items.push(pet);
      drawList();
      formBox.reset();
      avatarUrl = '';
      avatarPrev.replaceChildren(h('span.small.muted', {}, '未上传'));
      formBox.hidden = true;
      toggleForm.textContent = '＋ 新建宠物';
      toast('「' + name + '」已加入星球', 'ok');
      if (onChanged) onChanged(items);
    } catch (err) {
      handleError(err);
    }
    busy = false;
    saveBtn.disabled = false;
    saveBtn.textContent = '保存';
  });

  formBox.append(
    field('名字', nameIn),
    h('div.form-grid.two', {},
      field('类别', speciesSel),
      field('品种', breedIn)
    ),
    h('div.form-grid.two', {},
      field('性别', genderSel),
      field('生日', birthIn)
    ),
    field('头像（可选）', avatarIn, '上传一张照片，列表里会显示'),
    field('一句话介绍', bioIn),
    avatarPrev,
    h('div.row', { style: { justifyContent: 'flex-end' } }, saveBtn)
  );

  drawList();

  const m = modal({
    title: '管理宠物',
    wide: true,
    body: h('div.stack', {},
      listBox,
      h('div.row.between', { style: { alignItems: 'center' } }, toggleForm),
      formBox
    ),
    actions: [h('button.btn.ghost', { onclick: () => m.close() }, '完成')],
  });

  return m;
}

/* ---------------- 主页主体 ---------------- */
export default async function profile(ctx) {
  const handle = String((ctx.params && ctx.params.handle) || '').trim();
  if (!handle) return emptyState('🐾', '这个主页地址不完整');

  let data;
  try {
    data = await api.get('/api/users/' + enc(handle));
  } catch (e) {
    if (e && (e.code === 'not_found' || e.status === 404)) {
      return h('div.profile-page',
        emptyState('🔍', '没有这个用户，可能链接写错了',
          btn('回广场看看', () => navigate('#/feed'), { variant: 'primary', sm: true }))
      );
    }
    handleError(e);
    return h('div.profile-page',
      emptyState('😿', '主页没加载出来',
        btn('重试', () => ctx.rerender(), { variant: 'primary', sm: true }))
    );
  }

  const user = (data && data.user) || {};
  const rel = (data && data.relation) || {};
  const isSelf = !!(rel.isSelf || (ctx.user && user.id && ctx.user.id === user.id));
  const level = levelInfo(user, data && data.level);
  const pets = Array.isArray(data && data.pets) ? data.pets : [];
  const stats = user.stats || {};
  // counts.posts 是按可见性算的；本人看自己用 stats 更准
  const postCount = isSelf ? Number(stats.posts || 0) : Number(stats.posts || (data.counts && data.counts.posts) || 0);
  const shownPostCount = Number((data.counts && data.counts.posts) || postCount);
  const displayCount = isSelf ? postCount : shownPostCount;

  /* ---- 好友 / 自己 操作区 ---- */
  async function addFriend(el) {
    if (el.disabled) return;
    const label = el.textContent;
    el.disabled = true;
    el.textContent = '发送中…';
    try {
      await api.post('/api/friends/request', { handle: user.handle || handle });
      toast('好友申请发出去了，等 ta 点头', 'ok');
      ctx.rerender();
    } catch (e) {
      handleError(e);
      el.disabled = false;
      el.textContent = label;
    }
  }

  async function acceptRequest(el) {
    if (el.disabled) return;
    const label = el.textContent;
    el.disabled = true;
    el.textContent = '处理中…';
    try {
      await api.post('/api/friends/accept', { userId: user.id });
      toast('你们成为好友啦，可以互相看完整记录', 'ok');
      ctx.rerender();
    } catch (e) {
      handleError(e);
      el.disabled = false;
      el.textContent = label;
    }
  }

  function actions() {
    if (isSelf) {
      return h('div.profile-actions', {},
        btn('编辑资料', () => navigate('#/settings'), { variant: 'ghost', sm: true }),
        btn('发动态', () => navigate('#/create'), { sm: true }),
        btn('管理宠物', () => openPetsModal(ctx, pets, user.handle || handle, () => ctx.rerender()), { variant: 'sage', sm: true })
      );
    }
    if (rel.blocked) {
      return h('div.profile-actions', {}, h('span.profile-hint', {}, '这位铲屎官暂时不接收互动'));
    }
    if (rel.isFriend) {
      return h('div.profile-actions', {}, h('button.btn.ghost.sm', { type: 'button', disabled: true }, '已是好友'));
    }
    if (rel.outgoing) {
      return h('div.profile-actions', {}, h('button.btn.ghost.sm', { type: 'button', disabled: true }, '已申请'));
    }
    if (rel.incoming) {
      return h('div.profile-actions', {},
        btn('接受请求', (e) => acceptRequest(e.currentTarget), { variant: 'sage', sm: true }));
    }
    if (!ctx.user) {
      return h('div.profile-actions', {},
        btn('加好友', () => navigate('#/login'), { variant: 'primary', sm: true }));
    }
    return h('div.profile-actions', {},
      btn('加好友', (e) => addFriend(e.currentTarget), { variant: 'primary', sm: true }));
  }

  /* ---- 封面 + 头像 + 身份 ---- */
  const cover = h('div.profile-cover' + (user.cover ? '' : '.is-plain'),
    user.cover ? h('img', { src: user.cover, alt: '' }) : null
  );

  const heroBody = h('div.profile-hero-body', {},
    h('div.profile-topline', {},
      h('div.profile-avatar', {}, avatarEl(user, 92)),
      actions()
    ),
    h('div.profile-identity', {},
      h('h1.profile-name', {}, user.display || user.handle || '这位铲屎官'),
      h('div.profile-idline', {},
        h('span.profile-handle', {}, '@' + (user.handle || handle)),
        h('span.profile-lv', {}, 'Lv.' + level.level),
        h('span.profile-title', {}, level.title)
      ),
      h('p.profile-bio' + (user.bio ? '' : '.is-empty'), {},
        user.bio || (isSelf ? '还没写简介，说说你和毛孩子的故事吧' : '这位铲屎官还没留下简介')),
      h('div.profile-since', {}, '加入于 ' + fmtDate(user.createdAt))
    ),
    h('div.profile-xp', {},
      xpBar(level, { showText: false }),
      h('div.row.between.small.muted', {},
        h('span', {}, people(level.intoLevel) + ' / ' + people(level.needLevel) + ' XP'),
        h('span', {}, level.level >= MAX_LEVEL
          ? '已经满级，毛孩子界的老前辈'
          : '距离 Lv.' + (level.level + 1) + ' 还差 ' + people(Math.max(0, level.needLevel - level.intoLevel)) + ' XP')
      )
    )
  );

  /* ---- 统计 + 标签 ---- */
  const tabBody = h('div.profile-tabbody');
  const tabBar = h('div.profile-tabs', { role: 'tablist' });
  const cache = new Map();
  let activeTab = '';

  const buildTab = (key) => {
    let node;
    if (key === 'records') node = recordsTab(ctx, user.handle || handle);
    else if (key === 'diary') node = diaryTab(ctx, user.handle || handle);
    else node = postsTab(ctx, user.handle || handle, isSelf);
    cache.set(key, node);
    return node;
  };

  const selectTab = (key) => {
    if (activeTab === key) return;
    activeTab = key;
    for (const b of Array.from(tabBar.children)) b.classList.toggle('is-active', b.dataset.tab === key);
    tabBody.replaceChildren(cache.get(key) || buildTab(key));
  };

  const TABS = [
    { key: 'posts', label: '动态', value: displayCount },
    { key: 'records', label: '记录', value: Number(stats.records || 0) },
    { key: 'diary', label: '日记', value: Number(stats.entries || 0) },
  ];

  for (const t of TABS) {
    tabBar.appendChild(h('button.profile-tab', {
      type: 'button',
      dataset: { tab: t.key },
      role: 'tab',
      onclick: () => selectTab(t.key),
    }, h('span', {}, t.label), h('span.profile-tab-num', {}, people(t.value))));
  }

  const statsBar = h('div.profile-stats', {},
    h('button.profile-stat', { type: 'button', onclick: () => selectTab('posts') },
      h('span.profile-stat-num', {}, people(displayCount)), h('span.profile-stat-label', {}, '动态')),
    h('button.profile-stat', { type: 'button', onclick: () => navigate('#/friends') },
      h('span.profile-stat-num', {}, people(stats.friends)), h('span.profile-stat-label', {}, '好友')),
    h('button.profile-stat', { type: 'button', onclick: () => selectTab('records') },
      h('span.profile-stat-num', {}, people(stats.records)), h('span.profile-stat-label', {}, '记录')),
    h('button.profile-stat', { type: 'button', onclick: () => selectTab('diary') },
      h('span.profile-stat-num', {}, people(stats.entries)), h('span.profile-stat-label', {}, '日记'))
  );

  /* ---- 宠物条 ---- */
  const petStrip = h('div.profile-pets-strip');
  if (pets.length) {
    for (const pet of pets) {
      const sp = speciesOf(pet.species);
      petStrip.appendChild(h('button.profile-pet', {
        type: 'button',
        onclick: () => navigate('#/u/' + enc(user.handle || handle) + '/records?petId=' + enc(pet.id)),
      },
        pet.avatar
          ? h('div.profile-pet-avatar', {}, h('img', { src: pet.avatar, alt: pet.name }))
          : h('div.profile-pet-avatar.is-emoji', {}, sp.emoji),
        h('div.profile-pet-name', {}, pet.name),
        h('div.small.muted', {}, pet.breed || sp.label)
      ));
    }
  } else if (isSelf) {
    petStrip.appendChild(h('button.profile-pet.is-add', {
      type: 'button',
      onclick: () => openPetsModal(ctx, pets, user.handle || handle, () => ctx.rerender()),
    },
      h('div.profile-pet-avatar.is-emoji', {}, '＋'),
      h('div.profile-pet-name', {}, '添加宠物'),
      h('div.small.muted', {}, '先介绍一下毛孩子')
    ));
  } else {
    petStrip.appendChild(h('div.profile-hint', {}, 'ta 还没有公开的宠物'));
  }

  const root = h('article.profile-page', {},
    h('header.profile-hero', {}, cover, heroBody),
    h('div.profile-mid', {}, statsBar),
    h('section.profile-pets', {},
      h('div.profile-section-head', {},
        h('h3', {}, '毛孩子'),
        pets.length ? h('span.small.muted', {}, pets.length + ' 位家庭成员') : null
      ),
      petStrip
    ),
    h('section.profile-content', {}, tabBar, tabBody)
  );

  const initial = ['posts', 'records', 'diary'].includes(ctx.query && ctx.query.tab)
    ? ctx.query.tab
    : 'posts';
  selectTab(initial);

  return root;
}
