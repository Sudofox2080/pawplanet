'use strict';
// 素材库回归：上传贴纸 → 列表能拿到宽高 → 删除真的消失 → 引用它的布局被清理
// 用法：node test/assets-check.js   （需要服务在 4780，账号 alice/secret123）
const BASE = process.env.BASE || 'http://127.0.0.1:4780';

let cookie = '';
async function req(method, path, body, isForm) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let payload;
  if (isForm) payload = body;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const setc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setc) if (c.startsWith('pp_sid=')) cookie = c.split(';')[0];
  const txt = await res.text();
  let json; try { json = JSON.parse(txt); } catch (_) { json = { raw: txt }; }
  return { status: res.status, body: json.ok !== undefined && 'data' in json ? json.data : json };
}

// 一张 60x120 的竖长 PNG（非方形，用来验证不会被拉成方块）
function tallPng() {
  const zlib = require('zlib');
  const W = 60, H = 120;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  let p = 0;
  for (let y = 0; y < H; y++) {
    raw[p++] = 0;
    for (let x = 0; x < W; x++) {
      const inside = x > 18 && x < 42 && y > 10 && y < 110;
      raw[p++] = 242; raw[p++] = 100; raw[p++] = 63; raw[p++] = inside ? 255 : 0;
    }
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('PASS', name, extra); }
  else { fail++; console.log('FAIL', name, extra); }
}

(async () => {
  const r = await req('POST', '/api/auth/login', { handle: 'alice', password: 'secret123' });
  check('登录', r.status === 200, String(r.status));

  const png = tallPng();
  const fd = new FormData();
  fd.append('kind', 'sticker');
  fd.append('file', new Blob([png], { type: 'image/png' }), 'tall-sticker.png');
  const up = await req('POST', '/api/upload', fd, true);
  check('上传贴纸', up.status === 200 && up.body.asset, JSON.stringify(up.body).slice(0, 120));
  const asset = up.body.asset;
  check('素材记录真实宽高 60x120', asset.w === 60 && asset.h === 120, `${asset.w}x${asset.h}`);
  check('文件名保留', /tall-sticker/.test(asset.name || ''), asset.name);

  const list = await req('GET', '/api/assets?kind=sticker');
  check('素材库能列出新贴纸', (list.body.items || []).some((x) => x.id === asset.id));

  // 用这张贴纸合成一条帖子里的一层
  const posts = await req('GET', '/api/feed?tab=mine&limit=1');
  const post = (posts.body.items || [])[0];
  if (post) {
    const upd = await req('PATCH', '/api/posts/' + post.id, {
      assets: (post.assets || []).map((a, i) => i === 0
        ? { id: a.id, layout: { frame: { assetId: null, style: 'none' }, layers: [{ assetId: asset.id, x: 0.5, y: 0.5, scale: 0.3, rotate: 10, opacity: 1 }] } }
        : { id: a.id }),
    });
    check('给帖子挂上这层贴纸', upd.status === 200, String(upd.status));
    const detail = await req('GET', '/api/posts/' + post.id);
    const layers = (((detail.body.post || {}).assets || [])[0] || {}).layout;
    const layer = layers && layers.layers && layers.layers[0];
    check('图层带上了贴纸宽高比', !!layer && layer.w === 60 && layer.h === 120, JSON.stringify(layer || {}).slice(0, 140));

    const del = await req('DELETE', '/api/assets/' + asset.id);
    check('删除素材成功', del.status === 200, JSON.stringify(del.body).slice(0, 80));
    const after = await req('GET', '/api/assets?kind=sticker');
    check('列表里确实没了', !(after.body.items || []).some((x) => x.id === asset.id));

    const detail2 = await req('GET', '/api/posts/' + post.id);
    const layers2 = (((detail2.body.post || {}).assets || [])[0] || {}).layout;
    check('帖子里的这层贴纸已被摘掉', !!layers2 && (layers2.layers || []).every((l) => l.assetId !== asset.id),
      JSON.stringify(layers2 || {}).slice(0, 120));
  } else {
    check('找到一条自己的帖子', false, '空');
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
