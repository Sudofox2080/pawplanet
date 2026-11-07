// 帖子卡片（信息流与详情页共用）
import {
  h, api, state, avatarEl, photoFrame, timeAgo, visPill, speciesOf,
  toast, toastGained, handleError, confirmModal, modal, navigate, copyText, emptyState,
} from '../lib.js';
import { openLightbox } from './_lightbox.js';

// 单图按真实宽高比展示，不裁切
function singleRatio(a) {
  if (a && a.w && a.h) return `${a.w} / ${a.h}`;
  return '4 / 5';
}

export function assetGrid(assets, opts = {}) {
  const list = (assets || []).filter(Boolean);
  if (!list.length) return null;
  const open = opts.onOpen || ((a) => openLightbox(list, list.indexOf(a)));
  if (list.length === 1) {
    const a = list[0];
    return h('div.post-single', {},
      photoFrame(a, { onOpen: open, ratio: singleRatio(a) }));
  }
  return h('div.post-grid' + (list.length === 2 ? '.two' : '') + (list.length === 3 ? '.three' : ''), {},
    list.map((a) => photoFrame(a, { onOpen: open, ratio: '1 / 1' }))
  );
}

export function commentItem(c, { onDelete, canDelete }) {
  return h('div.cmt', {},
    h('a', { href: '#/u/' + c.user.handle }, avatarEl(c.user, 30)),
    h('div.cmt-body', {},
      h('div.cmt-head', {},
        h('a.cmt-name', { href: '#/u/' + c.user.handle }, c.user.display || c.user.handle),
        h('span.cmt-time', {}, timeAgo(c.createdAt))
      ),
      h('div.cmt-text', {}, c.body),
      canDelete ? h('button.cmt-del', { onclick: () => onDelete && onDelete(c) }, '删除') : null
    )
  );
}

export function postCard(post, opts = {}) {
  const me = state.user;
  const isMine = me && post.user && me.id === post.user.id;
  const card = h('div.card.post', { dataset: { id: post.id } });

  const likeBtn = h('button.post-act.like' + (post.liked ? '.on' : ''), {
    onclick: async (e) => {
      e.stopPropagation();
      if (!me) return navigate('#/login?next=' + encodeURIComponent('#/post/' + post.id));
      try {
        const r = await api.post('/api/posts/' + post.id + '/like');
        post.liked = r.liked;
        post.likes = r.likes;
        likeBtn.classList.toggle('on', post.liked);
        likeBtn.querySelector('span.n').textContent = post.likes || 0;
        if (post.liked) toastGained(r.gained);
      } catch (err) { handleError(err); }
    },
  }, h('span.g', {}, post.liked ? '❤️' : '🤍'), h('span.n', {}, post.likes || 0));

  const repostBtn = h('button.post-act' + (post.reposted ? '.on' : ''), {
    onclick: (e) => { e.stopPropagation(); openRepost(post, opts); },
  }, h('span.g', {}, '🔁'), h('span.n', {}, post.reposted ? '已转' : '转发'));

  const commentBtn = h('button.post-act', {
    onclick: (e) => { e.stopPropagation(); navigate('#/post/' + post.id); },
  }, h('span.g', {}, '💬'), h('span.n', {}, post.comments || 0));

  const shareBtn = h('button.post-act', {
    onclick: (e) => {
      e.stopPropagation();
      const url = location.origin + location.pathname + '#/post/' + post.id;
      copyText(url);
    },
  }, h('span.g', {}, '🔗'), h('span.n', {}, '分享'));

  const head = h('div.post-head', {},
    h('a', { href: '#/u/' + post.user.handle }, avatarEl(post.user, 42)),
    h('div.post-who', {},
      h('div.row', { style: { gap: '6px' } },
        h('a.post-name', { href: '#/u/' + post.user.handle }, post.user.display || post.user.handle),
        post.pet ? h('a.pill-tag.pet', { href: '#/u/' + post.user.handle + '/records?petId=' + post.pet.id }, speciesOf(post.pet.species).emoji + ' ' + post.pet.name) : null,
        post.tag ? h('span.pill-tag', {}, post.tag) : null
      ),
      h('div.post-meta', {},
        h('span', {}, timeAgo(post.createdAt)),
        isMine ? h('span', {}, ' · ' + visLabelShort(post.visibility)) : null,
        post.source ? h('a', { href: sourceHref(post), style: { marginLeft: '4px' } }, '· ' + post.source.label) : null
      )
    ),
    isMine ? h('div.post-menu', {},
      h('button.x-btn', { title: '更多', onclick: (e) => { e.stopPropagation(); openPostMenu(post, opts); } }, '⋯')
    ) : null
  );

  card.appendChild(head);

  if (post.body) card.appendChild(h('div.post-body', {}, post.body));

  if (post.repostOf) {
    const src = post.repostOf;
    card.appendChild(h('a.repost-block', { href: '#/post/' + src.id },
      h('div.row', { style: { gap: '7px' } },
        avatarEl(src.user, 22),
        h('span.small', { style: { fontWeight: 600 } }, src.user ? (src.user.display || src.user.handle) : '已删除'),
        h('span.small.muted', {}, timeAgo(src.createdAt))
      ),
      h('div.small', { style: { marginTop: '4px' } }, (src.body || '').slice(0, 120)),
      src.assets && src.assets.length ? h('div.repost-thumb', {}, h('img', { src: src.assets[0].url, alt: '', loading: 'lazy' })) : null
    ));
  }

  const grid = assetGrid(post.assets, opts);
  if (grid) card.appendChild(grid);

  // 正文区的点击只用来进详情；图片点击交给查看器，别再触发跳转
  card.appendChild(h('div.post-acts', {}, likeBtn, commentBtn, repostBtn, h('div.spacer'), shareBtn));

  if (post.commentsPreview && post.commentsPreview.length) {
    card.appendChild(h('div.post-cmts', {},
      post.commentsPreview.slice(0, 2).map((c) => h('div.cmt-line', {},
        h('a.cmt-name', { href: '#/u/' + c.user.handle }, c.user.display || c.user.handle),
        h('span', {}, ' ' + c.body)
      )),
      post.comments > post.commentsPreview.length
        ? h('a.small.muted', { href: '#/post/' + post.id }, '查看全部 ' + post.comments + ' 条评论')
        : null
    ));
  }

  card.addEventListener('click', (e) => {
    if (e.target.closest('a,button,.photo-frame')) return;
    navigate('#/post/' + post.id);
  });

  return card;
}

function visLabelShort(v) {
  return v === 'friends' ? '仅好友' : v === 'private' ? '仅自己' : '公开';
}

function sourceHref(post) {
  if (!post.source) return '#/feed';
  if (post.source.type === 'record') return '#/records';
  if (post.source.type === 'diary') return '#/journal';
  return '#/post/' + post.source.id;
}

function openPostMenu(post, opts) {
  const items = [];
  if (state.user && post.user && state.user.id === post.user.id) {
    items.push(h('button.btn.ghost.block', {
      style: { justifyContent: 'flex-start' },
      onclick: () => { m.close(); navigate('#/post/' + post.id); },
    }, '✏️ 打开详情'));
    items.push(h('button.btn.block', {
      style: { justifyContent: 'flex-start', background: 'var(--coral)', color: '#fff' },
      onclick: async () => {
        m.close();
        const ok = await confirmModal('删掉这条动态？图片仍会留在你的素材库里。', { okText: '删除', danger: true });
        if (!ok) return;
        try {
          await api.del('/api/posts/' + post.id);
          toast('已删除', 'ok');
          if (opts.onDeleted) opts.onDeleted(post);
          else {
            const el = document.querySelector('.post[data-id="' + post.id + '"]');
            if (el) el.remove();
          }
        } catch (e) { handleError(e); }
      },
    }, '🗑️ 删除动态'));
  } else {
    items.push(h('button.btn.ghost.block', { onclick: () => { m.close(); copyText(location.origin + '#/post/' + post.id); } }, '🔗 复制链接'));
  }
  const m = modal({ title: '动态操作', body: h('div.stack.sm', {}, items) });
}

export async function openRepost(post, opts = {}) {
  if (!state.user) return navigate('#/login?next=' + encodeURIComponent('#/post/' + post.id));
  const ta = h('textarea', { placeholder: '说点什么再转发（可以不写）', rows: 3 });
  const vis = h('select', {}, ['public', 'friends', 'private'].map((v) =>
    h('option', { value: v, selected: v === 'public' }, v === 'public' ? '公开' : v === 'friends' ? '仅好友' : '仅自己')));
  const submit = h('button.btn.primary', {
    onclick: async () => {
      submit.disabled = true;
      try {
        const r = await api.post('/api/posts/' + post.id + '/repost', { body: ta.value.trim(), visibility: vis.value });
        toast('已转发', 'ok');
        toastGained(r.gained);
        m.close();
        if (opts.onReposted) opts.onReposted(r.post);
      } catch (e) { handleError(e); submit.disabled = false; }
    },
  }, '转发');
  const m = modal({
    title: '转发这条动态',
    body: h('div.stack', {},
      h('div.repost-quote', {},
        h('div.small.muted', {}, (post.user ? post.user.display : '') + '：'),
        h('div.small', {}, (post.body || '').slice(0, 140))
      ),
      ta,
      h('label.field', {}, h('span', {}, '可见范围'), vis)
    ),
    actions: [h('button.btn.ghost', { onclick: () => m.close() }, '取消'), submit],
  });
}
