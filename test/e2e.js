'use strict';
// 端到端自测：node test/e2e.js  （需先启动 server.js）
const BASE = process.env.BASE || 'http://127.0.0.1:4780';

let pass = 0, fail = 0;
const okLog = (m) => { pass++; console.log('  OK ' + m); };
const badLog = (m, extra) => { fail++; console.log('  XX ' + m + (extra ? ' -> ' + JSON.stringify(extra).slice(0, 400) : '')); };
function assert(cond, m, extra) { if (cond) okLog(m); else badLog(m, extra); }

function client() {
  let cookie = '';
  const c = {
    get cookie() { return cookie; },
    async req(method, url, body, isForm) {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      let payload;
      if (isForm) payload = body;
      else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
      const res = await fetch(BASE + url, { method, headers, body: payload });
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const x of sc) { const kv = x.split(';')[0]; if (kv.startsWith('pp_sid=')) cookie = kv; }
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('json') ? await res.json() : await res.text();
      return { status: res.status, data };
    },
    get: (u) => c.req('GET', u),
    post: (u, b) => c.req('POST', u, b),
    patch: (u, b) => c.req('PATCH', u, b),
    del: (u) => c.req('DELETE', u),
  };
  return c;
}

function tinyPNG() {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==';
  return Buffer.from(b64, 'base64');
}

(async () => {
  const stamp = Date.now().toString(36).slice(-5);
  const A = client(), B = client(), anon = client();

  console.log('\n[1] 注册与登录');
  let r = await A.post('/api/auth/register', { handle: 'alice' + stamp, password: 'secret123', display: '爱丽丝' });
  assert(r.status === 200 && r.data.ok, 'A 注册成功', r.data);
  const aUser = r.data && r.data.data && r.data.data.user;
  r = await B.post('/api/auth/register', { handle: 'bob' + stamp, password: 'secret123', display: '鲍勃' });
  assert(r.status === 200, 'B 注册成功', r.data);
  const bUser = r.data.data.user;
  r = await client().post('/api/auth/register', { handle: 'alice' + stamp, password: 'secret123', display: 'x' });
  assert(r.status === 409 || r.status === 400, '重复 handle 被拒', r.status);
  r = await client().post('/api/auth/login', { handle: 'alice' + stamp, password: 'wrong' });
  assert(r.status === 401, '错误密码被拒', r.status);

  console.log('\n[2] 宠物与记录');
  r = await A.post('/api/pets', { name: '豆豆', species: 'dog', breed: '柯基', gender: 'male', birthday: '2022-05-01', bio: '爱跑圈' });
  assert(r.status === 200, '建宠物', r.data);
  const pet = r.data.data.pet;
  r = await A.post('/api/records', { petId: pet.id, type: 'walk', title: '遛狗', note: '公园三圈', rounds: 3, ts: new Date().toISOString() });
  assert(r.status === 200, '记录遛狗', r.data);
  r = await A.post('/api/records', { petId: pet.id, type: 'deworm', title: '体内驱虫', note: '拜宠清', ts: new Date().toISOString(), data: { nextDue: '2026-12-07' } });
  assert(r.status === 200, '记录驱虫', r.data);
  r = await A.get('/api/records?petId=' + pet.id);
  assert(r.status === 200 && r.data.data.items.length >= 2, '记录列表', r.data);
  const summary = r.data.data.summary;
  assert(summary && summary.walkRounds30d >= 3, '汇总含遛圈数', summary);

  console.log('\n[3] 上传与贴纸');
  const png = tinyPNG();
  async function upload(cl, kind, name) {
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('file', new Blob([png], { type: 'image/png' }), name || 'x.png');
    return cl.req('POST', '/api/upload', fd, true);
  }
  r = await upload(A, 'photo', 'a.png');
  assert(r.status === 200, '上传照片', r.data);
  const photo = r.data.data.asset;
  r = await upload(A, 'sticker', 'heart.png');
  assert(r.status === 200, '上传贴纸', r.data);
  const sticker = r.data.data.asset;
  r = await upload(A, 'frame', 'polaroid.png');
  assert(r.status === 200, '上传相框', r.data);
  const frame = r.data.data.asset;
  r = await A.get('/api/assets?kind=sticker,frame');
  assert(r.status === 200 && r.data.data.items.length >= 2, '素材库列表', r.data.data && r.data.data.items.length);

  console.log('\n[4] 发帖 / 点赞 / 评论');
  const layout = {
    frame: { assetId: frame.id, style: 'polaroid' },
    layers: [{ assetId: sticker.id, x: 0.7, y: 0.2, scale: 0.25, rotate: -12, opacity: 1 }],
  };
  r = await A.post('/api/posts', { body: '今天豆豆超乖', petId: pet.id, visibility: 'public', assets: [{ id: photo.id, layout }] });
  assert(r.status === 200, '发帖带贴纸', r.data);
  const post = r.data.data.post;
  assert(post.assets && post.assets.length === 1, '帖子带图', post.assets);
  const gained = r.data.data.gained || [];
  assert(gained.length >= 1, '发帖触发任务奖励', gained);

  r = await B.post('/api/posts/' + post.id + '/like');
  assert(r.status === 200 && r.data.data.liked === true, 'B 点赞', r.data);
  r = await A.get('/api/posts/' + post.id);
  assert(r.data.data.post.likes === 1, '点赞数正确', r.data.data.post.likes);
  r = await B.post('/api/posts/' + post.id + '/comments', { body: '好可爱！' });
  assert(r.status === 200, 'B 评论', r.data);
  r = await A.get('/api/posts/' + post.id);
  assert(r.data.data.comments.length === 1, '评论列表', r.data.data.comments);
  r = await B.post('/api/posts/' + post.id + '/repost', { body: '转一个' });
  assert(r.status === 200 && r.data.data.post.repostOf, 'B 转发', r.data && r.data.data && r.data.data.post);

  console.log('\n[5] 可见性与好友');
  r = await A.post('/api/posts', { body: '只有好友能看', petId: pet.id, visibility: 'friends' });
  assert(r.status === 200, '发好友可见帖', r.data);
  const fpost = r.data.data.post;
  r = await B.get('/api/feed?tab=all');
  const seenBefore = r.data.data.items.some((x) => x.id === fpost.id);
  assert(!seenBefore, '非好友看不到好友帖', r.data.data.items.length);
  r = await B.post('/api/friends/request', { handle: 'alice' + stamp });
  assert(r.status === 200 && r.data.data.status === 'pending', 'B 发好友请求', r.data);
  r = await A.get('/api/friends');
  assert(r.data.data.incoming.length === 1, 'A 收到请求', r.data.data);
  r = await A.post('/api/friends/accept', { userId: bUser.id });
  assert(r.status === 200 && r.data.data.status === 'accepted', 'A 接受', r.data);
  r = await B.get('/api/feed?tab=friends');
  assert(r.data.data.items.some((x) => x.id === fpost.id), '好友后可见', r.data.data.items.length);
  r = await anon.get('/api/feed?tab=all');
  assert(!r.data.data.items.some((x) => x.id === fpost.id), '游客看不到好友帖', r.data.data.items.length);

  console.log('\n[6] 日记');
  r = await A.post('/api/diary', { title: '第一天', content: '豆豆今天学会了握手', mood: '开心', date: '2026-11-07', visibility: 'friends', petId: pet.id });
  assert(r.status === 200, '写日记', r.data);
  const entry = r.data.data.entry;
  r = await B.get('/api/users/alice' + stamp + '/diary');
  assert(r.data.data.items.some((x) => x.id === entry.id), '好友能看好友日记', r.data.data.items.length);
  r = await anon.get('/api/users/alice' + stamp + '/diary');
  assert(!r.data.data.items.some((x) => x.id === entry.id), '游客看不到', r.data.data.items.length);

  console.log('\n[7] 任务与等级');
  r = await A.get('/api/tasks');
  const tasks = r.data.data.tasks;
  assert(r.data.data.level.level >= 1, '等级信息', r.data.data.level);
  const done = tasks.filter((t) => t.done);
  assert(done.length >= 2, '至少完成 2 个任务', done.map((d) => d.code));
  assert(r.data.data.todayXp > 0, '今日经验 > 0', r.data.data.todayXp);
  r = await A.get('/api/me');
  assert(r.data.data.user.xp > 0, '/api/me 有 xp', r.data.data.user.xp);
  r = await A.get('/api/leaderboard');
  assert(r.status === 200 && r.data.data.items.length >= 2, '排行榜', r.data);

  console.log('\n[8] 权限边界');
  r = await B.del('/api/posts/' + post.id);
  assert(r.status === 403 || r.status === 404, 'B 不能删 A 的帖子', r.status);
  r = await B.post('/api/pets', { name: '' });
  assert(r.status === 400, '空宠物名被拒', r.status);
  r = await anon.post('/api/posts', { body: 'hi' });
  assert(r.status === 401, '未登录发帖被拒', r.status);
  r = await anon.get('/media/..%2f..%2fetc%2fpasswd');
  assert(r.status === 404 || r.status === 403, '路径穿越被拒', r.status);

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log(JSON.stringify({ alice: 'alice' + stamp, bob: 'bob' + stamp, postId: post.id }));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
