'use strict';
// 对象存储（Cloudflare R2）存取层。
// 有 R2 环境变量就走 R2，没有就落本地磁盘 —— 本地开发不需要任何云资源。
// 目录约定（bucket 内）：
//   pawplanet/u/<handle>/avatar/<id>.<ext>
//   pawplanet/u/<handle>/cover/<id>.<ext>
//   pawplanet/u/<handle>/photo/<id>.<ext>
//   pawplanet/u/<handle>/sticker/<id>.<ext>
//   pawplanet/u/<handle>/frame/<id>.<ext>
// handle 未知时用 _shared/。
require('./env'); // 先读 .env，保证任何入口（server / 脚本）都拿到 R2 配置
const R = require('./r2');
const { get } = require('./db');

const PREFIX = (process.env.R2_PREFIX || 'pawplanet').replace(/^\/+|\/+$/g, '');

function ready() {
  return R.ready();
}

// 根据上传者和素材类型算对象 key
function keyFor({ kind, handle, id, ext }) {
  const owner = (handle || '_shared').replace(/[^a-zA-Z0-9_-]/g, '') || '_shared';
  const folder = ['photo', 'avatar', 'cover', 'sticker', 'frame'].includes(kind) ? kind : 'misc';
  return `${PREFIX}/u/${owner}/${folder}/${id}.${ext}`;
}

// 写入对象存储；调用方负责把 key 记进 assets.file 并把 remote 置 1。
// 写失败（凭据只读、网络抖动）时返回 null，让上传回落到本地磁盘，绝不把用户的上传弄丢。
let circuitUntil = 0;

async function put(key, buffer, contentType) {
  if (Date.now() < circuitUntil) return null;
  try {
    await R.putObject(key, buffer, contentType, 'public, max-age=31536000, immutable');
    return true;
  } catch (e) {
    console.error('R2 上传失败，暂时回落本地磁盘：', e.message.slice(0, 200));
    // 权限类错误短时间内不用反复重试，省得每次上传都多等一个往返
    if (e.status === 403 || e.status === 401) circuitUntil = Date.now() + 5 * 60 * 1000;
    return null;
  }
}

async function del(key) {
  try { return await R.deleteObject(key); } catch (e) { console.error('R2 删除失败', key, e.message); return false; }
}

// 公开访问地址（r2.dev 或自定义域名）
function publicUrl(key) {
  return R.publicUrl(key);
}

// 一行 assets 记录 → 可访问 URL
function urlFor(row) {
  if (!row) return null;
  if (row.remote) {
    const u = publicUrl(row.file);
    if (u) return u;
    return '/media/' + row.file; // 没配公开域名时回落到服务端代理
  }
  return '/media/' + row.file;
}

// 全站统一的素材 URL 查询（服务端各处都用它，避免直接拼 /media/）
function urlOfAssetId(id) {
  if (!id) return null;
  return urlFor(get('SELECT * FROM assets WHERE id = ?', id));
}

module.exports = { ready, keyFor, put, del, publicUrl, urlFor, urlOfAssetId, PREFIX, publicBase: () => R.cfg().publicBase };
