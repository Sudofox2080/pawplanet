'use strict';
// 图片字段的 id ⇄ URL 互转。
// 数据库里 avatar/cover 存 asset id，素材表的 remote 字段决定文件在 R2 还是本地磁盘；
// 对外统一给可访问 URL（远程直接给公开地址），避免前端拿到 id 当 img src 破图。
const { get } = require('./db');
const S = require('./storage');

function assetById(id) {
  return id ? get('SELECT * FROM assets WHERE id = ?', id) : null;
}

// asset id / 本地路径 / 公开 URL → 可访问 URL；查不到返回 null
function assetUrl(idOrUrl) {
  if (!idOrUrl) return null;
  const s = String(idOrUrl);
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (s.startsWith('/media/')) {
    const file = s.slice(7);
    const row = get('SELECT * FROM assets WHERE file = ?', file)
      || get('SELECT * FROM assets WHERE file = ?', safeDecode(file));
    return row ? S.urlFor(row) : s;
  }
  const a = assetById(s);
  return a ? S.urlFor(a) : null;
}

// asset id / 本地路径 / 公开 URL → asset id；查不到返回 null
function assetId(idOrUrl) {
  if (!idOrUrl) return null;
  const s = String(idOrUrl);
  if (!s.startsWith('/media/') && !s.startsWith('http://') && !s.startsWith('https://')) {
    return assetById(s) ? s : null;
  }
  const base = S.publicBase();
  let key = null;
  if (base && s.startsWith(base + '/')) key = safeDecode(s.slice(base.length + 1));
  else if (s.startsWith('/media/')) key = safeDecode(s.slice(7));
  if (!key) return null;
  const a = get('SELECT * FROM assets WHERE file = ?', key);
  return a ? a.id : null;
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

module.exports = { assetById, assetUrl, assetId };
