// 记录页 · #/records（我的）与 #/u/:handle/records（别人的）
// 数据：GET /api/records?petId=&type=&limit= → { items, summary, types }
//       GET /api/users/:handle/records?petId= → { items, pets, summary }
import {
  h, api, state, navigate, handleError, toast, toastGained, modal, confirmModal,
  visPill, VIS_OPTIONS, RECORD_TYPES, recordType, speciesOf, pageHead, emptyState,
  loadingBlock, btn, field, photoFrame, timeAgo, fmtDate, relativeDay, dayKeyLocal,
} from '../lib.js';

const TWO = (n) => String(n).padStart(2, '0');

// 2026-11-07 → 保持原样，避免时区把它挪走；带时间的才格式化
function dateOnly(v) {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fmtDate(s);
}

function clockOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return TWO(d.getHours()) + ':' + TWO(d.getMinutes());
}

function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${TWO(d.getMonth() + 1)}-${TWO(d.getDate())}T${TWO(d.getHours())}:${TWO(d.getMinutes())}`;
}

function isoOrNow(local) {
  const d = local ? new Date(local) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// 距下次驱虫还有几天（null = 没安排）
function daysUntil(v) {
  if (!v) return null;
  const s = String(v);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00' : s);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function chip(label, active, onclick) {
  return h('button.chip' + (active ? '.is-active' : ''), { type: 'button', onclick }, label);
}

// 每种类型要展示的结构化字段
function factsFor(type, d) {
  const out = [];
  if (!d) return out;
  if (type === 'walk') {
    if (d.rounds !== undefined && d.rounds !== '' && d.rounds !== null) out.push(['圈数', d.rounds + ' 圈']);
    if (d.minutes) out.push(['时长', d.minutes + ' 分钟']);
    if (d.place) out.push(['地点', d.place]);
  } else if (type === 'deworm' || type === 'vaccine') {
    if (d.product) out.push([type === 'vaccine' ? '疫苗' : '用药', d.product]);
    if (d.nextDue) out.push(['下次', dateOnly(d.nextDue)]);
  } else if (type === 'medical') {
    if (d.clinic) out.push(['医院', d.clinic]);
    if (d.diagnosis) out.push(['诊断', d.diagnosis]);
    if (d.cost) out.push(['花费', '¥' + d.cost]);
    if (d.nextVisit) out.push(['复诊', dateOnly(d.nextVisit)]);
  } else if (type === 'weight') {
    if (d.kg) out.push(['体重', d.kg + ' kg']);
  }
  return out;
}

// 提交前把表单值收拾成服务端认的 data 形状
function cleanData(type, raw) {
  const out = {};
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const str = (v) => String(v === null || v === undefined ? '' : v).trim().slice(0, 60);
  const filled = (v) => v !== null && v !== undefined && String(v).trim() !== '';
  if (type === 'walk') {
    out.rounds = num(raw.rounds);
    if (filled(raw.minutes)) out.minutes = num(raw.minutes);
    if (str(raw.place)) out.place = str(raw.place);
  } else if (type === 'weight') {
    out.kg = num(raw.kg);
  } else if (type === 'deworm' || type === 'vaccine') {
    if (str(raw.product)) out.product = str(raw.product);
    if (filled(raw.nextDue)) out.nextDue = String(raw.nextDue).slice(0, 10);
  } else if (type === 'medical') {
    if (str(raw.clinic)) out.clinic = str(raw.clinic);
    if (str(raw.diagnosis)) out.diagnosis = str(raw.diagnosis);
    if (filled(raw.cost)) out.cost = num(raw.cost);
    if (filled(raw.nextVisit)) out.nextVisit = String(raw.nextVisit).slice(0, 10);
  }
  return out;
}

// 每种类型在弹窗里多出来的那几格（放在模块作用域，视图 return 之后不可再用 const）
const EXTRA_FIELDS = {
  walk: [
    { key: 'rounds', label: '绕了几圈', type: 'number', ph: '3', min: 0 },
    { key: 'minutes', label: '遛了多久（分钟）', type: 'number', ph: '40', min: 0 },
    { key: 'place', label: '在哪儿', type: 'text', ph: '小区后面的公园' },
  ],
  deworm: [
    { key: 'product', label: '用的什么药', type: 'text', ph: '拜宠清' },
    { key: 'nextDue', label: '下次什么时候', type: 'date' },
  ],
  medical: [
    { key: 'clinic', label: '哪家医院', type: 'text', ph: '安心动物医院' },
    { key: 'diagnosis', label: '医生怎么说', type: 'text', ph: '轻度真菌，涂药一周' },
    { key: 'cost', label: '花了多少（元）', type: 'number', ph: '320', min: 0 },
    { key: 'nextVisit', label: '下次复诊', type: 'date' },
  ],
  vaccine: [
    { key: 'product', label: '打的什么针', type: 'text', ph: '狂犬疫苗' },
    { key: 'nextDue', label: '下次什么时候', type: 'date' },
  ],
  weight: [
    { key: 'kg', label: '体重（公斤）', type: 'number', ph: '12.4', step: '0.1', min: 0 },
  ],
};

export default async function recordsView(ctx) {
  const rawHandle = (ctx.params && ctx.params.handle) || '';
  const me = ctx.user || state.user || null;
  const isSelf = !rawHandle || !!(me && me.handle && String(me.handle).toLowerCase() === String(rawHandle).toLowerCase());
  const handle = isSelf && me ? me.handle : rawHandle;

  // 别人的档案：先拿一下昵称，标题比裸露的 handle 好看
  let ownerName = '';
  if (!isSelf && handle) {
    try {
      const prof = await api.get('/api/users/' + encodeURIComponent(handle));
      ownerName = (prof && prof.user && (prof.user.display || prof.user.handle)) || '';
    } catch (_) {
      ownerName = '';
    }
  }

  const ui = {
    petId: (ctx.query && ctx.query.petId) || '',
    type: (ctx.query && ctx.query.type) || '',
    items: [],
    summary: null,
    pets: [],
    editable: isSelf,
  };

  const statsHost = h('div.records-stats');
  const filterHost = h('div.records-filters');
  const listHost = h('div.records-body', {}, loadingBlock('正在翻记录…'));

  const root = h('div.records', {},
    pageHead(
      isSelf ? '我的记录' : (ownerName || handle) + ' 的记录',
      isSelf ? '遛弯、驱虫、看病、称重，一天一天攒成它的成长档案' : '只显示你有权看到的那部分',
      isSelf ? [btn('记一笔', () => openEditor(null), { variant: 'primary', icon: '✍️' })] : null
    ),
    statsHost,
    filterHost,
    listHost
  );

  await load();
  return root;

  /* ---------------- 取数 ---------------- */
  async function load() {
    listHost.replaceChildren(loadingBlock('正在翻记录…'));
    try {
      const qs = new URLSearchParams();
      if (ui.petId) qs.set('petId', ui.petId);
      if (ui.type) qs.set('type', ui.type);
      qs.set('limit', '60');
      const base = isSelf ? '/api/records' : '/api/users/' + encodeURIComponent(handle) + '/records';
      const jobs = [api.get(base + '?' + qs.toString())];
      if (isSelf) jobs.push(api.get('/api/pets').catch(() => null));
      const [main, petRes] = await Promise.all(jobs);
      ui.items = (main && main.items) || [];
      ui.summary = (main && main.summary) || null;
      ui.pets = (isSelf ? (petRes && petRes.items) : (main && main.pets)) || [];
      renderStats();
      renderFilters();
      renderList();
    } catch (e) {
      listHost.replaceChildren(
        emptyState('😿', e && e.message ? e.message : '记录没加载出来',
          btn('再试一次', () => load(), { sm: true, variant: 'ghost' }))
      );
      handleError(e);
    }
  }

  /* ---------------- 顶部四张小卡 ---------------- */
  function statCard(value, label, sub, tone) {
    return h('div.records-stat' + (tone ? '.is-' + tone : ''), {},
      h('div.records-stat-val', {}, value),
      h('div.records-stat-label', {}, label),
      sub ? h('div.records-stat-sub', {}, sub) : null
    );
  }

  function renderStats() {
    const s = ui.summary || {};
    const rounds = Number(s.walkRounds30d || 0);
    const total = Number(s.total == null ? ui.items.length : s.total);
    const lastWalk = s.lastWalkAt || null;
    const due = s.dewormNextDue || null;
    const days = daysUntil(due);
    let dueSub = '记一条驱虫，这里就会替你排下一次';
    if (days !== null) dueSub = days < 0 ? '已经过了 ' + (-days) + ' 天' : days === 0 ? '就是今天' : '还有 ' + days + ' 天';
    statsHost.replaceChildren(
      statCard(String(rounds), '近 30 天遛弯圈数', '档案里一共 ' + total + ' 条'),
      statCard(lastWalk ? relativeDay(lastWalk) : '还没遛', '上次遛狗', lastWalk ? timeAgo(lastWalk) : '挑个好天气出门吧'),
      statCard(due ? dateOnly(due) : '未安排', '下次驱虫', dueSub, days !== null && days <= 7 ? 'warn' : ''),
      statCard(String(Number(s.records30d || 0)), '近 30 天记录', '其中就诊 ' + Number(s.visits30d || 0) + ' 次')
    );
  }

  /* ---------------- 筛选条 ---------------- */
  function renderFilters() {
    const rows = [];
    if (ui.pets.length) {
      rows.push(h('div.records-filter-row', {},
        h('span.records-filter-cap', {}, '毛孩子'),
        chip('全部', !ui.petId, () => { ui.petId = ''; load(); }),
        ui.pets.map((p) => chip(speciesOf(p.species).emoji + ' ' + p.name, ui.petId === p.id, () => {
          ui.petId = ui.petId === p.id ? '' : p.id;
          load();
        }))
      ));
    }
    rows.push(h('div.records-filter-row', {},
      h('span.records-filter-cap', {}, '类型'),
      chip('全部', !ui.type, () => { ui.type = ''; load(); }),
      RECORD_TYPES.map((t) => chip(t.emoji + ' ' + t.label, ui.type === t.value, () => {
        ui.type = ui.type === t.value ? '' : t.value;
        load();
      }))
    ));
    filterHost.replaceChildren(...rows);
  }

  /* ---------------- 时间线 ---------------- */
  function renderList() {
    if (!ui.items.length) {
      const filtered = !!(ui.type || ui.petId);
      listHost.replaceChildren(emptyState(
        '🗂️',
        filtered ? '这些条件下还没有记录' : '还没有记录…',
        isSelf ? btn(filtered ? '看看全部' : '记一笔', () => {
          if (filtered) { ui.type = ''; ui.petId = ''; load(); } else openEditor(null);
        }, { sm: true, variant: filtered ? 'ghost' : 'primary' }) : null
      ));
      return;
    }

    const groups = new Map();
    for (const rec of ui.items) {
      const key = dayKeyLocal(rec.ts || rec.createdAt);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(rec);
    }

    listHost.replaceChildren(h('div.records-timeline', {},
      [...groups.values()].map((list) => h('section.records-day', {},
        h('div.records-day-head', {},
          h('span.records-day-title', {}, relativeDay(list[0].ts || list[0].createdAt)),
          h('span.records-day-count', {}, list.length + ' 条')
        ),
        h('div.records-list', {}, list.map(recordCard))
      ))
    ));
  }

  function recordCard(rec) {
    const t = recordType(rec.type);
    const facts = factsFor(rec.type, rec.data);
    return h('div.records-item', {},
      h('span.records-dot', { style: { background: t.color } }),
      h('div.records-card', {},
        h('div.records-card-head', {},
          h('div.records-title', {}, h('span.records-emoji', {}, t.emoji), rec.title || t.label),
          h('span.records-time', {}, clockOf(rec.ts))
        ),
        rec.note ? h('div.records-note', {}, rec.note) : null,
        facts.length
          ? h('div.records-facts', {}, facts.map((f) => h('div.records-fact', {},
              h('span.k', {}, f[0]),
              h('span.v', {}, String(f[1]))
            )))
          : null,
        rec.assets && rec.assets.length
          ? h('div.records-thumbs', {}, rec.assets.slice(0, 4).map((a) => h('div.records-thumb', {}, photoFrame(a, { rounded: true, onOpen: openPhoto }))))
          : null,
        h('div.records-card-foot', {},
          visPill(rec.visibility),
          rec.pet ? h('span.chip.sm.pet-chip', {}, speciesOf(rec.pet.species).emoji + ' ' + rec.pet.name) : null,
          ui.editable
            ? h('div.records-actions', {},
                h('button.btn.ghost.sm', { type: 'button', onclick: () => openEditor(rec) }, '编辑'),
                h('button.btn.ghost.sm', { type: 'button', onclick: () => removeRecord(rec) }, '删除')
              )
            : null
        )
      )
    );
  }

  function openPhoto(asset) {
    modal({
      title: '照片',
      wide: true,
      body: h('img', { src: asset.url || asset.thumb, alt: '', style: { width: '100%', borderRadius: '14px' } }),
    });
  }

  async function removeRecord(rec) {
    const ok = await confirmModal(
      '把「' + (rec.title || recordType(rec.type).label) + '」这条记录删掉？删了就找不回来了。',
      { okText: '删除', danger: true }
    );
    if (!ok) return;
    try {
      await api.del('/api/records/' + rec.id);
      toast('已经删掉了', 'ok');
      await load();
    } catch (e) {
      handleError(e);
    }
  }

  /* ---------------- 新建 / 编辑 ---------------- */
  function openEditor(rec) {
    if (!ui.editable) return;
    const isEdit = !!rec;
    if (!ui.pets.length) {
      confirmModal('还没有毛孩子的档案，先给它建一个再记吧？', { okText: '去创建' })
        .then((ok) => { if (ok) navigate('#/settings'); });
      return;
    }

    const draft = {
      type: rec ? rec.type : 'walk',
      petId: (rec && rec.petId) || ui.petId || ui.pets[0].id,
      title: rec ? rec.title || '' : '',
      ts: toLocalInput(rec ? rec.ts : new Date().toISOString()),
      note: rec ? rec.note || '' : '',
      visibility: rec ? rec.visibility || 'public' : 'public',
      data: rec && rec.data ? { ...rec.data } : {},
    };

    let busy = false;

    const petSelect = h('select', {},
      ui.pets.map((p) => h('option', { value: p.id, selected: p.id === draft.petId }, speciesOf(p.species).emoji + ' ' + p.name))
    );
    petSelect.addEventListener('change', () => { draft.petId = petSelect.value; });

    const titleInput = h('input', { type: 'text', maxlength: 40, placeholder: '给这次记录起个名字', value: draft.title });
    titleInput.addEventListener('input', () => { draft.title = titleInput.value; });

    const tsInput = h('input.records-datetime', { type: 'datetime-local', value: draft.ts });
    tsInput.addEventListener('input', () => { draft.ts = tsInput.value; });

    const noteInput = h('textarea', { maxlength: 1000, placeholder: '它当时什么反应、天气怎么样、下次要注意什么…' });
    noteInput.value = draft.note;
    noteInput.addEventListener('input', () => { draft.note = noteInput.value; });

    const typeHost = h('div.records-typegrid');
    const typeHint = h('div.records-hint');
    const extraHost = h('div.records-extra');
    const visHost = h('div.chip-row');

    function renderType() {
      typeHost.classList.toggle('is-locked', isEdit);
      typeHost.replaceChildren(...RECORD_TYPES.map((t) => {
        const active = draft.type === t.value;
        const b = h('button.chip' + (active ? '.is-active' : ''), {
          type: 'button',
          disabled: isEdit && !active,
          onclick: () => {
            if (isEdit) return;
            draft.type = t.value;
            draft.data = {};
            renderType();
            renderExtra();
          },
        }, t.emoji + ' ' + t.label);
        return b;
      }));
      typeHint.textContent = isEdit ? '类型建好之后改不了，想换就删掉重记一条' : '';
    }

    function renderExtra() {
      const conf = EXTRA_FIELDS[draft.type] || [];
      if (!conf.length) {
        extraHost.replaceChildren(h('div.records-hint', {}, draft.type === 'other' ? '这类就写在备注里吧' : ''));
        return;
      }
      extraHost.replaceChildren(...conf.map((f) => {
        const input = h('input', {
          type: f.type,
          placeholder: f.ph || '',
          value: draft.data[f.key] === null || draft.data[f.key] === undefined ? '' : String(draft.data[f.key]),
        });
        if (f.min !== undefined) input.min = String(f.min);
        if (f.step) input.step = f.step;
        input.addEventListener('input', () => { draft.data[f.key] = input.value; });
        return field(f.label, input);
      }));
    }

    function renderVis() {
      visHost.replaceChildren(...VIS_OPTIONS.map((v) => h('button.chip' + (draft.visibility === v.value ? '.is-active' : ''), {
        type: 'button',
        title: v.hint,
        onclick: () => { draft.visibility = v.value; renderVis(); },
      }, v.icon + ' ' + v.label)));
    }

    renderType();
    renderExtra();
    renderVis();

    const submitBtn = h('button.btn.primary', { type: 'button', onclick: () => submit() }, isEdit ? '保存修改' : '存进档案');

    const body = h('div.records-form', {},
      field('这是谁的事儿', petSelect),
      h('div.records-form-block', {}, h('div.records-form-cap', {}, '记点什么'), typeHost, typeHint),
      field('名字', titleInput),
      h('div.form-grid.two', {},
        field('什么时候', tsInput),
        field('谁能看见', h('div', {}, visHost))
      ),
      extraHost,
      field('备注', noteInput, '不写也没关系，只有你想留的时候才写')
    );

    const m = modal({
      title: isEdit ? '改一改这条记录' : '记一笔',
      body,
      actions: [
        h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, '取消'),
        submitBtn,
      ],
    });

    async function submit() {
      if (busy) return;
      if (!draft.petId) { toast('先选一只毛孩子', 'err'); return; }
      if (!isEdit && !draft.title.trim() && !draft.note.trim()) {
        toast('写点什么吧，一句话也行', 'err');
        titleInput.focus();
        return;
      }
      busy = true;
      submitBtn.disabled = true;
      const label = submitBtn.textContent;
      submitBtn.textContent = '保存中…';
      try {
        const payload = {
          petId: draft.petId,
          type: draft.type,
          title: draft.title.trim(),
          note: draft.note.trim(),
          ts: isoOrNow(draft.ts),
          visibility: draft.visibility,
          data: cleanData(draft.type, draft.data),
        };
        if (isEdit) {
          await api.patch('/api/records/' + rec.id, {
            petId: payload.petId,
            title: payload.title,
            note: payload.note,
            ts: payload.ts,
            visibility: payload.visibility,
            data: payload.data,
          });
          toast('改好了', 'ok');
        } else {
          const res = await api.post('/api/records', payload);
          if (res && res.gained && res.gained.length) toastGained(res.gained);
          else toast('记下了', 'ok');
        }
        m.close();
        await load();
      } catch (e) {
        handleError(e);
        busy = false;
        submitBtn.disabled = false;
        submitBtn.textContent = label;
      }
    }
  }
}
