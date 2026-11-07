'use strict';
// 手机宽度下逐页检查是否横向溢出（scrollWidth > innerWidth 就是右侧被裁）。
// 用法：node tools/overflow-check.js [--width 390]
const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = process.env.SITE || 'http://127.0.0.1:4780';
const args = process.argv.slice(2);
const wi = args.indexOf('--width');
const WIDTH = wi >= 0 ? Number(args[wi + 1]) : 390;
const LOGIN = args.includes('--login') ? args[args.indexOf('--login') + 1] : 'alice:secret123';

const PAGES = ['#/feed', '#/hot', '#/records', '#/journal', '#/tasks', '#/friends', '#/create', '#/editor', '#/settings', '#/u/alice', '#/explore', '#/login'];

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
  const evalIn = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r.result && r.result.result && r.result.result.value;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.clearBrowserCookies');
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: BASE + '/?t=' + Date.now() });
  await sleep(1500);
  const [handle, password] = LOGIN.split(':');
  const st = await evalIn(`fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:${JSON.stringify(handle)},password:${JSON.stringify(password)}})}).then(r=>r.status)`);
  if (st !== 200) console.error('登录状态', st);

  let bad = 0;
  for (const page of PAGES) {
    await send('Page.navigate', { url: BASE + '/?t=' + Date.now() + page });
    await sleep(2600);
    const info = await evalIn(`JSON.stringify({w:document.documentElement.scrollWidth,inner:innerWidth,heavy:[].slice.call(document.querySelectorAll('body *')).filter(function(el){return el.getBoundingClientRect().right>innerWidth+2}).slice(0,3).map(function(el){return (el.id||el.className||el.tagName)+':'+Math.round(el.getBoundingClientRect().right)})})`);
    let o;
    try { o = JSON.parse(info); } catch (_) { console.log('FAIL', page, '无法测量', info); bad++; continue; }
    const ok = o.w <= o.inner + 1;
    if (!ok) bad++;
    console.log(ok ? 'OK  ' : 'BAD ', page.padEnd(14), `${o.w}/${o.inner}`, o.heavy.length ? JSON.stringify(o.heavy) : '');
  }
  console.log(`\n横向溢出检查：${PAGES.length - bad} 正常 / ${bad} 溢出（宽度 ${WIDTH}）`);
  ws.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
