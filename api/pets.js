'use strict';
const { get, run, all, nowISO, normVis } = require('../lib/db');
const { bad, rid } = require('../lib/http');
const A = require('../lib/auth');
const F = require('../lib/feed');

const RECORD_TYPES = ['walk', 'deworm', 'medical', 'vaccine', 'weight', 'bath', 'train', 'food', 'other'];
const VIS_SQL = (viewerIsOwner, isFriend) =>
  viewerIsOwner ? "'public','friends','private'" : isFriend ? "'public','friends'" : "'public'";

function assertAssetIds(ids) {
  const out = [];
  for (const id of ids || []) {
    const a = F.assetById(String(id));
    if (!a) throw bad('bad_asset', '图片不存在：' + id);
    out.push(a.id);
  }
  return out;
}

function saveAssets(table, col, ownerId, ids) {
  ids.forEach((id, i) => {
    run(`INSERT OR IGNORE INTO ${table} (${col}, asset_id, sort) VALUES (?,?,?)`, ownerId, id, i);
  });
}

module.exports = (r) => {
  // ---------- 宠物 ----------
  r.get('/api/pets', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const q = ctx.query;
    const owner = q.handle
      ? (get('SELECT id FROM users WHERE handle = ?', String(q.handle).toLowerCase()) || {}).id
      : u.id;
    if (!owner) throw bad('not_found', '没有这个用户', 404);
    const items = all('SELECT * FROM pets WHERE user_id = ? ORDER BY created_at ASC', owner).map((p) => ({
      id: p.id, name: p.name, species: p.species, breed: p.breed, gender: p.gender,
      birthday: p.birthday, avatar: p.avatar, cover: p.cover, bio: p.bio, createdAt: p.created_at,
    }));
    ctx.ok({ items });
  });

  const SPECIES = ['dog', 'cat', 'rabbit', 'hamster', 'bird', 'fish', 'reptile', 'other'];
  const GENDERS = ['male', 'female', ''];
  const mediaPath = (v) => {
    const s = String(v || '').trim();
    return /^\/media\/[A-Za-z0-9._-]+$/.test(s) ? s : null;
  };
  const petFields = (b) => ({
    name: String(b.name || '').trim().slice(0, 20),
    species: SPECIES.includes(b.species) ? b.species : 'other',
    breed: String(b.breed || '').trim().slice(0, 30),
    gender: GENDERS.includes(b.gender) ? String(b.gender || '') : '',
    birthday: /^\d{4}-\d{2}-\d{2}$/.test(String(b.birthday || '')) ? String(b.birthday) : null,
    avatar: b.avatar === null || b.avatar === undefined ? null : mediaPath(b.avatar),
    cover: b.cover === null || b.cover === undefined ? null : mediaPath(b.cover),
    bio: String(b.bio || '').trim().slice(0, 200),
  });

  r.post('/api/pets', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const b = await ctx.json();
    const f = petFields(b);
    if (!f.name) throw bad('bad_name', '宠物名字不能为空');
    const id = rid();
    run(
      `INSERT INTO pets (id, user_id, name, species, breed, gender, birthday, avatar, cover, bio, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, u.id, f.name, f.species, f.breed, f.gender, f.birthday, f.avatar, f.cover, f.bio, nowISO()
    );
    const gained = F.bump(u.id, 'pet_create', 1);
    const p = get('SELECT * FROM pets WHERE id = ?', id);
    ctx.ok({ pet: { ...p, createdAt: p.created_at }, gained, level: (get('SELECT xp FROM users WHERE id=?', u.id) || {}).xp });
  });

  r.patch('/api/pets/:id', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const p = get('SELECT * FROM pets WHERE id = ?', ctx.params.id);
    if (!p || p.user_id !== u.id) throw bad('not_found', '没有这只宠物', 404);
    const b = await ctx.json();
    const allowed = petFields({ ...p, ...b });
    const map = { name: 'name', species: 'species', breed: 'breed', gender: 'gender', birthday: 'birthday', avatar: 'avatar', cover: 'cover', bio: 'bio' };
    const sets = [], params = [];
    for (const [k, col] of Object.entries(map)) {
      if (b[k] !== undefined) {
        const v = allowed[k];
        if (k === 'name' && !v) throw bad('bad_name', '宠物名字不能为空');
        sets.push(`${col} = ?`); params.push(v === '' ? null : v);
      }
    }
    if (!sets.length) throw bad('nothing', '没有要更新的字段');
    run(`UPDATE pets SET ${sets.join(', ')} WHERE id = ?`, ...params, p.id);
    const fresh = get('SELECT * FROM pets WHERE id = ?', p.id);
    ctx.ok({ pet: { ...fresh, createdAt: fresh.created_at } });
  });

  r.delete('/api/pets/:id', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const p = get('SELECT * FROM pets WHERE id = ?', ctx.params.id);
    if (!p || p.user_id !== u.id) throw bad('not_found', '没有这只宠物', 404);
    run('DELETE FROM pets WHERE id = ?', p.id);
    ctx.ok({});
  });

  // ---------- 记录 ----------
  const summaryOf = (userId, petId) => {
    const rows = petId
      ? all('SELECT * FROM records WHERE user_id = ? AND pet_id = ?', userId, petId)
      : all('SELECT * FROM records WHERE user_id = ?', userId);
    const since = Date.now() - 30 * 86400000;
    let dewormNextDue = null;
    let lastWalkAt = null;
    let walkRounds30d = 0;
    let records30d = 0;
    let visits30d = 0;
    let lastWeight = null;
    for (const row of rows) {
      const d = F.safeJSON(row.data, {});
      const t = new Date(row.ts).getTime();
      if (row.type === 'deworm' && d.nextDue) {
        const due = new Date(d.nextDue).getTime();
        if (due && (!dewormNextDue || due < new Date(dewormNextDue).getTime())) dewormNextDue = d.nextDue;
      }
      if (row.type === 'walk') {
        if (!lastWalkAt || row.ts > lastWalkAt) lastWalkAt = row.ts;
        if (t >= since) walkRounds30d += Number(d.rounds || 0);
      }
      if (row.type === 'weight' && d.kg) lastWeight = { kg: Number(d.kg), ts: row.ts };
      if (t >= since) { records30d++; if (row.type === 'medical') visits30d++; }
    }
    return { dewormNextDue, lastWalkAt, walkRounds30d, records30d, visits30d, lastWeight, total: rows.length };
  };

  r.get('/api/records', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const q = ctx.query;
    const where = ['r.user_id = ?'];
    const params = [u.id];
    if (q.petId) { where.push('r.pet_id = ?'); params.push(String(q.petId)); }
    if (q.type) { where.push('r.type = ?'); params.push(String(q.type)); }
    const lim = Math.min(200, parseInt(q.limit, 10) || 60);
    const rows = all(`SELECT r.* FROM records r WHERE ${where.join(' AND ')} ORDER BY r.ts DESC LIMIT ${lim}`, ...params);
    const pets = all('SELECT id, name, avatar, species FROM pets WHERE user_id = ? ORDER BY created_at ASC', u.id);
    ctx.ok({ items: rows.map(F.recordOut), summary: summaryOf(u.id, q.petId || null), types: RECORD_TYPES, pets });
  });

  r.post('/api/records', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const b = await ctx.json();
    const type = String(b.type || '');
    if (!RECORD_TYPES.includes(type)) throw bad('bad_type', '不认识的记录类型');
    const title = String(b.title || '').trim().slice(0, 40) || ({ walk: '遛狗', deworm: '驱虫', medical: '就诊', vaccine: '疫苗', weight: '称重', bath: '洗澡', train: '训练', food: '喂食', other: '记录' }[type]);
    const petId = b.petId ? String(b.petId) : null;
    if (petId && !get('SELECT 1 AS x FROM pets WHERE id = ? AND user_id = ?', petId, u.id)) throw bad('bad_pet', '宠物不存在');
    const id = rid();
    const ts = b.ts ? new Date(b.ts).toISOString() : nowISO();
    const dataObj = { ...(b.data && typeof b.data === 'object' ? b.data : {}) };
    if (b.rounds !== undefined) dataObj.rounds = Number(b.rounds) || 0;
    if (b.minutes !== undefined) dataObj.minutes = Number(b.minutes) || 0;
    if (b.kg !== undefined) dataObj.kg = Number(b.kg) || 0;
    if (b.place !== undefined) dataObj.place = String(b.place).slice(0, 60);
    // 其余标量字段（product / nextDue / clinic / diagnosis / cost / nextVisit …）一并收进 data，免得被静默丢掉
    const RESERVED = new Set(['type', 'title', 'note', 'ts', 'petId', 'visibility', 'assets', 'data', 'rounds', 'minutes', 'kg', 'place']);
    for (const [k, v] of Object.entries(b)) {
      if (RESERVED.has(k)) continue;
      if (v === null || v === undefined || typeof v === 'object') continue;
      const s = String(v).trim().slice(0, 120);
      if (s) dataObj[k] = s;
    }
    run(
      `INSERT INTO records (id, user_id, pet_id, type, title, note, ts, data, visibility, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      id, u.id, petId, type, title, String(b.note || '').slice(0, 1000), ts,
      JSON.stringify(dataObj), normVis(b.visibility), nowISO()
    );
    saveAssets('record_assets', 'record_id', id, assertAssetIds(b.assets));
    let gained = F.bump(u.id, 'record_log', 1);
    if (type === 'walk') gained = gained.concat(F.bump(u.id, 'walk_log', 1));
    if (type === 'deworm' || type === 'medical') gained = gained.concat(F.bump(u.id, 'health_log', 1));
    const row = get('SELECT * FROM records WHERE id = ?', id);
    ctx.ok({ record: F.recordOut(row), gained, summary: summaryOf(u.id, petId) });
  });

  r.patch('/api/records/:id', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const rec = get('SELECT * FROM records WHERE id = ?', ctx.params.id);
    if (!rec || rec.user_id !== u.id) throw bad('not_found', '记录不存在', 404);
    const b = await ctx.json();
    const sets = [], params = [];
    if (b.type !== undefined) {
      if (!RECORD_TYPES.includes(b.type)) throw bad('bad_type', '不认识的记录类型');
      sets.push('type = ?'); params.push(b.type);
    }
    if (b.title !== undefined) { sets.push('title = ?'); params.push(String(b.title).slice(0, 40)); }
    if (b.note !== undefined) { sets.push('note = ?'); params.push(String(b.note).slice(0, 1000)); }
    if (b.ts !== undefined) { sets.push('ts = ?'); params.push(new Date(b.ts).toISOString()); }
    if (b.data !== undefined || b.rounds !== undefined || b.kg !== undefined || b.minutes !== undefined || b.place !== undefined) {
      const merged = { ...F.safeJSON(rec.data, {}), ...(b.data && typeof b.data === 'object' ? b.data : {}) };
      if (b.rounds !== undefined) merged.rounds = Number(b.rounds) || 0;
      if (b.minutes !== undefined) merged.minutes = Number(b.minutes) || 0;
      if (b.kg !== undefined) merged.kg = Number(b.kg) || 0;
      if (b.place !== undefined) merged.place = String(b.place).slice(0, 60);
      sets.push('data = ?'); params.push(JSON.stringify(merged));
    }
    if (b.visibility !== undefined) { sets.push('visibility = ?'); params.push(normVis(b.visibility)); }
    if (b.petId !== undefined) { sets.push('pet_id = ?'); params.push(b.petId || null); }
    if (sets.length) run(`UPDATE records SET ${sets.join(', ')} WHERE id = ?`, ...params, rec.id);
    if (Array.isArray(b.assets)) {
      run('DELETE FROM record_assets WHERE record_id = ?', rec.id);
      saveAssets('record_assets', 'record_id', rec.id, assertAssetIds(b.assets));
    }
    ctx.ok({ record: F.recordOut(get('SELECT * FROM records WHERE id = ?', rec.id)) });
  });

  r.delete('/api/records/:id', async (ctx) => {
    const u = A.requireUser(ctx.user);
    const rec = get('SELECT * FROM records WHERE id = ?', ctx.params.id);
    if (!rec || rec.user_id !== u.id) throw bad('not_found', '记录不存在', 404);
    run('DELETE FROM records WHERE id = ?', rec.id);
    ctx.ok({});
  });

  // 他人主页的记录（受可见性限制）
  r.get('/api/users/:handle/records', async (ctx) => {
    const owner = get('SELECT * FROM users WHERE handle = ?', String(ctx.params.handle).toLowerCase());
    if (!owner) throw bad('not_found', '没有这个用户', 404);
    const isSelf = !!ctx.user && ctx.user.id === owner.id;
    const isFriend = !!ctx.user && F.canView(owner.id, 'friends', ctx.user.id);
    const vis = VIS_SQL(isSelf, isFriend);
    const q = ctx.query;
    const params = [owner.id];
    let extra = '';
    if (q.petId) { extra += ' AND r.pet_id = ?'; params.push(String(q.petId)); }
    const rows = all(
      `SELECT r.* FROM records r WHERE r.user_id = ? AND r.visibility IN (${vis})${extra}
       ORDER BY r.ts DESC LIMIT 100`, ...params
    );
    const pets = all('SELECT id, name, avatar, species FROM pets WHERE user_id = ?', owner.id);
    ctx.ok({ items: rows.map(F.recordOut), pets, summary: summaryOf(owner.id, q.petId || null) });
  });
};
