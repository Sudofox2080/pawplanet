'use strict';
// 浏览器端第二条自检：登录、搜索、点赞、转发、改资料、改密码拦错、退出登录、游客守卫。
// 前提：headless Chrome 开了 9333，服务在 4780 跑着。
// 用法：node tools/flow-check.js [handle:password]
const BASE = process.env.SITE || 'http://127.0.0.1:4780';
const who = (process.argv[2] || 'alice:secret123').split(':');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const pass = (name, extra = '') => { results.push([true, name]); console.log('PASS', name, extra); };
const fail = (name, extra = '') => { results.push([false, name]); console.log('FAIL', name, extra); };

(async () => {
  const list = await fetch('http://127.0.0.1:9333/json/list').then((r) => r.json());
  const t = list.find((x) => x.type === 'page');
  if (!t) throw new Error('没有可用页面，先启动 headless Chrome');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      console.log('[EXCEPTION]', d.exception?.description || d.text);
    }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('EVAL: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result && r.result.result && r.result.result.value;
  };
  // 轮询直到表达式为真，最多 ms 毫秒
  const waitFor = async (expr, ms = 6000, step = 200) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = await evaluate(expr);
      if (v) return v;
      await sleep(step);
    }
    return null;
  };
  const go = async (hash) => {
    await send('Page.navigate', { url: BASE + '/?t=' + Date.now() + hash });
    await waitFor(`document.getElementById('view') && document.getElementById('view').children.length > 0`, 8000);
    await sleep(400);
  };
  const clickText = (text) => evaluate(`(() => {
    const b = [...document.querySelectorAll('button, .btn, a.btn')].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
    if (!b) return 'no-button';
    b.click();
    return 'ok';
  })()`);
  // 按钮里常带图标 emoji，按「包含」匹配更稳
  const clickContains = (text) => evaluate(`(() => {
    const b = [...document.querySelectorAll('button, .btn, a.btn')].find((x) => x.textContent.includes(${JSON.stringify(text)}));
    if (!b) return 'no-button';
    b.click();
    return 'ok';
  })()`);

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.clearBrowserCookies');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

  // 1) 表单登录
  await go('#/login');
  const hasForm = await waitFor(`!!document.querySelector('input[name=handle]')`, 6000);
  if (!hasForm) fail('登录表单渲染', '没有输入框');
  else {
    await evaluate(`(() => {
      const a = document.querySelector('input[name=handle]');
      const b = document.querySelector('input[name=password]');
      a.value = ${JSON.stringify(who[0])}; a.dispatchEvent(new Event('input', { bubbles: true }));
      b.value = ${JSON.stringify(who[1])}; b.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await evaluate(`document.querySelector('.auth-submit').click()`);
    const landed = await waitFor(`location.hash.startsWith('#/feed') ? location.hash : null`, 8000);
    landed ? pass('表单登录后进广场', landed) : fail('表单登录后进广场', await evaluate('location.hash'));
  }

  // 2) 发现页搜索
  await go('#/explore?q=%E5%A5%B6');
  const links = await waitFor(`document.querySelectorAll('a[href^="#/u/"]').length`, 6000);
  links ? pass('发现页搜索出结果', links + ' 个链接') : fail('发现页搜索出结果', '0');
  const keptQ = await evaluate(`document.querySelector('input')?.value || ''`);
  keptQ === '奶' ? pass('刷新后搜索词保留', keptQ) : fail('刷新后搜索词保留', JSON.stringify(keptQ));

  // 3) 点赞切换
  await go('#/feed');
  const likeBtn = await waitFor(`!!document.querySelector('.post')`, 6000);
  const likeRes = await evaluate(`(async () => {
    const card = document.querySelector('.post');
    if (!card) return 'no-card';
    const acts = [...card.querySelectorAll('button, .post-act')];
    const btn = card.querySelector('.post-act.like') || acts.find((b) => /赞/.test(b.title || b.getAttribute('aria-label') || ''));
    if (!btn) return 'no-like:' + acts.map((a) => a.className).join(',');
    const before = btn.textContent.trim();
    btn.click();
    await new Promise((r) => setTimeout(r, 1200));
    const after = btn.textContent.trim();
    return before + ' -> ' + after;
  })()`);
  String(likeRes).includes('->') ? pass('点赞按钮可点并变化', likeRes) : fail('点赞按钮可点并变化', String(likeRes));

  // 4) 转发（在详情页）
  const pid = await evaluate(`fetch('/api/feed?limit=1').then(r=>r.json()).then(j=>j.data.items[0].id)`);
  await go('#/post/' + pid);
  const opened = await clickContains('转发');
  const modalUp = await waitFor(`!!document.querySelector('.modal-mask .modal')`, 4000);
  if (opened === 'ok' && modalUp) {
    const confirmed = await evaluate(`(() => {
      const m = document.querySelector('.modal-mask .modal');
      const b = [...m.querySelectorAll('button')].find((x) => /转发|确认|发出去/.test(x.textContent));
      if (!b) return 'no-confirm';
      b.click(); return 'ok';
    })()`);
    await sleep(1800);
    const got = await evaluate(`fetch('/api/feed?tab=mine&limit=10').then(r=>r.json()).then(j=>(j.data.items.find(p=>p.repostOf)||{}).id||null)`);
    if (confirmed === 'ok' && got) {
      pass('转发成功并进我的流', got);
      await evaluate(`fetch('/api/posts/${got}',{method:'DELETE'})`);
    } else fail('转发成功并进我的流', confirmed + ' / ' + got);
  } else {
    fail('转发表单弹出', opened + ' modal=' + !!modalUp);
  }

  // 5) 改资料
  await go('#/settings');
  const bioOk = await waitFor(`!!document.querySelector('textarea[maxlength="300"]')`, 6000);
  if (!bioOk) fail('设置页渲染', '没有简介框');
  else {
    const bio = await evaluate(`(async () => {
      const el = document.querySelector('textarea[maxlength="300"]');
      el.value = '豆豆的铲屎官，喜欢记录每一天';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '保存资料');
      if (!b) return 'no-save';
      b.click();
      await new Promise((r) => setTimeout(r, 1600));
      const me = await fetch('/api/me').then((r) => r.json());
      return me.data.user.bio;
    })()`);
    bio === '豆豆的铲屎官，喜欢记录每一天' ? pass('保存资料生效', bio) : fail('保存资料生效', String(bio));
  }

  // 6) 两次新密码不一致要拦住
  const mismatch = await evaluate(`(async () => {
    const ins = [...document.querySelectorAll('input[type=password]')];
    if (ins.length < 3) return 'no-inputs:' + ins.length;
    ins[0].value = ${JSON.stringify(who[1])};
    ins[1].value = 'abcdef1';
    ins[2].value = 'abcdef2';
    ins.forEach((i) => i.dispatchEvent(new Event('input', { bubbles: true })));
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '更新密码');
    if (!b) return 'no-btn';
    b.click();
    await new Promise((r) => setTimeout(r, 900));
    return (document.querySelector('#toast-root')?.innerText || '').replace(/\\s+/g, ' ').trim();
  })()`);
  /不一样|不一致/.test(String(mismatch)) ? pass('两次新密码不一致被拦', mismatch) : fail('两次新密码不一致被拦', String(mismatch));

  // 7) 原密码错时留在原页面
  const wrongOld = await evaluate(`(async () => {
    const ins = [...document.querySelectorAll('input[type=password]')];
    ins.forEach((i) => { i.value = ''; });
    ins[0].value = 'wrong-pass-123';
    ins[1].value = 'abcdef1';
    ins[2].value = 'abcdef1';
    ins.forEach((i) => i.dispatchEvent(new Event('input', { bubbles: true })));
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '更新密码');
    b.click();
    await new Promise((r) => setTimeout(r, 1600));
    return { hash: location.hash, toast: (document.querySelector('#toast-root')?.innerText || '').replace(/\\s+/g, ' ').trim() };
  })()`);
  wrongOld && wrongOld.hash.startsWith('#/settings')
    ? pass('原密码错时留在设置页', JSON.stringify(wrongOld.toast))
    : fail('原密码错时留在设置页', JSON.stringify(wrongOld));

  // 8) 退出登录
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '退出登录');
    if (b) b.click();
    return 'clicked';
  })()`);
  await sleep(800);
  await evaluate(`(() => {
    const m = document.querySelector('.modal-mask .modal');
    if (!m) return 'no-modal';
    const b = [...m.querySelectorAll('button')].find((x) => /退出/.test(x.textContent));
    if (b) b.click();
    return 'confirmed';
  })()`);
  const out = await waitFor(`location.hash === '#/' ? 'ok' : null`, 6000);
  await sleep(600);
  const landingText = await evaluate(`(document.getElementById('view')?.innerText || '').slice(0, 60)`);
  out && landingText.includes('每个毛孩子')
    ? pass('退出登录回到落地页', landingText.replace(/\s+/g, ' '))
    : fail('退出登录回到落地页', out + ' / ' + landingText.replace(/\s+/g, ' '));

  // 9) 游客守卫
  await go('#/settings');
  const guarded = await waitFor(`location.hash.startsWith('#/login') ? location.hash : null`, 5000);
  guarded ? pass('游客进设置页被送去登录', guarded) : fail('游客进设置页被送去登录', await evaluate('location.hash'));

  // 收尾：把会话找回来，方便后续截图
  await evaluate(`fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:${JSON.stringify(who[0])},password:${JSON.stringify(who[1])}})}).then(r=>r.status)`);

  const bad = results.filter((r) => !r[0]);
  console.log('\n结果：' + (results.length - bad.length) + ' 通过 / ' + bad.length + ' 失败');
  if (bad.length) process.exitCode = 1;
  ws.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
