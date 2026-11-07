'use strict';
// 演示数据：给 alice / bob 上传图片、发动态、写记录与日记、加好友
// 用法：node tools/seed-demo.js（服务需在 4780 运行）
const fs = require('fs');
const path = require('path');

const BASE = process.env.SITE || 'http://127.0.0.1:4780';
const ROOT = path.join(__dirname, '..');

function client() {
  let cookie = '';
  return {
    async req(method, url, body, isForm) {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      let payload;
      if (isForm) payload = body;
      else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
      const res = await fetch(BASE + url, { method, headers, body: payload });
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of sc) { const m = /^(pp_sid=[^;]+)/.exec(c); if (m) cookie = m[1]; }
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${typeof data === 'string' ? data.slice(0, 120) : JSON.stringify(data).slice(0, 200)}`);
      return data && data.ok !== undefined && 'data' in data ? data.data : data;
    },
    get(u) { return this.req('GET', u); },
    post(u, b) { return this.req('POST', u, b); },
    patch(u, b) { return this.req('PATCH', u, b); },
    async upload(file, kind) {
      const form = new FormData();
      form.append('kind', kind);
      const name = path.basename(file);
      const mime = name.endsWith('.png') ? 'image/png' : 'image/jpeg';
      form.append('file', new Blob([fs.readFileSync(file)], { type: mime }), name);
      return this.req('POST', '/api/upload', form, true);
    },
  };
}

async function login(c, handle, password) {
  try { return await c.post('/api/auth/login', { handle, password }); }
  catch (_) { return c.post('/api/auth/register', { handle, password, display: handle === 'alice' ? '爱丽丝' : '鲍勃' }); }
}

(async () => {
  const demo = (f) => path.join(ROOT, 'data', 'demo', f);

  const alice = client();
  await login(alice, 'alice', 'secret123');
  const bob = client();
  await login(bob, 'bob', 'secret123');

  const a = (await alice.get('/api/me')).user;
  const b = (await bob.get('/api/me')).user;
  console.log('users', a.handle, b.handle);

  // 宠物
  let pets = (await alice.get('/api/pets')).items;
  let dou = pets.find((p) => p.name === '豆豆');
  if (!dou) dou = (await alice.post('/api/pets', { name: '豆豆', species: 'dog', breed: '柯基', birthday: '2021-05-18', bio: '腿短但跑得快' })).pet;
  let bpets = (await bob.get('/api/pets')).items;
  let nai = bpets.find((p) => p.name === '奶糖');
  if (!nai) nai = (await bob.post('/api/pets', { name: '奶糖', species: 'cat', breed: '布偶', birthday: '2024-11-02', bio: '一岁的小奶糖' })).pet;

  // 头像/封面用演示图（第一次才设置）
  await alice.patch('/api/me', { display: '爱丽丝', bio: '豆豆的铲屎官，喜欢记录每一天' }).catch(() => {});

  // 上传照片
  const up = async (c, file, kind) => (await c.upload(demo(file), kind)).asset;
  const dou1 = await up(alice, 'dou1.png', 'photo');
  const dou2 = await up(alice, 'dou2.png', 'photo');
  const mi1 = await up(bob, 'mi1.png', 'photo');
  const mi2 = await up(bob, 'mi2.png', 'photo');

  // 贴纸素材（透明爪印）
  let sticker = null;
  for (const it of (await alice.get('/api/assets?kind=sticker')).items) sticker = it;
  if (!sticker && fs.existsSync(demo('sticker.png'))) sticker = await up(alice, 'sticker.png', 'sticker');

  // 宠物头像（文件存在且有变更才设，免得每次重传）
  if (fs.existsSync(demo('pet-dou.png')) && !dou.avatar) {
    const av = await up(alice, 'pet-dou.png', 'avatar');
    await alice.patch('/api/pets/' + dou.id, { avatar: av.url }).catch((e) => console.log('pet avatar alice', e.message));
  }
  if (fs.existsSync(demo('pet-nai.png')) && !nai.avatar) {
    const av = await up(bob, 'pet-nai.png', 'avatar');
    await bob.patch('/api/pets/' + nai.id, { avatar: av.url }).catch((e) => console.log('pet avatar bob', e.message));
  }

  const layout1 = {
    frame: { assetId: null, style: 'polaroid', url: null },
    layers: sticker ? [{ assetId: sticker.id, url: sticker.url, x: 0.22, y: 0.16, scale: 0.16, rotate: -12, opacity: 0.95 }] : [],
  };

  const posts = [
    { c: alice, body: '今天豆豆超乖，出门走了三圈还顺路去看了修狗朋友🐾', petId: dou.id, assets: [{ id: dou1.id }] },
    { c: bob, body: '奶糖一岁啦！还是那颗小奶糖，今天奖励多一勺罐头。', petId: nai.id, assets: [{ id: mi1.id }] },
    { c: alice, body: '窗台是它的王座，晒到打呼噜。', petId: dou.id, assets: [{ id: dou2.id, layout: layout1 }] },
    { c: bob, body: '给它试了新的相框，出片率意外地高。', petId: nai.id, assets: [{ id: mi2.id, layout: { frame: { assetId: null, style: 'rounded', url: null }, layers: [] } }] },
  ];

  const existing = (await alice.get('/api/feed?tab=mine&limit=50')).items || [];
  const existingBob = (await bob.get('/api/feed?tab=mine&limit=50')).items || [];
  const has = (list, body) => list.some((p) => (p.body || '').trim() === body);

  const created = [];
  for (const p of posts) {
    const mine = p.c === alice ? existing : existingBob;
    if (has(mine, p.body)) { console.log('skip post', p.body.slice(0, 12)); continue; }
    const r = await p.c.post('/api/posts', { body: p.body, visibility: 'public', petId: p.petId, assets: p.assets });
    created.push(r.post || r);
    console.log('post ok', p.body.slice(0, 10));
  }

  // 互动（幂等：先看已有评论，重复跑不会堆重复评论）
  const alicePosts = (await alice.get('/api/feed?tab=mine&limit=5')).items || [];
  const bobPosts = (await bob.get('/api/feed?tab=mine&limit=5')).items || [];
  const said = async (c, postId, body) => {
    if (!postId) return;
    const detail = await c.get('/api/posts/' + postId).catch(() => null);
    const list = (detail && detail.comments) || [];
    if (list.some((x) => x.body === body)) return;
    await c.post('/api/posts/' + postId + '/comments', { body });
  };
  try {
    if (bobPosts[0]) {
      await alice.post('/api/posts/' + bobPosts[0].id + '/like', {}).catch(() => {});
      await said(alice, bobPosts[0].id, '生日快乐，奶糖！🐱');
    }
    if (alicePosts[0]) {
      await bob.post('/api/posts/' + alicePosts[0].id + '/like', {}).catch(() => {});
      await said(bob, alicePosts[0].id, '豆豆今天真乖');
    }
  } catch (e) { console.log('interact skipped', e.message); }

  // 好友
  try { await alice.post('/api/friends/request', { handle: 'bob' }); } catch (e) { console.log('friend req', e.message); }
  try { await bob.post('/api/friends/accept', { userId: a.id }); } catch (e) { /* 已接受 */ }

  // 记录
  const recs = (await alice.get('/api/records')).items || [];
  if (recs.length < 6) {
    const today = new Date();
    // 按天铺开，时间线才像真的用了一阵子；上午/下午错开一点
    const iso = (d = 0, hour = 9) => {
      const t = new Date(today.getTime() - d * 86400000);
      t.setHours(hour, 10 + (d % 40), 0, 0);
      return t.toISOString();
    };
    const seed = [
      { type: 'walk', ts: iso(0, 18), data: { rounds: 3, minutes: 45, place: '小区花园' }, note: '跑得很欢' },
      { type: 'deworm', ts: iso(12, 10), data: { product: '拜宠清', nextDue: new Date(today.getTime() + 27 * 86400000).toISOString().slice(0, 10) }, note: '体内驱虫' },
      { type: 'medical', ts: iso(5, 15), data: { place: '乐乐宠物医院', doctor: '王医生', cost: 260 }, note: '皮肤有点红，开了药膏' },
      { type: 'weight', ts: iso(9, 8), data: { kg: 12.4 }, note: '体重稳定' },
      { type: 'bath', ts: iso(3, 20), data: {}, note: '洗完像只小狮子' },
      { type: 'walk', ts: iso(2, 7), data: { rounds: 2, minutes: 30, place: '河边绿道' }, note: '' },
      { type: 'walk', ts: iso(1, 18), data: { rounds: 2, minutes: 35, place: '小区' }, note: '' },
    ];
    for (const r of seed) {
      try { await alice.post('/api/records', { petId: dou.id, visibility: 'friends', ...r }); } catch (e) { console.log('record', e.message); }
    }
  }

  // 日记
  const diary = (await alice.get('/api/diary')).items || [];
  if (!diary.length) {
    const today = new Date();
    const day = (d = 0) => new Date(today.getTime() - d * 86400000).toISOString().slice(0, 10);
    const entries = [
      { date: day(0), visibility: 'friends', mood: '开心', title: '第一次学会握手', content: '练了十分钟就学会了，奖励了一块冻干。晚上又复习了两遍，居然还记得。' },
      { date: day(2), visibility: 'private', mood: '平静', title: '下雨没出门', content: '在客厅玩了半小时球，晚上早早睡了。明天要是放晴，就带它去河边那条道。' },
      { date: day(5), visibility: 'public', mood: '感动', title: '它好像听懂了我的话', content: '我说「去把球拿来」，它真的叼过来了。虽然可能只是闻到了冻干的味道，但我还是想记下来。' },
    ];
    for (const e of entries) {
      try { await alice.post('/api/diary', { petId: dou.id, ...e }); } catch (err) { console.log('diary', err.message); }
    }
  }

  console.log('demo seed done');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
