'use strict';
// 浏览器端交互自检：登录 → 打开发布页 → 填内容 → 发布 → 检查广场出现该条
// 用法：node tools/ui-check.js [handle:password]
const BASE = process.env.SITE || 'http://127.0.0.1:4780';
const who = (process.argv[2] || 'alice:secret123').split(':');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const list = await fetch('http://127.0.0.1:9333/json/list').then((r) => r.json());
  const t = list.find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') console.log('[EXCEPTION]', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('EVAL: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result && r.result.result && r.result.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url: BASE + '/?t=' + Date.now() + '#/feed' });
  await sleep(800);
  const status = await evaluate(`fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:${JSON.stringify(who[0])},password:${JSON.stringify(who[1])}})}).then(r=>r.status)`);
  console.log('login', status);

  await send('Page.navigate', { url: BASE + '/?t=' + Date.now() + '#/create' });
  await sleep(1500);
  const marker = '浏览器自检 ' + new Date().toLocaleTimeString('zh-CN');
  await evaluate(`(() => {
    const ta = document.querySelector('.create-body');
    if (!ta) return 'no-textarea';
    ta.value = ${JSON.stringify(marker)};
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`);
  await sleep(300);
  const clicked = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发布');
    if (!btn) return 'no-button';
    btn.click();
    return 'clicked';
  })()`);
  console.log('publish', clicked);
  await sleep(2200);
  const found = await evaluate(`(async () => {
    const r = await fetch('/api/feed?tab=mine&limit=5').then((x) => x.json());
    const items = (r.data || r).items || [];
    const hit = items.find((p) => (p.body || '').includes(${JSON.stringify(marker)}));
    return hit ? 'found ' + hit.id : 'missing';
  })()`);
  console.log('result', found);

  // 清理：删掉刚才那条，避免污染演示数据
  if (String(found).startsWith('found ')) {
    const pid = String(found).slice(6);
    const del = await evaluate(`fetch('/api/posts/${pid}',{method:'DELETE'}).then(r=>r.status)`);
    console.log('cleanup', del);
  }

  const view = await evaluate(`(document.getElementById('view').innerText || '').slice(0, 120)`);
  console.log('view', JSON.stringify(view));
  ws.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
