// 贴纸 / 相框合成器（发布页与编辑器共用）
// 舞台就是一个可拖动的画布：单指拖动贴纸，双指捏合缩放+旋转，选中后四角是缩放手柄。
import {
  h, api, state, toast, handleError, modal, uploadFile, compressImage, btn, confirmModal,
} from '../lib.js';

export const FRAME_STYLES = [
  { value: 'none', label: '无边框' },
  { value: 'rounded', label: '圆角' },
  { value: 'polaroid', label: '拍立得' },
  { value: 'tape', label: '胶带' },
  { value: 'blur', label: '柔化' },
  { value: 'inset', label: '内嵌白边' },
];

const MIN_SCALE = 0.05;
const MAX_SCALE = 2.4;
const clone = (o) => JSON.parse(JSON.stringify(o || {}));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * 打开合成器
 * @param {{id,url,w,h}} asset 底图
 * @param {{layout?:{frame,layers}, onSave:(layout)=>void}} opts
 */
export function openComposite(asset, opts = {}) {
  const layout = clone(opts.layout || {});
  if (!layout.frame) layout.frame = { assetId: null, style: 'none' };
  if (!Array.isArray(layout.layers)) layout.layers = [];
  for (const l of layout.layers) {
    if (typeof l.x !== 'number') l.x = 0.5;
    if (typeof l.y !== 'number') l.y = 0.5;
    if (typeof l.scale !== 'number') l.scale = 0.22;
    if (typeof l.rotate !== 'number') l.rotate = 0;
    if (typeof l.opacity !== 'number') l.opacity = 1;
  }
  let selected = layout.layers.length ? layout.layers.length - 1 : -1;
  let stickers = [];
  let frames = [];
  let mode = 'move';

  const img = h('img.comp-base', { src: asset.url, alt: '' });
  const overlay = h('div.comp-overlay');
  const frameImg = h('img.comp-frame-img', { alt: '' });
  const stage = h('div.comp-stage', {}, img, overlay, frameImg);

  const side = h('div.comp-side');
  const hint = h('div.comp-hint');
  const m = modal({
    title: '做一张图',
    wide: true,
    body: h('div.comp-wrap', {}, h('div.comp-stage-wrap', {}, stage, hint), side),
    onClose: () => {},
  });
  // 手机上画布需要更多垂直空间：去掉弹窗内边距与头部，舞台顶到边
  document.querySelector('.modal')?.classList.add('modal-comp');

  /* ---------------- 渲染 ---------------- */
  function renderStage() {
    stage.className = 'comp-stage frame-' + (layout.frame.style || 'none');
    if (asset.w && asset.h) stage.style.aspectRatio = `${asset.w} / ${asset.h}`;
    overlay.replaceChildren();
    layout.layers.forEach((layer, i) => {
      const on = i === selected;
      // 非方形贴纸要显式撑出高度：img 只有 width 时会被拉伸成方形，看起来像被裁掉
      const ar = layer.w && layer.h ? layer.w / layer.h : 1;
      const el = h('img.comp-layer' + (on ? '.sel' : ''), {
        src: layer.url,
        alt: '',
        draggable: 'false',
        style: {
          left: (layer.x * 100) + '%',
          top: (layer.y * 100) + '%',
          width: (layer.scale * 100) + '%',
          aspectRatio: String(ar),
          height: 'auto',
          transform: `translate(-50%,-50%) rotate(${layer.rotate}deg)`,
          opacity: layer.opacity,
        },
      });
      el.addEventListener('pointerdown', (ev) => onLayerDown(ev, i, el));
      overlay.appendChild(el);
      if (on) {
        const box = h('div.comp-sel', {
          style: {
            left: (layer.x * 100) + '%',
            top: (layer.y * 100) + '%',
            width: (layer.scale * 100) + '%',
            aspectRatio: stripRatio(layer), transform: `translate(-50%,-50%)`,
          },
        },
          h('button.comp-handle.rot', { title: '旋转', onclick: (e) => e.preventDefault() }),
          h('button.comp-handle.tl', { title: '缩放' }),
          h('button.comp-handle.tr', { title: '缩放' }),
          h('button.comp-handle.bl', { title: '缩放' }),
          h('button.comp-handle.br', { title: '缩放' })
        );
        // 手柄 + 贴纸一起旋转
        box.style.transform += ` rotate(${layer.rotate}deg)`;
        const rot = box.querySelector('.rot');
        rot.addEventListener('pointerdown', (ev) => startRotate(ev, i));
        for (const hand of box.querySelectorAll('.tl,.tr,.bl,.br')) {
          hand.addEventListener('pointerdown', (ev) => startScaleHandle(ev, i, hand.classList.contains('br') || hand.classList.contains('tl') ? 1 : 1));
        }
        overlay.appendChild(box);
      }
    });
    if (layout.frame.assetId && layout.frame.url) {
      frameImg.src = layout.frame.url;
      frameImg.style.display = 'block';
    } else {
      frameImg.style.display = 'none';
    }
    hint.textContent = selected >= 0
      ? '拖动移动 · 双指缩放旋转 · 四角缩放 · 右上角旋转'
      : '点右边的贴纸加进来';
  }

  function stripRatio(layer) {
    if (layer.w && layer.h) return `${layer.w} / ${layer.h}`;
    return '1 / 1';
  }

  /* ---------------- 手势 ---------------- */
  const pointers = new Map();
  let gesture = null;

  function stageRect() { return stage.getBoundingClientRect(); }

  function onLayerDown(ev, index, el) {
    ev.preventDefault();
    ev.stopPropagation();
    selected = index;
    el.setPointerCapture?.(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const layer = layout.layers[index];
    gesture = {
      index,
      rect: stageRect(),
      startX: ev.clientX,
      startY: ev.clientY,
      x0: layer.x,
      y0: layer.y,
      scale0: layer.scale,
      rot0: layer.rotate,
      moved: false,
    };
    renderStage();
    renderSide();

    const move = (e) => {
      if (!gesture) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...pointers.values()];
      if (pts.length >= 2) {
        const [a, b] = pts;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
        if (!gesture.pinch) {
          gesture.pinch = {
            d0: d || 1,
            a0: ang,
            scale0: layer.scale,
            rot0: layer.rotate,
          };
        }
        layer.scale = clamp((gesture.pinch.scale0 * d) / gesture.pinch.d0, MIN_SCALE, MAX_SCALE);
        layer.rotate = Math.round(gesture.pinch.rot0 + (ang - gesture.pinch.a0));
      } else {
        const dx = (e.clientX - gesture.startX) / (gesture.rect.width || 1);
        const dy = (e.clientY - gesture.startY) / (gesture.rect.height || 1);
        if (Math.abs(dx) > 0.004 || Math.abs(dy) > 0.004) gesture.moved = true;
        layer.x = gesture.x0 + dx;
        layer.y = gesture.y0 + dy;
      }
      paintLayer(el, layer);
      gesture.moved = true;
      syncNumbers();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      pointers.delete(ev.pointerId);
      if (pointers.size === 0) {
        gesture = null;
        renderStage();
      }
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function paintLayer(el, layer) {
    el.style.left = (layer.x * 100) + '%';
    el.style.top = (layer.y * 100) + '%';
    el.style.width = (layer.scale * 100) + '%';
    el.style.transform = `translate(-50%,-50%) rotate(${layer.rotate}deg)`;
    el.style.opacity = layer.opacity;
    const box = overlay.querySelector('.comp-sel');
    if (box) {
      box.style.left = (layer.x * 100) + '%';
      box.style.top = (layer.y * 100) + '%';
      box.style.width = (layer.scale * 100) + '%';
      box.style.transform = `translate(-50%,-50%) rotate(${layer.rotate}deg)`;
    }
  }

  function startRotate(ev, index) {
    ev.preventDefault();
    ev.stopPropagation();
    const layer = layout.layers[index];
    const rect = stageRect();
    const cx = rect.left + layer.x * rect.width;
    const cy = rect.top + layer.y * rect.height;
    const a0 = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
    const rot0 = layer.rotate;
    const move = (e) => {
      const a = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
      layer.rotate = Math.round(rot0 + (a - a0));
      const el = overlay.querySelectorAll('.comp-layer')[index];
      if (el) paintLayer(el, layer);
      syncNumbers();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      renderStage();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
  }

  function startScaleHandle(ev, index) {
    ev.preventDefault();
    ev.stopPropagation();
    const layer = layout.layers[index];
    const rect = stageRect();
    const cx = rect.left + layer.x * rect.width;
    const cy = rect.top + layer.y * rect.height;
    const d0 = Math.max(12, Math.hypot(ev.clientX - cx, ev.clientY - cy));
    const s0 = layer.scale;
    const move = (e) => {
      const d = Math.hypot(e.clientX - cx, e.clientY - cy);
      layer.scale = clamp((s0 * d) / d0, MIN_SCALE, MAX_SCALE);
      const el = overlay.querySelectorAll('.comp-layer')[index];
      if (el) paintLayer(el, layer);
      syncNumbers();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      renderStage();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
  }

  /* ---------------- 右侧面板 ---------------- */
  let numberRefs = null;
  function syncNumbers() {
    const cur = layout.layers[selected];
    if (!cur || !numberRefs) return;
    numberRefs.scale.textContent = Math.round(cur.scale * 100) + '%';
    numberRefs.rotate.textContent = Math.round(cur.rotate) + '°';
    numberRefs.opacity.textContent = Math.round(cur.opacity * 100) + '%';
    numberRefs.scaleInput.value = String(Math.round(clamp(cur.scale * 100, 5, 240)));
    numberRefs.rotInput.value = String(Math.round(cur.rotate));
    numberRefs.opInput.value = String(Math.round(cur.opacity * 100));
  }

  function renderSide() {
    const cur = layout.layers[selected];
    numberRefs = null;
    side.replaceChildren();

    // 顶部：关闭
    side.appendChild(h('div.comp-topbar', {},
      h('div.comp-title', {}, '装饰'),
      h('button.btn.ghost.sm', { onclick: () => m.close() }, '取消'),
      h('button.btn.primary.sm', { onclick: save }, '完成')
    ));

    side.appendChild(h('div.comp-group', {},
      h('div.comp-label', {}, '相框'),
      h('div.chip-row', {}, FRAME_STYLES.map((f) => h('button.chip' + (layout.frame.style === f.value ? '.is-active' : ''), {
        onclick: () => { layout.frame.style = f.value; renderStage(); renderSide(); },
      }, f.label)))
    ));

    if (frames.length) {
      side.appendChild(h('div.comp-group', {},
        h('div.comp-label', {}, '相框素材'),
        h('div.comp-thumbs', {}, frames.map((a) => h('img.comp-thumb' + (layout.frame.assetId === a.id ? '.sel' : ''), {
          src: a.url, alt: a.name || '', title: a.name || '',
          onclick: () => {
            if (layout.frame.assetId === a.id) { layout.frame.assetId = null; layout.frame.url = null; }
            else { layout.frame.assetId = a.id; layout.frame.url = a.url; }
            renderStage(); renderSide();
          },
        })))
      ));
    }

    side.appendChild(h('div.comp-group', {},
      h('div.comp-label', {}, '贴纸'),
      stickers.length
        ? h('div.comp-thumbs', {}, stickers.map((a) => h('img.comp-thumb', {
            src: a.url, alt: a.name || '', title: '点击添加',
            onclick: () => {
              layout.layers.push({
                assetId: a.id, url: a.url, w: a.w, h: a.h,
                x: 0.5, y: 0.5, scale: 0.24, rotate: 0, opacity: 1,
              });
              selected = layout.layers.length - 1;
              renderStage(); renderSide();
            },
          })))
        : h('div.small.muted', {}, '还没有贴纸素材，点下面上传'),
      h('label.btn.ghost.sm.upload-label', {},
        '＋ 上传贴纸（保留透明底）',
        h('input', {
          type: 'file', accept: 'image/png,image/webp,image/*', hidden: true,
          onchange: async (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            await doUpload(f, 'sticker');
            e.target.value = '';
          },
        })
      )
    ));

    if (cur) {
      const scaleOut = h('span.comp-val', {}, Math.round(cur.scale * 100) + '%');
      const rotOut = h('span.comp-val', {}, Math.round(cur.rotate) + '°');
      const opOut = h('span.comp-val', {}, Math.round(cur.opacity * 100) + '%');
      const scaleInput = h('input', {
        type: 'range', min: 5, max: 240, value: String(Math.round(clamp(cur.scale * 100, 5, 240))),
        oninput: (e) => { cur.scale = Number(e.target.value) / 100; scaleOut.textContent = e.target.value + '%'; renderStage(); renderSide(); },
      });
      const rotInput = h('input', {
        type: 'range', min: -180, max: 180, value: String(Math.round(cur.rotate)),
        oninput: (e) => { cur.rotate = Number(e.target.value); rotOut.textContent = e.target.value + '°'; renderStage(); renderSide(); },
      });
      const opInput = h('input', {
        type: 'range', min: 10, max: 100, value: String(Math.round(cur.opacity * 100)),
        oninput: (e) => { cur.opacity = Number(e.target.value) / 100; opOut.textContent = e.target.value + '%'; renderStage(); renderSide(); },
      });
      numberRefs = { scale: scaleOut, rotate: rotOut, opacity: opOut, scaleInput, rotInput, opInput };

      side.appendChild(h('div.comp-group.comp-selected', {},
        h('div.comp-label', {}, '选中的贴纸'),
        h('label.comp-slider', {}, h('span.small', {}, '大小'), scaleInput, scaleOut),
        h('label.comp-slider', {}, h('span.small', {}, '旋转'), rotInput, rotOut),
        h('label.comp-slider', {}, h('span.small', {}, '透明'), opInput, opOut),
        h('div.row', { style: { gap: '6px', marginTop: '2px' } },
          btn('删除', () => { layout.layers.splice(selected, 1); selected = layout.layers.length - 1; renderStage(); renderSide(); }, { variant: 'ghost', sm: true }),
          btn('居中', () => { cur.x = 0.5; cur.y = 0.5; renderStage(); }, { variant: 'ghost', sm: true }),
          btn('复制', () => {
            const copy = clone(cur);
            copy.x = clamp(cur.x + 0.06, 0, 1);
            copy.y = clamp(cur.y + 0.06, 0, 1);
            layout.layers.push(copy);
            selected = layout.layers.length - 1;
            renderStage(); renderSide();
          }, { variant: 'ghost', sm: true })
        )
      ));
    } else {
      side.appendChild(h('div.comp-group', {},
        h('div.small.muted', {}, '点一下舞台上的贴纸就能调整它。')
      ));
    }
  }

  function save() {
    const out = {
      frame: { assetId: layout.frame.assetId || null, style: layout.frame.style || 'none', url: layout.frame.url || null },
      layers: layout.layers.map((l) => ({
        assetId: l.assetId, url: l.url,
        x: +Number(l.x).toFixed(4), y: +Number(l.y).toFixed(4),
        scale: +Number(l.scale).toFixed(4), rotate: Math.round(l.rotate),
        opacity: +Number(l.opacity).toFixed(2),
      })),
    };
    if (opts.onSave) opts.onSave(out);
    m.close();
  }

  async function doUpload(file, kind) {
    try {
      // 贴纸必须保留透明通道：compressImage 检测到 alpha 会输出 PNG
      const f = await compressImage(file, 900, 0.9, { keepAlpha: kind === 'sticker' || kind === 'frame' });
      const r = await uploadFile(f, kind);
      const a = r.asset;
      if (kind === 'sticker') stickers.push(a); else frames.push(a);
      toast('素材已加入你的库', 'ok');
      renderSide();
    } catch (e) { handleError(e); }
  }

  /* ---------------- 初始化 ---------------- */
  (async () => {
    try {
      const r = await api.get('/api/assets?kind=sticker,frame');
      const items = r.items || [];
      stickers = items.filter((a) => a.kind === 'sticker');
      frames = items.filter((a) => a.kind === 'frame');
    } catch (_) {}
    renderStage();
    renderSide();
  })();

  return { close: m.close, getLayout: () => layout };
}
