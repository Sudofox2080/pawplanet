// 爪爪星球 · 前端基础库（无依赖）
// 视图模块统一使用 h() 构造 DOM，避免 innerHTML 注入。

/* ---------------- DOM ---------------- */
const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...kids) {
  // 支持 'div.card.primary' / 'div#id' 简写
  let name = tag, cls = '', id = '';
  const m = /^([a-zA-Z0-9-]+)?([.#][^ ]+)?$/.exec(tag);
  if (m) {
    name = m[1] || 'div';
    for (const part of String(m[2] || '').split(/(?=[.#])/)) {
      if (!part) continue;
      if (part[0] === '.') cls += ' ' + part.slice(1);
      else if (part[0] === '#') id = part.slice(1);
    }
  }
  const el = document.createElement(name);
  if (cls.trim()) el.className = cls.trim();
  if (id) el.id = id;

  const p = props || {};
  for (const [k, v] of Object.entries(p)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class' || k === 'className') { el.className = (el.className ? el.className + ' ' : '') + v; continue; }
    if (k === 'style') {
      if (typeof v === 'string') el.setAttribute('style', v);
      else for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk.startsWith('--') ? sk : sk.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), sv);
      continue;
    }
    if (k === 'dataset') { for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = dv; continue; }
    if (k === 'html') { el.innerHTML = v; continue; } // 仅用于可信的静态 SVG/图标
    if (k.startsWith('on') && typeof v === 'function') { el.addEventListener(k.slice(2).toLowerCase(), v); continue; }
    if (k === 'ref' && typeof v === 'function') { v(el); continue; }
    if (k === 'value') { el.value = v; continue; }
    if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected' || k === 'readOnly') { el[k] = !!v; continue; }
    el.setAttribute(k, v === true ? '' : v);
  }

  append(el, kids);
  return el;
}

export function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    el.setAttribute(k, v);
  }
  for (const k of kids.flat(9)) if (k != null) el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
  return el;
}

function append(el, kids) {
  for (const k of kids.flat(9)) {
    if (k === null || k === undefined || k === false || k === true) continue;
    el.appendChild(typeof k === 'object' && k.nodeType ? k : document.createTextNode(String(k)));
  }
}

export const frag = (...kids) => {
  const f = document.createDocumentFragment();
  append(f, kids);
  return f;
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------------- 网络 ---------------- */
export class ApiError extends Error {
  constructor(code, message, status) { super(message || code); this.code = code; this.status = status; }
}

async function request(method, path, body, opts = {}) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    throw new ApiError('network', '网络好像断了，稍后再试');
  }
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await res.json().catch(() => null);
  if (!res.ok || (data && data.ok === false)) {
    const err = (data && data.error) || {};
    const e = new ApiError(err.code || 'http_' + res.status, err.message || '出了一点问题', res.status);
    if (res.status === 401 && !opts.silent401) {
      state.user = null;
      if (!location.hash.startsWith('#/login') && !location.hash.startsWith('#/register')) {
        const back = encodeURIComponent(location.hash || '#/feed');
        location.hash = '#/login?next=' + back;
      }
    }
    throw e;
  }
  return data ? data.data : null;
}

export const api = {
  get: (p, o) => request('GET', p, undefined, o),
  post: (p, b, o) => request('POST', p, b, o),
  patch: (p, b, o) => request('PATCH', p, b, o),
  del: (p, b, o) => request('DELETE', p, b, o),
};

export async function uploadFile(file, kind) {
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', file, file.name || 'upload');
  return request('POST', '/api/upload', fd);
}

// 探测图片是否含透明像素。带 alpha 的图（贴纸、PNG 抠图）绝不能压成 jpeg，
// 否则透明区域会被合成到黑底上，贴纸就会变成一块黑色方块。
async function hasAlpha(bmp) {
  const w = Math.min(120, bmp.width), hh = Math.min(120, bmp.height);
  if (!w || !hh) return false;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = hh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, hh);
    const px = ctx.getImageData(0, 0, w, hh).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 250) return true;
  } catch (_) {}
  return false;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    if (canvas.toBlob) canvas.toBlob(resolve, type, quality);
    else resolve(null);
  });
}

// 客户端压缩：长边压到 maxSide，避免手机原图 8MB。
// 有透明通道的图（或 kind 是 sticker/frame）输出 PNG 保留 alpha；其余输出 jpeg。
export async function compressImage(file, maxSide = 1600, quality = 0.86, opts = {}) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  try {
    const bmp = await createImageBitmap(file);
    const alpha = await hasAlpha(bmp);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    // 无需缩放且没有透明通道时，原样上传，省一次重编码
    if (scale >= 0.92 && !alpha) return file;
    const w = Math.round(bmp.width * scale), hh = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = hh;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, hh);
    const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
    if (alpha) {
      const png = await canvasToBlob(canvas, 'image/png');
      if (!png) return file;
      return new File([png], base + '.png', { type: 'image/png' });
    }
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (!blob) return file;
    return new File([blob], base + '.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}

/* ---------------- 会话状态 ---------------- */
export const state = {
  user: null,
  level: null,
  unread: 0,
  pets: [],
  sessionLoaded: false,
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { for (const fn of listeners) { try { fn(state); } catch (_) {} } }

export async function loadSession() {
  try {
    const d = await api.get('/api/auth/me', { silent401: true });
    state.user = d.user || null;
    state.level = d.level || null;
    state.unread = d.notificationsUnread || 0;
  } catch { state.user = null; }
  state.sessionLoaded = true;
  if (state.user) {
    try {
      const p = await api.get('/api/pets', { silent401: true });
      state.pets = p.items || [];
    } catch { state.pets = []; }
  }
  emit();
  return state.user;
}

export async function refreshUser() {
  if (!state.user) return null;
  try {
    const d = await api.get('/api/me');
    state.user = d.user;
    state.level = d.level;
    emit();
  } catch (_) {}
  return state.user;
}

export function setUser(u) { state.user = u; emit(); }

/* ---------------- 导航 ---------------- */
export function navigate(to) {
  const target = to.startsWith('#') ? to : '#' + (to.startsWith('/') ? to : '/' + to);
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = target;
}
export const go = navigate;
export const back = () => history.length > 1 ? history.back() : navigate('#/feed');

/* ---------------- 提示 ---------------- */
export function toast(msg, kind = '') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = h('div.toast' + (kind ? '.' + kind : ''), {}, msg);
  root.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 320); }, 2400);
}

export function toastGained(gained) {
  if (!gained || !gained.length) return;
  let xp = 0;
  const names = [];
  for (const g of gained) { xp += g.xp || 0; names.push(g.title); }
  if (!xp) return;
  toast('🎉 ' + names.join('、') + ' +' + xp + ' 经验', 'ok');
}

export function handleError(e) {
  if (!e) return;
  if (e.code === 'unauthorized') return;
  toast(e.message || '出错了', 'err');
}

/* ---------------- 弹窗 ---------------- */
export function modal({ title, body, actions, wide, onClose, lockScroll = true }) {
  const root = document.getElementById('modal-root');
  const close = () => {
    mask.remove();
    document.removeEventListener('keydown', onKey);
    if (lockScroll) { lockCount = Math.max(0, lockCount - 1); if (!lockCount) unlockBody(); }
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  // 手机上高度只有几百 px，底部按钮容易被挡住：头/脚固定，中间滚动
  const mask = h('div.modal-mask', { onclick: (e) => { if (e.target === mask) close(); } },
    h('div.modal' + (wide ? '.wide' : ''), {},
      h('div.modal-head', {},
        h('h3', {}, title || ''),
        h('button.x-btn', { onclick: (e) => { e.stopPropagation(); close(); }, title: '关闭', 'aria-label': '关闭' }, '×')
      ),
      h('div.modal-body', {}, body),
      actions ? h('div.modal-foot', {}, actions.map((a) => a)) : null
    )
  );
  root.appendChild(mask);
  if (lockScroll) { lockCount += 1; lockBody(); }
  document.addEventListener('keydown', onKey);
  return { close, el: mask };
}

// 弹窗打开时锁住页面滚动，避免手机上手势把底层页面带着滑走
let lockCount = 0;
function lockBody() {
  if (lockCount !== 1) return;
  const y = window.scrollY || 0;
  document.body.dataset.ppScrollY = String(y);
  document.body.style.position = 'fixed';
  document.body.style.top = -y + 'px';
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
  document.body.style.overflow = 'hidden';
}
function unlockBody() {
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  document.body.style.overflow = '';
  const y = Number(document.body.dataset.ppScrollY || 0);
  if (y) window.scrollTo(0, y);
  delete document.body.dataset.ppScrollY;
}

export function confirmModal(text, { okText = '确定', danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; m.close(); resolve(v); };
    const m = modal({
      title: '确认一下',
      body: h('p', {}, text),
      actions: [
        h('button.btn.ghost', { onclick: () => done(false) }, '取消'),
        h('button.btn' + (danger ? '.primary' : ''), { onclick: () => done(true) }, okText),
      ],
      onClose: () => done(false),
    });
  });
}

/* ---------------- 格式化 ---------------- */
const PAD = (n) => String(n).padStart(2, '0');

export function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const min = 60000, hour = 3600000, day = 86400000;
  if (diff < min) return '刚刚';
  if (diff < hour) return Math.floor(diff / min) + ' 分钟前';
  if (diff < day) return Math.floor(diff / hour) + ' 小时前';
  if (diff < 7 * day) return Math.floor(diff / day) + ' 天前';
  return fmtDate(iso);
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${fmtDate(iso)} ${PAD(d.getHours())}:${PAD(d.getMinutes())}`;
}

export function fmtWeekday(iso) {
  const d = new Date(iso);
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()] || '';
}

export function dayKeyLocal(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;
}

export const VIS_OPTIONS = [
  { value: 'public', label: '公开', icon: '🌏', hint: '所有人都能看到' },
  { value: 'friends', label: '仅好友', icon: '🤝', hint: '只有好友能看到' },
  { value: 'private', label: '仅自己', icon: '🔒', hint: '只有自己能看到' },
];

export const visLabel = (v) => (VIS_OPTIONS.find((x) => x.value === v) || VIS_OPTIONS[0]).label;
export const visIcon = (v) => (VIS_OPTIONS.find((x) => x.value === v) || VIS_OPTIONS[0]).icon;
export function visPill(v) {
  const cls = v === 'private' ? '.priv' : v === 'friends' ? '.vis' : '';
  return h('span.pill-tag' + cls, {}, visIcon(v) + ' ' + visLabel(v));
}

export const SPECIES = [
  { value: 'dog', label: '狗', emoji: '🐕' },
  { value: 'cat', label: '猫', emoji: '🐈' },
  { value: 'rabbit', label: '兔', emoji: '🐇' },
  { value: 'hamster', label: '仓鼠', emoji: '🐹' },
  { value: 'bird', label: '鸟', emoji: '🦜' },
  { value: 'fish', label: '鱼', emoji: '🐠' },
  { value: 'reptile', label: '爬宠', emoji: '🦎' },
  { value: 'other', label: '其他', emoji: '🐾' },
];
export const speciesOf = (v) => SPECIES.find((s) => s.value === v) || SPECIES[SPECIES.length - 1];

export const RECORD_TYPES = [
  { value: 'walk', label: '遛狗', emoji: '🐾', color: '#7C9A73' },
  { value: 'deworm', label: '驱虫', emoji: '💊', color: '#E08A4A' },
  { value: 'medical', label: '就诊', emoji: '🏥', color: '#D2604A' },
  { value: 'vaccine', label: '疫苗', emoji: '💉', color: '#5B7FA6' },
  { value: 'weight', label: '体重', emoji: '⚖️', color: '#8E7CA6' },
  { value: 'bath', label: '洗澡', emoji: '🛁', color: '#5FA3A6' },
  { value: 'train', label: '训练', emoji: '🎾', color: '#C08B3E' },
  { value: 'food', label: '喂食', emoji: '🍚', color: '#9A8C6A' },
  { value: 'other', label: '其他', emoji: '📌', color: '#8C8377' },
];
export const recordType = (v) => RECORD_TYPES.find((t) => t.value === v) || RECORD_TYPES[RECORD_TYPES.length - 1];

/* ---------------- 头像与图片 ---------------- */
export function avatarEl(userOrPet, size = 40, cls = '') {
  const name = (userOrPet && (userOrPet.display || userOrPet.name)) || '？';
  const src = userOrPet && (userOrPet.avatar || userOrPet.avatarUrl);
  const el = h('div.avatar' + (cls ? '.' + cls : ''), {
    style: { width: size + 'px', height: size + 'px', fontSize: Math.max(11, Math.round(size * 0.4)) + 'px' },
  });
  if (src) el.appendChild(h('img', { src, alt: name, loading: 'lazy' }));
  else el.appendChild(document.createTextNode(Array.from(name)[0] || '🐾'));
  return el;
}

export function petChip(pet) {
  if (!pet) return null;
  return h('span.chip.sm.pet-chip', {}, speciesOf(pet.species).emoji + ' ' + pet.name);
}

// 渲染带贴纸/相框的照片。ratio 为假时按图片真实比例，不做裁剪。
export function photoFrame(asset, { rounded = false, onOpen = null, ratio = '4 / 5' } = {}) {
  const layout = (asset && asset.layout) || {};
  const frame = layout.frame || null;
  const style = frame && frame.style && frame.style !== 'none' ? 'style-' + frame.style : (rounded ? 'style-rounded' : '');
  const box = h('div.photo-frame' + (style ? '.' + style : ''), ratio ? { style: { aspectRatio: ratio } } : null);
  box.appendChild(h('img', { src: asset.url || asset.thumb, alt: '', loading: 'lazy' }));
  for (const layer of layout.layers || []) {
    // scale 表示「贴纸宽度占照片宽度的比例」；单个 img 默认会被拉成宽度对应的方形，
    // 所以非方形贴纸再用 aspect-ratio 撑出真实高度，避免被裁成方框。
    const ar = layer.w && layer.h ? layer.w / layer.h : 1;
    const l = h('img.layer', {
      src: layer.url || (layer.asset && layer.asset.url) || '',
      alt: '',
      style: {
        left: (layer.x * 100) + '%',
        top: (layer.y * 100) + '%',
        width: (layer.scale * 100) + '%',
        aspectRatio: String(ar),
        height: 'auto',
        transform: `translate(-50%, -50%) rotate(${layer.rotate || 0}deg)`,
        opacity: layer.opacity == null ? 1 : layer.opacity,
      },
    });
    if (l.getAttribute('src')) box.appendChild(l);
  }
  if (frame && frame.style) {
    if (frame.assetId && frame.url) box.appendChild(h('img.frame-overlay', { src: frame.url, alt: '' }));
  }
  if (onOpen) {
    box.classList.add('zoomable');
    box.addEventListener('click', (e) => { e.stopPropagation(); onOpen(asset); });
  }
  return box;
}

export function xpBar(level, { showText = true } = {}) {
  const pct = Math.round(((level && level.progress) || 0) * 100);
  return h('div.stack.sm', {},
    showText ? h('div.row.between.small.muted', {},
      h('span', {}, `Lv.${level.level} ${level.title}`),
      h('span', {}, `${level.intoLevel} / ${level.needLevel} XP`)
    ) : null,
    h('div.xpbar', {}, h('i', { style: { width: pct + '%' } }))
  );
}

/* ---------------- 组件片段 ---------------- */
export function pageHead(title, sub, actions) {
  return h('div.page-head', {},
    h('div', {}, h('h1', {}, title), sub ? h('div.sub', {}, sub) : null),
    actions ? h('div.row.wrap', {}, actions.filter(Boolean)) : null
  );
}

export function emptyState(emoji, text, action) {
  return h('div.empty', {}, h('div.big', {}, emoji), h('div', {}, text), action || null);
}

export function btn(label, onClick, opts = {}) {
  const { variant = '', sm = false, block = false, icon = '', type = 'button' } = opts;
  const el = h('button.btn' + (variant ? '.' + variant : '') + (sm ? '.sm' : '') + (block ? '.block' : ''), { type, onclick: onClick },
    icon ? h('span', {}, icon) : null, label);
  return el;
}

export function iconBtn(glyph, onClick, title) {
  return h('button.btn.ghost.icon', { onclick: onClick, title, 'aria-label': title || glyph }, glyph);
}

export function field(label, input, hint) {
  return h('label.field', {}, h('span', {}, label), input, hint ? h('span.small.muted', {}, hint) : null);
}

export function sectionCard(title, extra, ...body) {
  return h('div.card', {},
    h('div.row.between', { style: { marginBottom: '14px' } }, h('h3', {}, title), extra || null),
    ...body
  );
}

export function statBlock(label, value, sub) {
  return h('div.stack.sm', { style: { minWidth: '72px' } },
    h('div', { style: { fontFamily: 'var(--serif)', fontSize: '22px', fontWeight: 700, lineHeight: 1.2 } }, value),
    h('div.small.muted', {}, label + (sub ? ' · ' + sub : ''))
  );
}

export function loadingBlock(text = '加载中…') {
  return h('div.empty', {}, h('div.big', {}, '🐾'), h('div', {}, text));
}

export function relativeDay(iso) {
  const key = dayKeyLocal(iso);
  const today = dayKeyLocal(new Date().toISOString());
  const y = new Date(Date.now() - 86400000);
  const yKey = `${y.getFullYear()}-${PAD(y.getMonth() + 1)}-${PAD(y.getDate())}`;
  if (key === today) return '今天';
  if (key === yKey) return '昨天';
  return fmtDate(iso);
}

export function debounce(fn, wait = 260) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

export function copyText(text) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text).then(() => toast('已复制', 'ok'));
  const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }, text);
  document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  toast('已复制', 'ok');
  return Promise.resolve();
}
