// 动态详情
import {
  h, api, state, avatarEl, emptyState, loadingBlock, toast, toastGained, handleError,
  navigate, back, visPill, timeAgo, confirmModal, photoFrame, speciesOf,
} from '../lib.js';
import { postCard, commentItem, assetGrid } from './_postcard.js';

export default async function postView(ctx) {
  const id = ctx.params.id;
  let data;
  try {
    data = await api.get('/api/posts/' + id);
  } catch (e) {
    if (e.status === 404 || e.status === 403) {
      return h('div.stack', {},
        emptyState('🕳️', e.message || '这条动态不见了', h('a.btn.ghost.sm', { href: '#/feed' }, '回广场'))
      );
    }
    return h('div.stack', {}, emptyState('😿', e.message || '加载失败', h('button.btn.ghost.sm', { onclick: () => ctx.rerender() }, '重试')));
  }

  let post = data.post;
  let comments = data.comments || [];

  const cmtList = h('div.cmt-list');
  const renderComments = () => {
    cmtList.replaceChildren();
    if (!comments.length) {
      cmtList.appendChild(h('div.small.muted', { style: { padding: '10px 0' } }, '还没有评论，来说第一句吧'));
      return;
    }
    for (const c of comments) {
      cmtList.appendChild(commentItem(c, {
        canDelete: c.canDelete,
        onDelete: async (cm) => {
          const ok = await confirmModal('删除这条评论？', { okText: '删除', danger: true });
          if (!ok) return;
          try {
            await api.del('/api/comments/' + cm.id);
            comments = comments.filter((x) => x.id !== cm.id);
            post.comments = Math.max(0, (post.comments || 1) - 1);
            renderComments();
            toast('已删除', 'ok');
          } catch (e) { handleError(e); }
        },
      }));
    }
  };

  const ta = h('textarea', { placeholder: state.user ? '说点什么…' : '登录后可以评论', rows: 2, disabled: !state.user });
  const send = h('button.btn.primary.sm', {
    disabled: !state.user,
    onclick: async () => {
      const body = ta.value.trim();
      if (!body) return toast('先写点什么', 'err');
      send.disabled = true;
      try {
        const r = await api.post('/api/posts/' + post.id + '/comments', { body });
        ta.value = '';
        const c = r.comment || r;
        comments.push({ ...c, canDelete: true, user: state.user });
        post.comments = (post.comments || 0) + 1;
        renderComments();
        toastGained(r.gained);
      } catch (e) { handleError(e); }
      finally { send.disabled = false; }
    },
  }, '发送');

  const composer = state.user
    ? h('div.card.cmt-composer', {},
        avatarEl(state.user, 34),
        h('div', { style: { flex: 1 } }, ta),
        send
      )
    : h('div.card.cmt-composer.guest', {},
        h('div', { style: { flex: 1 } }, h('div.small.muted', {}, '登录后就能点赞和评论')),
        h('a.btn.primary.sm', { href: '#/login?next=' + encodeURIComponent('#/post/' + post.id) }, '登录')
      );

  const head = h('div.row.between', { style: { marginBottom: '4px' } },
    h('button.btn.ghost.sm', { onclick: back }, '← 返回'),
    h('div.small.muted', {}, '动态详情')
  );

  const card = postCard(post, {
    onDeleted: () => { toast('已删除', 'ok'); navigate('#/feed'); },
    onReposted: () => ctx.rerender(),
  });

  renderComments();

  return h('div.post-page', { style: { maxWidth: '680px', margin: '0 auto' } },
    head,
    card,
    h('div.card.cmt-section', {},
      h('div.row.between', { style: { marginBottom: '6px' } },
        h('h3', {}, '评论 ' + (post.comments || 0)),
        post.visibility && state.user && post.user && state.user.id === post.user.id ? visPill(post.visibility) : null
      ),
      composer,
      cmtList
    )
  );
}
