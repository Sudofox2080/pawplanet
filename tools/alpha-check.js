'use strict';
// 检查 compressImage 是否真的保留了透明通道：
// 在浏览器里生成一张 200x200 的半透明 PNG，跑一遍 compressImage，返回输出类型与角点像素的 alpha。
// 用法：node tools/alpha-check.js   （需要先开 9333 的 headless Chrome，且本地服务在 4780）
const PORT = Number(process.env.CDP_PORT || 9333);

const EXPR = `(async () => {
  const mod = await import('/lib.js');
  const c = document.createElement('canvas');
  c.width = c.height = 200;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(242,100,63,0.85)';
  g.beginPath(); g.arc(100, 100, 70, 0, Math.PI * 2); g.fill();
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'sticker.png', { type: 'image/png' });
  const out = await mod.compressImage(file, 900, 0.9, { keepAlpha: true });
  const bmp = await createImageBitmap(out);
  const cv = document.createElement('canvas');
  cv.width = bmp.width; cv.height = bmp.height;
  const cx = cv.getContext('2d');
  cx.drawImage(bmp, 0, 0);
  const corner = cx.getImageData(1, 1, 1, 1).data[3];
  const centre = cx.getImageData(Math.floor(bmp.width / 2), Math.floor(bmp.height / 2), 1, 1).data[3];
  return JSON.stringify({ type: out.type, name: out.name, w: bmp.width, h: bmp.height, cornerAlpha: corner, centreAlpha: centre });
})()`;

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('没有可用的页面 target，请先启动 Chrome');
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
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:4780/?t=${Date.now()}` });
  await new Promise((r) => setTimeout(r, 1200));
  const r = await send('Runtime.evaluate', { expression: EXPR, awaitPromise: true, returnByValue: true });
  const v = r.result && r.result.result && r.result.result.value;
  console.log(v || JSON.stringify(r.result));
  ws.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
