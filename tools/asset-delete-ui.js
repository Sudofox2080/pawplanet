'use strict';
// 素材库删除回归（浏览器端）：进图片工坊 → 切到贴纸 → 点删除 → 确认弹窗里点「删除」→ 卡片消失
// 会先通过 API 造一张贴纸，测完再删掉，不动真实素材。
// 用法：node tools/asset-delete-ui.js [--width 390]
const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = process.env.SITE || 'http://127.0.0.1:4780';
const args = process.argv.slice(2);
const WIDTH = args.includes('--width') ? Number(args[args.indexOf('--width') + 1]) : 390;
const LOGIN = ['alice', 'secret123'];

function tallPng() {
  const zlib = require('zlib');
  const W = 80, H = 160;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  let p = 0;
  for (let y = 0; y < H; y++) {
    raw[p++] = 0;
    for (let x = 0; x < W; x++) {
      const inside = x > 24 && x < 56;
      raw[p++] = 242; raw[p++] = 100; raw[p++] = 63; raw[p++] = inside ? 255 : 0;
    }
  }
  const tbl = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tbl[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = tbl[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
    const tt = Buffer.from(t, 'ascii');
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([tt, d])));
    return Buffer.concat([l, tt, d, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

(async () => {
  // 先用 API 造一张贴纸
  const cookieJar = {};
  const apiCall = async (method, path, body, isForm) => {
    const headers = { cookie: Object.entries(cookieJar).map(([k, v]) => k + '=' + v).join('; ') };
    let payload = body;
    if (!isForm && body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers, body: payload });
    for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
      const [kv] = c.split(';'); const i = kv.indexOf('=');
      cookieJar[kv.slice(0, i)] = kv.slice(i + 1);
    }
    const txt = await res.text();
    let j; try { j = JSON.parse(txt); } catch (_) { j = { raw: txt }; }
    return j.ok !== undefined && 'data' in j ? j.data : j;
  };
  await apiCall('POST', '/api/auth/login', { handle: LOGIN[0], password: LOGIN[1] });
  const fd = new FormData();
  fd.append('kind', 'sticker');
  fd.append('file', new Blob([tallPng()], { type: 'image/png' }), 'ui-delete-test.png');
  const up = await apiCall('POST', '/api/upload', fd, true);
  const assetId = up.asset.id;
  console.log('created', assetId, `${up.asset.w}x${up.asset.h}`);

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('没有可用的页面 target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evalIn = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r.result && r.result.result && r.result.result.value;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.clearBrowserCookies');
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: BASE + '/?t=' + Date.now() });
  await sleep(1500);
  const st = await evalIn(`fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:'${LOGIN[0]}',password:'${LOGIN[1]}'})}).then(r=>r.status)`);
  console.log('login', st);
  await send('Page.navigate', { url: BASE + '/?t=' + Date.now() + '#/editor?kind=sticker' });
  await sleep(2800);

  const before = await evalIn(`document.querySelectorAll('.asset-card').length`);
  const found = await evalIn(`!!Array.from(document.querySelectorAll('.asset-card')).find(c=>c.querySelector('img') && c.querySelector('img').src.indexOf('${assetId}')>-1)`);
  console.log('cards', before, 'found target', found);

  // 点那张卡片的删除
  const clicked = await evalIn(`(function(){
    var card = Array.from(document.querySelectorAll('.asset-card')).find(function(c){
      var im = c.querySelector('img'); return im && im.src.indexOf('${assetId}') > -1;
    });
    if (!card) return 'no card';
    var btn = Array.from(card.querySelectorAll('button')).find(function(b){ return b.textContent.trim() === '删除'; });
    if (!btn) return 'no delete btn';
    btn.click(); return 'clicked';
  })()`);
  console.log('delete click', clicked);
  await sleep(700);

  const modalOpen = await evalIn(`!!document.querySelector('.modal')`);
  const confirmText = await evalIn(`(function(){var m=document.querySelector('.modal');return m?m.innerText.slice(0,120):'';})()`);
  console.log('modal', modalOpen, JSON.stringify(confirmText));

  // 确认弹窗里的「删除」
  const confirmed = await evalIn(`(function(){
    var m = document.querySelector('.modal'); if (!m) return 'no modal';
    var btn = Array.from(m.querySelectorAll('button')).find(function(b){ return b.textContent.trim() === '删除'; });
    if (!btn) return 'no confirm btn';
    btn.click(); return 'confirmed';
  })()`);
  console.log('confirm', confirmed);
  await sleep(1200);

  const after = await evalIn(`document.querySelectorAll('.asset-card').length`);
  const stillThere = await evalIn(`(function(){
    return !!Array.from(document.querySelectorAll('.asset-card')).find(function(c){
      var im = c.querySelector('img'); return im && im.src.indexOf('${assetId}') > -1;
    });
  })()`);
  const apiList = await apiCall('GET', '/api/assets?kind=sticker');
  const apiHas = (apiList.items || []).some((x) => x.id === assetId);
  console.log('after cards', after, 'still in DOM', stillThere, 'still on server', apiHas);

  const ok = clicked === 'clicked' && modalOpen === true && confirmed === 'confirmed' && stillThere === false && apiHas === false;
  console.log(ok ? 'PASS 素材删除（浏览器端）' : 'FAIL 素材删除（浏览器端）');
  if (!ok) { try { await apiCall('DELETE', '/api/assets/' + assetId); } catch (_) {} }
  ws.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
