'use strict';
// node tools/eval.js "<expression>" [#/hash] [--login h:p] [--width 420]
const args = process.argv.slice(2);
const expr = args[0];
const pos = args.filter((a, i) => i > 0 && !a.startsWith('--'));
const hashPath = pos[0] || '#/feed';
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; return v && !v.startsWith('--') ? v : true; };
const width = Number(flag('width', 1280));
const login = flag('login', null);
const BASE = process.env.SITE || 'http://127.0.0.1:4780';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const list = await fetch('http://127.0.0.1:9333/json/list').then((r) => r.json());
  const t = list.find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  if (login) {
    const [handle, password] = String(login).split(':');
    await send('Page.navigate', { url: BASE + '/' + hashPath });
    await sleep(400);
    await send('Runtime.evaluate', { awaitPromise: true, expression: `fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:${JSON.stringify(handle)},password:${JSON.stringify(password)}})})` });
  }
  await send('Page.navigate', { url: BASE + '/?t=' + Date.now() + hashPath });
  await sleep(1500);
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr });
  console.log(JSON.stringify(r.result && r.result.result && r.result.result.value));
  ws.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
