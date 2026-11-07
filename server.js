'use strict';
// 爪爪星球 · 多用户宠物社交平台 · 服务入口（零第三方依赖）
const http = require('http');
const fs = require('fs');
const path = require('path');

require('./lib/env'); // 先读 .env，再加载依赖环境变量的模块
const dbm = require('./lib/db');
const { get, run, all, nowISO } = dbm;
const H = require('./lib/http');
const A = require('./lib/auth');
const Storage = require('./lib/storage');
const R2 = require('./lib/r2');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 4780);
const HOST = process.env.HOST || '0.0.0.0';

// ---------------- 路由表 ----------------
const routes = [];
function addRoute(method, pattern, handler) {
  const keys = [];
  const re = new RegExp(
    '^' + pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$'
  );
  routes.push({ method, re, keys, handler });
}
const r = {
  get: (p, h) => addRoute('GET', p, h),
  post: (p, h) => addRoute('POST', p, h),
  patch: (p, h) => addRoute('PATCH', p, h),
  del: (p, h) => addRoute('DELETE', p, h),
};
r.delete = r.del;

for (const mod of ['core', 'pets', 'diary', 'posts', 'friends', 'tasks', 'uploads']) {
  require('./api/' + mod)(r);
}

// ---------------- 任务种子 ----------------
const SEED_TASKS = [
  ['daily_post', '发一条动态', '分享今天的毛孩子', 'daily', 1, 15, '📸', 'post_create', 1],
  ['daily_photo', '上传 3 张宠物照片', '新鲜照片最容易涨经验', 'daily', 3, 20, '🖼️', 'photo_upload', 2],
  ['daily_walk', '记录一次遛狗', '遛了几圈都算', 'daily', 1, 15, '🐕', 'walk_log', 3],
  ['daily_diary', '写一篇日记', '记下今天的小事', 'daily', 1, 15, '📖', 'diary_write', 4],
  ['daily_like', '给 3 条动态点赞', '看看别人家的毛孩子', 'daily', 3, 10, '❤️', 'like_give', 5],
  ['daily_comment', '评论 2 次', '说点好听的', 'daily', 2, 15, '💬', 'comment_give', 6],
  ['weekly_records', '本周记录 5 条', '驱虫 / 病例 / 体重都行', 'weekly', 5, 60, '🗂️', 'record_log', 7],
  ['weekly_post', '本周发 5 条动态', '保持分享', 'weekly', 5, 60, '✨', 'post_create', 8],
  ['weekly_friend', '本周结识 1 位好友', '一起养宠不孤单', 'weekly', 1, 50, '🤝', 'friend_accept', 9],
  ['once_pet', '添加第一只宠物', '建好它的专属页面', 'once', 1, 30, '🐾', 'pet_create', 10],
  ['once_editor', '用贴纸或相框做一张图', '去编辑器试一次', 'once', 1, 40, '🎨', 'sticker_use', 11],
  ['once_profile', '完善个人资料', '头像和简介都填上', 'once', 1, 30, '🪪', 'profile_complete', 12],
];

function seedTasks() {
  for (const [code, title, desc, period, target, xp, icon, event, sort] of SEED_TASKS) {
    const exist = get('SELECT code FROM tasks WHERE code = ?', code);
    if (exist) {
      run('UPDATE tasks SET title=?, desc=?, period=?, target=?, xp=?, icon=?, event=?, sort=? WHERE code=?',
        title, desc, period, target, xp, icon, event, sort, code);
    } else {
      run('INSERT INTO tasks (code, title, desc, period, target, xp, icon, event, sort, active) VALUES (?,?,?,?,?,?,?,?,?,1)',
        code, title, desc, period, target, xp, icon, event, sort);
    }
  }
}

// ---------------- 请求处理 ----------------
const clientIp = (req) => {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || 'unknown';
};

function buildCtx(req, res, url, params) {
  return {
    req, res,
    params,
    query: Object.fromEntries(url.searchParams),
    ip: clientIp(req),
    user: null,
    ok(data) {
      if (!res.writableEnded) H.ok(res, data || {});
    },
    async json(limit) {
      return H.readJSON(req, limit);
    },
    async form(limit) {
      return H.readMultipart(req, limit);
    },
  };
}

async function handleApi(ctx, req, res) {
  ctx.user = A.userFromReq(req);
  const data = await ctx.handler(ctx);
  if (data !== undefined && !res.writableEnded) H.ok(res, data);
}

async function onRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);

  try {
    // 1) 上传的媒体
    if (pathname.startsWith('/media/')) {
      const raw = pathname.slice(7);
      // 远端素材的 key 里带斜杠（pawplanet/u/<handle>/photo/<id>.jpg），先按 key 反查
      const asset = dbm.get('SELECT * FROM assets WHERE file = ?', raw);
      if (asset && asset.remote) {
        const pub = Storage.urlFor(asset);
        if (pub && pub.startsWith('http')) {
          res.writeHead(302, { location: pub, 'cache-control': 'public, max-age=86400' });
          return res.end();
        }
        // 没配公开域名：服务端代取，省得前端跨域
        try {
          const buf = await R2.getObject(asset.file);
          res.writeHead(200, {
            'content-type': asset.mime || 'application/octet-stream',
            'content-length': buf.length,
            'cache-control': 'public, max-age=604800',
          });
          return res.end(buf);
        } catch (e) {
          return H.fail(res, 404, 'not_found', '图片不存在');
        }
      }
      const file = raw.replace(/[^A-Za-z0-9._-]/g, '');
      const full = path.join(dbm.UPLOAD_DIR, file);
      if (!full.startsWith(dbm.UPLOAD_DIR)) return H.fail(res, 403, 'forbidden', '非法路径');
      if (H.serveFile(req, res, full, { cache: 'public, max-age=31536000, immutable' })) return;
      return H.fail(res, 404, 'not_found', '文件不存在');
    }

    // 2) API
    if (pathname.startsWith('/api/')) {
      let matched = false;
      for (const route of routes) {
        if (route.method !== req.method) continue;
        const m = route.re.exec(pathname);
        if (!m) continue;
        matched = true;
        const params = {};
        route.keys.forEach((k, i) => { params[k] = m[i + 1]; });
        const ctx = buildCtx(req, res, url, params);
        ctx.handler = route.handler;
        await handleApi(ctx, req, res);
        return;
      }
      if (!matched) {
        for (const route of routes) {
          if (route.re.test(pathname)) return H.fail(res, 405, 'method_not_allowed', '方法不支持');
        }
      }
      return H.fail(res, 404, 'not_found', '接口不存在');
    }

    // 3) 静态资源（public）
    if (req.method === 'GET' || req.method === 'HEAD') {
      const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const full = path.join(PUBLIC_DIR, rel);
      if (full.startsWith(PUBLIC_DIR) && H.serveFile(req, res, full, { spa: !rel.includes('.') })) return;
      // SPA 深链接回退
      if (!/\.[A-Za-z0-9]+$/.test(rel)) {
        if (H.serveFile(req, res, path.join(PUBLIC_DIR, 'index.html'), { cache: 'no-cache' })) return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('404');
    }

    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('405');
  } catch (err) {
    const rid = H.rid();
    if (err instanceof H.HttpError || (err && err.status && err.code)) {
      if (!res.headersSent) H.fail(res, err.status || 400, err.code || 'error', err.message || '出错了');
      else if (!res.writableEnded) res.end();
      return;
    }
    console.error(`[${rid}] ${req.method} ${req.url}`, err);
    if (!res.headersSent) H.fail(res, 500, 'server_error', `服务器开小差了（${rid}）`);
    else if (!res.writableEnded) res.end();
  }
}

seedTasks();

const server = http.createServer((req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'same-origin');
  onRequest(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`爪爪星球 pawplanet → http://127.0.0.1:${PORT}  (data: ${dbm.DATA_DIR})`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
