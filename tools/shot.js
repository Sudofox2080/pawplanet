'use strict';
// CDP 截图工具：node tools/shot.js <hashPath> <out.png> [--login handle:password] [--width 1280] [--height 1000] [--wait 1200] [--full]
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const flag = (name, def) => {
  const i = args.indexOf('--' + name);
  if (i < 0) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const hashPath = pos[0] || '#/feed';
const out = path.resolve(pos[1] || 'shot.png');
const width = Number(flag('width', 1280));
const height = Number(flag('height', 1000));
const waitMs = Number(flag('wait', 1400));
const login = flag('login', null);
const full = !!flag('full', false);
const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = process.env.SITE || 'http://127.0.0.1:4780';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
  let target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('没有可用的页面 target，请先启动 Chrome');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });

  if (flag('clean', false)) {
    await send('Network.clearBrowserCookies');
    await send('Network.clearBrowserCache');
  }

  if (login) {
    const [handle, password] = String(login).split(':');
    await send('Page.navigate', { url: BASE + '/' });
    await sleep(Number(flag('login-wait', 600)));
    const r = await send('Runtime.evaluate', {
      awaitPromise: true, returnByValue: true,
      expression: `fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:${JSON.stringify(handle)},password:${JSON.stringify(password)}})}).then(r=>r.status)`,
    });
    const status = r.result && r.result.result && r.result.result.value;
    if (status !== 200) console.error('登录返回状态：', status);
  }

  const url = BASE + '/?t=' + Date.now() + (hashPath.startsWith('#') ? hashPath : '#/' + hashPath);
  await send('Page.navigate', { url });
  await sleep(waitMs);

  const script = flag('script', null);
  if (script && script !== true) {
    for (const raw of String(script).split('\n@@\n')) {
      const step = raw.trim();
      if (!step) continue;
      const r = await send('Runtime.evaluate', { expression: step, awaitPromise: true, returnByValue: true });
      const v = r.result && r.result.result && r.result.result.value;
      console.log('STEP', v === undefined ? '' : String(v).slice(0, 200));
    }
    await sleep(Number(flag('after', 900)));
  }

  const errors = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `JSON.stringify({title:document.title,h1:(document.querySelector('h1')||{}).textContent||'',view:(document.getElementById('view')||{}).getAttribute?document.getElementById('view').getAttribute('data-view'):null,text:(document.getElementById('view')||{}).innerText?document.getElementById('view').innerText.slice(0,400):''})`,
  });
  console.log('PAGE', errors.result && errors.result.result && errors.result.result.value);

  let clip;
  if (full) {
    const m = await send('Page.getLayoutMetrics');
    const h = Math.ceil((m.result.cssContentSize && m.result.cssContentSize.height) || height);
    await send('Emulation.setDeviceMetricsOverride', { width, height: Math.min(h, 4000), deviceScaleFactor: 1, mobile: width < 600 });
    await sleep(400);
  }
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: full });
  const data = shot.result && shot.result.data;
  if (!data) throw new Error('截图失败：' + JSON.stringify(shot).slice(0, 300));
  fs.writeFileSync(out, Buffer.from(data, 'base64'));
  console.log('SAVED', out);
  ws.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
