// 图片查看器：全屏看原图，支持双指/双击/滚轮缩放、拖动平移、左右滑动切换多图。
// 列表里的照片都可以点开，这里统一渲染（贴纸与相框以 DOM 图层叠加，和列表里一致）。
import { h, photoFrame } from '../lib.js';

/**
 * @param {Array} assets 图片资源数组（可带 layout）
 * @param {number} start 从第几张开始
 */
export function openLightbox(assets, start = 0) {
  const list = (assets || []).filter((a) => a && (a.url || a.thumb));
  if (!list.length) return;
  let index = Math.min(Math.max(0, start), list.length - 1);
  let scale = 1, tx = 0, ty = 0;

  const imgWrap = h('div.lb-stage');
  const counter = h('div.lb-counter');
  const btnPrev = h('button.lb-nav.prev', { title: '上一张', 'aria-label': '上一张' }, '‹');
  const btnNext = h('button.lb-nav.next', { title: '下一张', 'aria-label': '下一张' }, '›');

  const overlay = h('div.lb-mask', {},
    h('div.lb-top', {},
      counter,
      h('button.lb-close', { title: '关闭', 'aria-label': '关闭' }, '×')
    ),
    imgWrap,
    btnPrev,
    btnNext
  );

  document.body.appendChild(overlay);
  document.documentElement.classList.add('lb-open');

  function apply() {
    const st = imgWrap.firstElementChild;
    if (st) st.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    imgWrap.classList.toggle('zoomed', scale > 1.01);
  }

  function reset() { scale = 1; tx = 0; ty = 0; apply(); }

  function show(i, dir = 0) {
    index = (i + list.length) % list.length;
    reset();
    const a = list[index];
    const stage = h('div.lb-img', { style: dir ? { animation: `lbSlide${dir > 0 ? 'L' : 'R'} .22s ease` } : null },
      photoFrame(a, { ratio: false, rounded: false })
    );
    imgWrap.replaceChildren(stage);
    apply();
    counter.textContent = list.length > 1 ? `${index + 1} / ${list.length}` : '';
    btnPrev.hidden = list.length < 2;
    btnNext.hidden = list.length < 2;
  }

  function close() {
    overlay.classList.add('out');
    document.documentElement.classList.remove('lb-open');
    window.removeEventListener('keydown', onKey);
    setTimeout(() => overlay.remove(), 180);
  }
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') show(index - 1, -1);
    else if (e.key === 'ArrowRight') show(index + 1, 1);
  };
  window.addEventListener('keydown', onKey);

  overlay.querySelector('.lb-close').addEventListener('click', close);
  btnPrev.addEventListener('click', (e) => { e.stopPropagation(); show(index - 1, -1); });
  btnNext.addEventListener('click', (e) => { e.stopPropagation(); show(index + 1, 1); });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target === imgWrap) close();
  });

  /* ---- 手势：单指拖动（放大后），双指缩放，左右滑动切换 ---- */
  const pts = new Map();
  let startDist = 0, startScale = 1, startTx = 0, startTy = 0, startX = 0, startY = 0, moved = false;
  const dist = () => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const mid = () => {
    const [a, b] = [...pts.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  imgWrap.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    imgWrap.setPointerCapture?.(e.pointerId);
    moved = false;
    if (pts.size === 1) { startX = e.clientX; startY = e.clientY; startTx = tx; startTy = ty; }
    if (pts.size === 2) { startDist = dist(); startScale = scale; }
  });

  imgWrap.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const d = dist();
      if (startDist > 0) scale = Math.min(6, Math.max(1, (startScale * d) / startDist));
      apply();
      moved = true;
    } else if (pts.size === 1) {
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      if (scale > 1.01) { tx = startTx + dx; ty = startTy + dy; apply(); }
    }
  });

  const endPointer = (e) => {
    if (!pts.has(e.pointerId)) return;
    const wasSingle = pts.size === 1;
    pts.delete(e.pointerId);
    if (pts.size === 0 && wasSingle) {
      const dx = e.clientX - startX;
      if (scale <= 1.01 && moved && Math.abs(dx) > 60 && Math.abs(e.clientY - startY) < 90) {
        show(index + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
      }
      if (scale <= 1.01) reset();
    }
    if (pts.size < 2) startDist = 0;
  };
  imgWrap.addEventListener('pointerup', endPointer);
  imgWrap.addEventListener('pointercancel', endPointer);

  imgWrap.addEventListener('dblclick', () => {
    if (scale > 1.01) reset();
    else { scale = 2.2; apply(); }
  });
  imgWrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    scale = Math.min(6, Math.max(1, scale * (e.deltaY < 0 ? 1.12 : 0.89)));
    if (scale <= 1.01) { tx = 0; ty = 0; }
    apply();
  }, { passive: false });

  show(index);
  return { close, next: () => show(index + 1, 1), prev: () => show(index - 1, -1) };
}
