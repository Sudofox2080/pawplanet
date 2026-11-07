'use strict';
// 打开页面并打印控制台日志 / 异常 / 失败请求：node tools/console.js "#/feed" [--login h:p] [--wait 2500]
const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const flag = (name, def) => { const i = args.indexOf('--' + name); if (i < 0) return def; const v = args[i + 1]; return v && !v.startsWith('--') ? v : true; };
const hashPath = pos[0] || '#/feed';
const waitMs = Number(flag('wait', 2500));
const login = flag('login', null);
const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = process.env.SITE || 'http://127.0.0.1:4780';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
  const target = list.find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || []).map((a) => a.value !== undefined ? a.value : a.description || a.type).join(' ');
      console.log('[' + msg.params.type + ']', text);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      console.log('[EXCEPTION]', (d.exception && (d.exception.description || d.exception.value)) || d.text, '@', d.url || '', d.lineNumber);
    }
    if (msg.method === 'Runtime.responseReceived') {
      const r = msg.params.response;
      if (r.status >= 400) console.log('[HTTP ' + r.status + ']', r.url);
    }
    if (msg.method === 'Network.loadingFailed') {
      console.log('[LOADFAIL]', msg.params.errorText, msg.params.type);
    }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

  if (login) {
    const [handle, password] = String(login).split(':');
    await send('Page.navigate', { url: BASE + '/api/me' });
    await sleep(500);
    const r = await send('Runtime.evaluate', {
      awaitPromise: true, returnByValue: true,
      expression: `fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:${JSON.stringify(handle)},password:${JSON.stringify(password)}})}).then(r=>r.status+'')`,
    });
    console.log('LOGIN', r.result && r.result.result && r.result.result.value);
  }

  await send('Page.navigate', { url: BASE + '/' + (hashPath.startsWith('#') ? hashPath : '#/' + hashPath) });
  await sleep(waitMs);
  const dom = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `JSON.stringify({boot:(document.getElementById('boot')||{}).className||'missing',sidebar:(document.getElementById('sidebar')||{}).className||'',view:(document.getElementById('view')||{}).innerText?document.getElementById('view').innerText.slice(0,600):''})`,
  });
  console.log('DOM', dom.result && dom.result.result && dom.result.result.value);
  ws.close();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
