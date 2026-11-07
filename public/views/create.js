// 发布动态
import {
  h, api, state, toast, toastGained, handleError, navigate, uploadFile, compressImage,
  avatarEl, emptyState, VIS_OPTIONS, field, loadingBlock, speciesOf, photoFrame,
} from '../lib.js';
import { openComposite } from './_composite.js';
import { openLightbox } from './_lightbox.js';

export default async function createView(ctx) {
  let pets = state.pets || [];
  try {
    const r = await api.get('/api/pets');
    pets = r.items || [];
    state.pets = pets;
  } catch (_) {}

  const items = []; // {asset, layout}
  let visibility = 'public';
  let petId = ctx.query.petId && pets.some((p) => p.id === ctx.query.petId) ? ctx.query.petId : (pets[0] ? pets[0].id : '');

  const body = h('textarea.create-body', {
    placeholder: '今天毛孩子做了什么？遛了几圈、吃了什么、有没有调皮…',
    rows: 5,
  });

  const petRow = h('div.chip-row');
  const renderPets = () => {
    petRow.replaceChildren();
    if (!pets.length) {
      petRow.appendChild(h('a.chip', { href: '#/settings' }, '＋ 先添加一只宠物'));
      return;
    }
    for (const p of pets) {
      petRow.appendChild(h('button.chip' + (p.id === petId ? '.is-active' : ''), {
        onclick: () => { petId = p.id === petId ? '' : p.id; renderPets(); },
      }, speciesOf(p.species).emoji + ' ' + p.name));
    }
  };
  renderPets();

  const thumbs = h('div.create-thumbs');
  const renderThumbs = () => {
    thumbs.replaceChildren();
    items.forEach((it, i) => {
      const pic = it.layout
        ? photoFrame(it.asset, { onOpen: () => openLightbox(items.map((x) => ({ ...x.asset, layout: x.layout })), i), ratio: it.asset.w && it.asset.h ? `${it.asset.w} / ${it.asset.h}` : '1 / 1' })
        : h('img', { src: it.asset.url, alt: '', onclick: () => openLightbox(items.map((x) => x.asset), i) });
      const card = h('div.create-thumb', {},
        pic,
        h('button.thumb-x', { title: '移除', onclick: () => { items.splice(i, 1); renderThumbs(); } }, '×'),
        h('button.thumb-edit', {
          onclick: () => {
            openComposite(it.asset, {
              layout: it.layout,
              onSave: (layout) => {
                it.layout = layout;
                renderThumbs();
                toast('已加上贴纸/相框', 'ok');
              },
            });
          },
        }, it.layout && ((it.layout.layers && it.layout.layers.length) || (it.layout.frame && it.layout.frame.style !== 'none')) ? '✏️ 再编辑' : '✏️ 贴纸'),
        it.layout && it.layout.layers && it.layout.layers.length
          ? h('span.thumb-badge', {}, String(it.layout.layers.length) + ' 贴纸')
          : null
      );
      thumbs.appendChild(card);
    });
    if (items.length < 9) {
      thumbs.appendChild(h('label.create-add', {},
        h('span', {}, '＋'),
        h('span.small', {}, '加图'),
        h('input', {
          type: 'file', accept: 'image/*', multiple: true, hidden: true,
          onchange: (e) => handleFiles(e.target.files, e),
        })
      ));
    }
  };

  async function handleFiles(fileList, ev) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    if (items.length + files.length > 9) toast('最多 9 张图', 'err');
    for (const f of files.slice(0, 9 - items.length)) {
      try {
        const small = await compressImage(f, 1600);
        const r = await uploadFile(small, 'photo');
        items.push({ asset: r.asset, layout: null });
        toastGained(r.gained);
      } catch (e) { handleError(e); }
    }
    if (ev && ev.target) ev.target.value = '';
    renderThumbs();
  }

  const visRow = h('div.chip-row');
  const renderVis = () => {
    visRow.replaceChildren(...VIS_OPTIONS.map((v) => h('button.chip' + (v.value === visibility ? '.is-active' : ''), {
      onclick: () => { visibility = v.value; renderVis(); },
    }, v.icon + ' ' + v.label)));
  };
  renderVis();

  const submit = h('button.btn.primary', {
    onclick: async () => {
      const text = body.value.trim();
      if (!text && !items.length) return toast('写点什么或者加张图吧', 'err');
      submit.disabled = true;
      submit.textContent = '发布中…';
      try {
        const r = await api.post('/api/posts', {
          body: text,
          visibility,
          petId: petId || null,
          assets: items.filter((it) => it.layout).map((it) => ({ id: it.asset.id, layout: it.layout }))
            .concat(items.filter((it) => !it.layout).map((it) => ({ id: it.asset.id }))),
        });
        toastGained(r.gained);
        toast('发布成功', 'ok');
        navigate('#/feed');
      } catch (e) {
        handleError(e);
        submit.disabled = false;
        submit.textContent = '发布';
      }
    },
  }, '发布');

  // 从编辑器带过来的图
  if (ctx.query.asset) {
    try {
      const r = await api.get('/api/assets?kind=photo,sticker,frame');
      const a = (r.items || []).find((x) => x.id === ctx.query.asset);
      if (a) {
        let layout = null;
        try { layout = JSON.parse(sessionStorage.getItem('pp:layout:' + a.id) || 'null'); } catch (_) {}
        if (layout) sessionStorage.removeItem('pp:layout:' + a.id);
        items.push({ asset: a, layout });
      }
    } catch (_) {}
  }
  renderThumbs();

  const page = h('div.create-page', {},
    h('div.page-head', {}, h('div', {}, h('h1', {}, '发布动态'), h('div.sub', {}, '顺手记一笔，今天也能涨经验'))),
    h('div.create-grid', {},
      h('div.card.stack', {},
        h('div.row', { style: { gap: '10px' } }, avatarEl(ctx.user, 40),
          h('div', {}, h('div', { style: { fontWeight: 600 } }, ctx.user.display || ctx.user.handle),
            h('div.small.muted', {}, '发到我的主页和广场'))),
        body,
        h('div.stack.sm', {}, h('div.small.muted', {}, '关联宠物'), petRow),
        h('div.stack.sm', {}, h('div.small.muted', {}, '图片（最多 9 张，可加贴纸/相框）'), thumbs),
        h('label.drop-hint', {},
          '也可以把图片拖到这里 ',
          h('input', {
            type: 'file', accept: 'image/*', multiple: true, hidden: true,
            onchange: (e) => handleFiles(e.target.files, e),
          })
        )
      ),
      h('div.card.stack.sm', {},
        h('h3', {}, '可见范围'),
        visRow,
        h('div.small.muted', {}, VIS_OPTIONS.find((v) => v.value === visibility)?.hint),
        h('hr.soft'),
        h('div.row.between', {},
          h('a.btn.ghost.sm', { href: '#/feed' }, '取消'),
          submit
        )
      )
    )
  );

  // 拖拽上传
  page.addEventListener('dragover', (e) => { e.preventDefault(); page.classList.add('dragging'); });
  page.addEventListener('dragleave', () => page.classList.remove('dragging'));
  page.addEventListener('drop', (e) => {
    e.preventDefault();
    page.classList.remove('dragging');
    if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  });

  return page;
}
