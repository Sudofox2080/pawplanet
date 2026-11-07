// 图片编辑器 / 素材库
import {
  h, api, state, toast, toastGained, handleError, navigate, uploadFile, compressImage,
  pageHead, emptyState, confirmModal, btn,
} from '../lib.js';
import { openComposite, FRAME_STYLES } from './_composite.js';

const KINDS = [
  { key: 'photo', label: '我的照片', icon: '🖼️' },
  { key: 'sticker', label: '贴纸', icon: '✨' },
  { key: 'frame', label: '相框', icon: '🖼' },
];

export default async function editorView(ctx) {
  let kind = ctx.query.kind && KINDS.some((k) => k.key === ctx.query.kind) ? ctx.query.kind : 'photo';
  let assets = [];
  const grid = h('div.asset-grid');
  const kindRow = h('div.chip-row');

  const renderKinds = () => {
    kindRow.replaceChildren(...KINDS.map((k) => h('button.chip' + (k.key === kind ? '.is-active' : ''), {
      onclick: () => { kind = k.key; renderKinds(); load(); },
    }, k.icon + ' ' + k.label)));
  };

  async function load() {
    grid.replaceChildren(h('div.small.muted', { style: { padding: '20px' } }, '加载中…'));
    try {
      const r = await api.get('/api/assets?kind=' + kind);
      assets = r.items || [];
    } catch (e) { handleError(e); assets = []; }
    render();
  }

  function render() {
    grid.replaceChildren();
    if (!assets.length) {
      grid.appendChild(emptyState(kind === 'photo' ? '📷' : '✨',
        kind === 'photo' ? '还没有上传过照片' : kind === 'sticker' ? '贴纸库是空的，传一张 PNG 试试' : '还没有相框素材'));
      return;
    }
    for (const a of assets) {
      // 贴纸/相框用 contain 显示完整形状，照片才用 cover 铺满
      const card = h('div.asset-card' + (kind === 'sticker' ? '.is-sticker' : kind === 'frame' ? '.is-frame' : ''), {},
        h('div.asset-pic', {},
          h('img', { src: a.url, alt: a.name || '', loading: 'lazy' }),
          a.name ? h('div.asset-name', {}, a.name) : null
        ),
        h('div.asset-bar', {},
          kind === 'photo'
            ? h('button.btn.sm.ghost', {
                onclick: () => openComposite(a, {
                  onSave: (layout) => {
                    try { sessionStorage.setItem('pp:layout:' + a.id, JSON.stringify(layout)); } catch (_) {}
                    toast('合成完成，去发布吧', 'ok');
                    navigate('#/create?asset=' + a.id);
                  },
                }),
              }, '✏️ 贴纸/相框')
            : h('span.small.muted', {}, a.w && a.h ? `${a.w}×${a.h}` : '素材'),
          h('button.btn.sm.ghost', {
            onclick: async () => {
              const ok = await confirmModal('从素材库删除这张图？用到它的帖子里那层贴纸会被一起摘掉。', { okText: '删除', danger: true });
              if (!ok) return;
              try {
                await api.del('/api/assets/' + a.id);
                assets = assets.filter((x) => x.id !== a.id);
                // 删除后重新拉一次，避免本地列表和服务器不一致（比如多个标签页都开着）
                render();
                toast('已删除', 'ok');
              } catch (e) { handleError(e); }
            },
          }, '删除')
        )
      );
      grid.appendChild(card);
    }
  }

  async function upload(files, ev) {
    for (const f of Array.from(files || [])) {
      if (!f.type.startsWith('image/')) continue;
      try {
        // 贴纸/相框强制保留透明通道，否则透明底会被压成黑底
        const keepAlpha = kind === 'sticker' || kind === 'frame';
        const small = await compressImage(f, kind === 'photo' ? 1600 : 900, 0.88, { keepAlpha });
        const r = await uploadFile(small, kind);
        assets.unshift(r.asset);
        toastGained(r.gained);
      } catch (e) { handleError(e); }
    }
    if (ev && ev.target) ev.target.value = '';
    render();
  }

  renderKinds();

  const root = h('div.editor-page', {},
    pageHead('图片工坊', '上传贴纸、相框素材，或给照片加装饰', [
      h('a.btn.ghost.sm', { href: '#/create' }, '去发布'),
    ]),
    h('div.card.stack', {},
      h('div.row.between.wrap', {},
        kindRow,
        h('label.btn.primary.sm', {},
          '＋ 上传素材',
          h('input', {
            type: 'file', accept: 'image/*', multiple: true, hidden: true,
            onchange: (e) => upload(e.target.files, e),
          })
        )
      ),
      h('div.small.muted', {}, kind === 'photo' ? '照片上传后可以在这里加贴纸和相框，再发到动态。' : kind === 'sticker' ? '贴纸建议用透明 PNG，任意尺寸都行。' : '相框图会铺满整张照片，透明区域露出照片。'),
      grid
    )
  );

  await load();
  return root;
}
