// 路由表：模式 → 视图模块 + 权限
import { state, navigate } from './lib.js';

export const routes = [
  { path: '/', view: 'landing', title: '爪爪星球' },
  { path: '/feed', view: 'feed', title: '广场' },
  { path: '/hot', view: 'feed', title: '热门', query: { tab: 'hot' } },
  { path: '/explore', view: 'search', title: '发现' },
  { path: '/post/:id', view: 'post', title: '动态' },
  { path: '/u/:handle', view: 'profile', title: '主页' },
  { path: '/u/:handle/records', view: 'records', title: '记录' },
  { path: '/u/:handle/journal', view: 'journal', title: '日记' },
  { path: '/records', view: 'records', title: '记录', auth: true },
  { path: '/journal', view: 'journal', title: '日记', auth: true },
  { path: '/tasks', view: 'tasks', title: '任务' },
  { path: '/friends', view: 'friends', title: '好友', auth: true },
  { path: '/create', view: 'create', title: '发布', auth: true },
  { path: '/editor', view: 'editor', title: '图片编辑', auth: true },
  { path: '/settings', view: 'settings', title: '设置', auth: true },
  { path: '/login', view: 'login', title: '登录', guest: true },
  { path: '/register', view: 'login', title: '注册', guest: true, query: { mode: 'register' } },
];

function compile(path) {
  const keys = [];
  const re = new RegExp('^' + path.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
  return { re, keys };
}

const compiled = routes.map((r) => ({ ...r, ...compile(r.path) }));

export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#/, '') || '/';
  const [pathPart, qs] = raw.split('?');
  const path = decodeURI(pathPart || '/');
  const query = {};
  new URLSearchParams(qs || '').forEach((v, k) => { query[k] = v; });
  return { path, query };
}

export function resolve(hash) {
  const { path, query } = parseHash(hash);
  for (const route of compiled) {
    const m = route.re.exec(path);
    if (!m) continue;
    const params = {};
    route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return { route, params, query: { ...query, ...(route.query || {}) }, path };
  }
  return { route: null, params: {}, query, path };
}

export function guard(target) {
  const { route, path, query } = target;
  if (!route) return { redirect: '#/feed' };
  if (route.auth && !state.user) return { redirect: '#/login?next=' + encodeURIComponent(location.hash || '#/feed') };
  if (route.guest && state.user) return { redirect: '#/feed' };
  if (path === '/' && state.user) return { redirect: '#/feed' };
  return null;
}

export function startRouter(render) {
  const run = async () => {
    const target = resolve(location.hash);
    const g = guard(target);
    if (g) { navigate(g.redirect); return; }
    document.title = (target.route.title || '爪爪星球') + ' · 爪爪星球';
    await render(target);
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  };
  window.addEventListener('hashchange', run);
  if (!location.hash) location.hash = state.user ? '#/feed' : '#/';
  run();
}

export function linkTo(href, ...kids) {
  const a = document.createElement('a');
  a.href = href.startsWith('#') ? href : '#' + href;
  a.style.color = 'inherit';
  for (const k of kids.flat(9)) if (k != null) a.appendChild(typeof k === 'object' && k.nodeType ? k : document.createTextNode(String(k)));
  return a;
}
