// 登录 / 注册（#/login、#/register）。左右分栏：品牌介绍 + 表单卡。
import { h, api, toast, field, navigate } from '../lib.js';

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

// ctx.query 已经由 URLSearchParams 解过码，这里再兜一层，避免 next 里还带着 %2F 之类
function safeDecode(v) {
  try { return decodeURIComponent(v); } catch { return v; }
}

function authError(e) {
  const code = e && e.code;
  const fallback = {
    handle_taken: '这个用户名已经被占了，换一个试试',
    bad_handle: '用户名要 3-20 位，字母、数字或下划线',
    bad_password: '密码至少 6 位',
    bad_credentials: '用户名或密码不对',
    rate_limited: '试得有点频繁，过几分钟再来',
    locked: '试得有点频繁，过几分钟再来',
    network: '网络好像断了，稍后再试',
  }[code];
  toast((e && e.message) || fallback || '出了点问题，再试一次', 'err');
}

export default async function login(ctx) {
  const next = safeDecode(ctx.query.next || '#/feed') || '#/feed';
  let mode = ctx.query.mode === 'register' ? 'register' : 'login';

  const headTitle = h('h2', {}, '');
  const headSub = h('p', {}, '');
  const formWrap = h('div.auth-form-wrap');

  const tabLogin = h('button.auth-tab', { type: 'button', onclick: () => setMode('login') }, '登录');
  const tabRegister = h('button.auth-tab', { type: 'button', onclick: () => setMode('register') }, '注册');

  function setMode(m) {
    mode = m;
    tabLogin.classList.toggle('is-on', m === 'login');
    tabRegister.classList.toggle('is-on', m === 'register');
    headTitle.textContent = m === 'login' ? '欢迎回来' : '第一次来？';
    headSub.textContent = m === 'login' ? '接着记它今天的样子。' : '取个名字，就能开始记录。';
    const suffix = next && next !== '#/feed' ? '?next=' + encodeURIComponent(next) : '';
    const target = (m === 'register' ? '#/register' : '#/login') + suffix;
    if (location.hash !== target) {
      try { history.replaceState(null, '', target); } catch { location.hash = target; }
    }
    formWrap.replaceChildren(m === 'register' ? registerForm() : loginForm());
  }

  function loginForm() {
    const handle = h('input', { type: 'text', name: 'handle', autocomplete: 'username', placeholder: '比如 doudou2024' });
    const pass = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', placeholder: '密码' });
    const submit = h('button.btn.primary.block.auth-submit', { type: 'submit' }, '登录');

    const form = h('form', { novalidate: true },
      field('用户名', handle),
      field('密码', pass),
      submit
    );

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const handleVal = handle.value.trim().toLowerCase();
      if (!handleVal) return toast('用户名还没填', 'err');
      if (!pass.value) return toast('密码还没填', 'err');
      submit.disabled = true;
      submit.textContent = '登录中…';
      try {
        const d = await api.post('/api/auth/login', { handle: handleVal, password: pass.value });
        await ctx.refreshUser();
        const u = (d && d.user) || {};
        toast('欢迎回来，' + (u.display || u.handle || handleVal), 'ok');
        navigate(next);
      } catch (e) {
        authError(e);
        submit.disabled = false;
        submit.textContent = '登录';
      }
    });

    setTimeout(() => handle.focus({ preventScroll: true }), 60);
    return form;
  }

  function registerForm() {
    const handle = h('input', { type: 'text', name: 'handle', autocomplete: 'username', placeholder: '3-20 位字母、数字或下划线' });
    const pass = h('input', { type: 'password', name: 'password', autocomplete: 'new-password', placeholder: '至少 6 位' });
    const display = h('input', { type: 'text', name: 'display', autocomplete: 'nickname', maxlength: 24, placeholder: '想让人怎么称呼你' });
    const submit = h('button.btn.primary.block.auth-submit', { type: 'submit' }, '注册并登录');

    const form = h('form', { novalidate: true },
      field('用户名', handle, '登录用的名字，只能用字母、数字和下划线'),
      field('密码', pass, '至少 6 位，记在只有你知道的地方'),
      field('昵称', display, '可以随时在设置里改，不填就用用户名'),
      submit
    );

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const handleVal = handle.value.trim().toLowerCase();
      if (!HANDLE_RE.test(handleVal)) return toast('用户名要 3-20 位，字母、数字或下划线', 'err');
      if (pass.value.length < 6) return toast('密码至少 6 位', 'err');
      submit.disabled = true;
      submit.textContent = '正在开星球…';
      try {
        const d = await api.post('/api/auth/register', {
          handle: handleVal,
          password: pass.value,
          display: display.value.trim(),
        });
        await ctx.refreshUser();
        const u = (d && d.user) || {};
        toast('欢迎来到爪爪星球，' + (u.display || handleVal), 'ok');
        navigate(next);
      } catch (e) {
        authError(e);
        submit.disabled = false;
        submit.textContent = '注册并登录';
      }
    });

    setTimeout(() => handle.focus({ preventScroll: true }), 60);
    return form;
  }

  const brand = h('div.auth-brand', {},
    h('a.auth-logo', { href: '#/' }, h('span.auth-logo-mark', {}, '🐾'), '爪爪星球'),
    h('h1.auth-title', {}, '它只陪你走一段，', h('br'), '相册能放很多年'),
    h('p.auth-lead', {}, '爪爪星球是给养宠人写的健康本和私人相册：安静、不要关注、不推广告，只有你和它。'),
    h('ul.auth-points', {},
      h('li', {}, '驱虫、疫苗、体重，写一次就一直有据可查'),
      h('li', {}, '拍立得、胶带、贴纸，照片不用修也好看'),
      h('li', {}, '发一条日常攒一点经验，等级慢慢长')
    ),
    h('div.auth-quote', {}, '“翻回两年前它的样子，才知道原来长这么快。”')
  );

  const card = h('div.auth-panel', {},
    h('div.auth-tabs', {}, tabLogin, tabRegister),
    h('div.auth-head', {}, headTitle, headSub),
    formWrap,
    h('p.auth-note', {}, '登录就当作你同意：只发自己的毛孩子，不搬别人的照片，也不在评论区吵架。')
  );

  setMode(mode);
  card.appendChild(h('div.auth-foot', {},
    h('a.small.muted', { href: '#/' }, '← 回首页看看')
  ));

  return h('div.auth', {}, brand, card);
}
