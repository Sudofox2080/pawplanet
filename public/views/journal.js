// 日记页 · #/journal（我的）与 #/u/:handle/journal（别人的）
// 数据：GET /api/diary?limit= → { items, moods }；GET /api/users/:handle/diary → { items }
import {
  h, api, state, handleError, toast, toastGained, modal, confirmModal,
  visPill, VIS_OPTIONS, speciesOf, pageHead, emptyState, loadingBlock, btn, field,
  photoFrame, fmtDate, fmtWeekday, relativeDay,
} from '../lib.js';

const MOODS = [
  { value: '开心', emoji: '😊', color: '#E08A4A' },
  { value: '平静', emoji: '🌿', color: '#7C9A73' },
  { value: '想念', emoji: '💭', color: '#8E7CA6' },
  { value: '担心', emoji: '😟', color: '#5B7FA6' },
  { value: '感动', emoji: '🥲', color: '#D2604A' },
  { value: '疲惫', emoji: '😮‍💨', color: '#9A8C6A' },
];

const moodOf = (v) => MOODS.find((m) => m.value === v) || { value: v || '', emoji: '🖊️', color: '#8C8377' };

const TWO = (n) => String(n).padStart(2, '0');

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${TWO(d.getMonth() + 1)}-${TWO(d.getDate())}`;
}

// date 是 'YYYY-MM-DD'，直接解析会按 UTC 走，这里补上本地零点
function parseDay(v) {
  if (!v) return null;
  const s = String(v);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00' : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayParts(v) {
  const d = parseDay(v);
  if (!d) return { day: '—', month: '', weekday: '', text: '' };
  return {
    day: TWO(d.getDate()),
    month: (d.getMonth() + 1) + ' 月',
    weekday: fmtWeekday(d.toISOString()),
    text: `${d.getFullYear()}-${TWO(d.getMonth() + 1)}-${TWO(d.getDate())}`,
  };
}

export default async function journalView(ctx) {
  const rawHandle = (ctx.params && ctx.params.handle) || '';
  const me = ctx.user || state.user || null;
  const isSelf = !rawHandle || !!(me && me.handle && String(me.handle).toLowerCase() === String(rawHandle).toLowerCase());
  const handle = isSelf && me ? me.handle : rawHandle;

  // 别人的日记本：拿个昵称当标题
  let ownerName = '';
  if (!isSelf && handle) {
    try {
      const prof = await api.get('/api/users/' + encodeURIComponent(handle));
      ownerName = (prof && prof.user && (prof.user.display || prof.user.handle)) || '';
    } catch (_) {
      ownerName = '';
    }
  }

  const ui = { mood: '', petId: '', items: [], moods: [], pets: [], editable: isSelf };

  const filterHost = h('div.journal-filters');
  const wallHost = h('div.journal-body', {}, loadingBlock('正在翻日记…'));

  const root = h('div.journal', {},
    pageHead(
      isSelf ? '我的日记' : (ownerName || handle) + ' 的日记',
      isSelf ? '写给它的那些小心思，攒着攒着就成了回忆' : '别人家毛孩子的日子，看着也暖和',
      isSelf ? [btn('写日记', () => openEditor(), { variant: 'primary', icon: '🖊️' })] : null
    ),
    filterHost,
    wallHost
  );

  await load();
  return root;

  function chip(label, active, onclick) {
    return h('button.chip' + (active ? '.is-active' : ''), { type: 'button', onclick }, label);
  }

  async function load() {
    wallHost.replaceChildren(loadingBlock('正在翻日记…'));
    try {
      const jobs = [api.get(isSelf ? '/api/diary?limit=40' : '/api/users/' + encodeURIComponent(handle) + '/diary')];
      if (isSelf) jobs.push(api.get('/api/pets').catch(() => null));
      const [main, petRes] = await Promise.all(jobs);
      ui.items = (main && main.items) || [];
      if (isSelf) {
        ui.pets = (petRes && petRes.items) || [];
      } else {
        const map = new Map();
        for (const e of ui.items) if (e.pet && !map.has(e.pet.id)) map.set(e.pet.id, e.pet);
        ui.pets = [...map.values()];
      }
      const seen = new Set();
      const moods = [];
      const pushMood = (m) => { if (m && !seen.has(m)) { seen.add(m); moods.push(m); } };
      for (const m of (main && main.moods) || []) pushMood(m);
      for (const e of ui.items) pushMood(e.mood);
      ui.moods = moods;
      if (!ui.moods.length) for (const m of MOODS) pushMood(m.value);
      if (ui.mood && !seen.has(ui.mood)) ui.mood = '';
      if (ui.petId && !ui.pets.some((p) => p.id === ui.petId)) ui.petId = '';
      renderFilters();
      renderWall();
    } catch (e) {
      wallHost.replaceChildren(emptyState('😿', e && e.message ? e.message : '日记没打开',
        btn('再试一次', () => load(), { sm: true, variant: 'ghost' })));
      handleError(e);
    }
  }

  function visibleItems() {
    return ui.items.filter((e) => (!ui.mood || e.mood === ui.mood) && (!ui.petId || e.petId === ui.petId));
  }

  function renderFilters() {
    const rows = [];
    if (ui.moods.length) {
      rows.push(h('div.journal-filter-row', {},
        h('span.journal-filter-cap', {}, '心情'),
        chip('全部', !ui.mood, () => { ui.mood = ''; renderFilters(); renderWall(); }),
        ui.moods.map((m) => {
          const mo = moodOf(m);
          return chip(mo.emoji + ' ' + m, ui.mood === m, () => {
            ui.mood = ui.mood === m ? '' : m;
            renderFilters();
            renderWall();
          });
        })
      ));
    }
    if (ui.pets.length) {
      rows.push(h('div.journal-filter-row', {},
        h('span.journal-filter-cap', {}, '毛孩子'),
        chip('全部', !ui.petId, () => { ui.petId = ''; renderFilters(); renderWall(); }),
        ui.pets.map((p) => chip(speciesOf(p.species).emoji + ' ' + p.name, ui.petId === p.id, () => {
          ui.petId = ui.petId === p.id ? '' : p.id;
          renderFilters();
          renderWall();
        }))
      ));
    }
    filterHost.replaceChildren(...rows);
  }

  function renderWall() {
    const list = visibleItems();
    if (!list.length) {
      const filtered = !!(ui.mood || ui.petId);
      const filteredOut = filtered && ui.items.length > 0;
      wallHost.replaceChildren(emptyState(
        '📖',
        filteredOut ? '这个条件下还没有日记' : '还没有日记…',
        filteredOut
          ? btn('看看全部', () => { ui.mood = ''; ui.petId = ''; renderFilters(); renderWall(); }, { sm: true, variant: 'ghost' })
          : isSelf ? btn('写第一篇', () => openEditor(), { sm: true, variant: 'primary' }) : null
      ));
      return;
    }
    wallHost.replaceChildren(
      h('div.journal-count.small.muted', {}, '一共 ' + list.length + ' 篇'),
      h('div.journal-wall', {}, list.map(card))
    );
  }

  function card(entry) {
    const mo = moodOf(entry.mood);
    const dp = dayParts(entry.date || entry.createdAt);
    return h('article.journal-card', {
      style: { '--mood-color': mo.color },
      onclick: () => openReader(entry),
    },
      h('div.journal-top', {},
        h('div.journal-date', {},
          h('span.journal-day', {}, dp.day),
          h('span.journal-month', {}, dp.month)
        ),
        h('span.journal-weekday', {}, dp.weekday)
      ),
      h('h3.journal-title', {}, entry.title || '无题'),
      h('div.journal-text', {}, entry.excerpt || entry.content || ''),
      entry.assets && entry.assets.length
        ? h('div.journal-photos', {}, entry.assets.slice(0, 3).map((a) => h('div.journal-photo', {}, photoFrame(a, { rounded: true }))))
        : null,
      h('div.journal-meta', {},
        entry.mood ? h('span.journal-mood', {}, mo.emoji + ' ' + entry.mood) : null,
        entry.pet ? h('span.chip.sm.pet-chip', {}, speciesOf(entry.pet.species).emoji + ' ' + entry.pet.name) : null,
        visPill(entry.visibility),
        isSelf
          ? h('button.btn.ghost.sm.journal-del', {
              type: 'button',
              onclick: (ev) => { ev.stopPropagation(); removeEntry(entry); },
            }, '删除')
          : null
      )
    );
  }

  function openReader(entry) {
    const mo = moodOf(entry.mood);
    const dp = dayParts(entry.date || entry.createdAt);
    const paragraphs = String(entry.content || '').split(/\n{1,}/).filter((p) => p.trim() !== '');
    modal({
      title: entry.title || '无题',
      wide: true,
      body: h('div.journal-read', {},
        h('div.journal-read-meta', {},
          h('span', {}, dp.text ? dp.text + ' ' + dp.weekday : relativeDay(entry.createdAt)),
          entry.mood ? h('span', { style: { color: mo.color } }, mo.emoji + ' ' + entry.mood) : null,
          entry.pet ? h('span', {}, speciesOf(entry.pet.species).emoji + ' ' + entry.pet.name) : null,
          visPill(entry.visibility)
        ),
        h('div.journal-read-body', {}, (paragraphs.length ? paragraphs : ['这一篇只留下了标题，正文是空的。']).map((p) => h('p', {}, p))),
        entry.assets && entry.assets.length
          ? h('div.journal-photos', {}, entry.assets.map((a) => h('div.journal-photo.is-big', {}, photoFrame(a, { rounded: true }))))
          : null
      ),
    });
  }

  async function removeEntry(entry) {
    const ok = await confirmModal(
      '把「' + (entry.title || '这篇日记') + '」删掉？写下的字就没了。',
      { okText: '删除', danger: true }
    );
    if (!ok) return;
    try {
      await api.del('/api/diary/' + entry.id);
      toast('已经删掉了', 'ok');
      await load();
    } catch (e) {
      handleError(e);
    }
  }

  function openEditor() {
    if (!isSelf) return;
    const draft = {
      title: '',
      date: todayISO(),
      mood: ui.moods[0] || '开心',
      content: '',
      visibility: 'public',
      petId: ui.pets[0] ? ui.pets[0].id : '',
    };
    let busy = false;

    const titleInput = h('input', { type: 'text', maxlength: 60, placeholder: '今天想记点什么' });
    titleInput.addEventListener('input', () => { draft.title = titleInput.value; });

    const dateInput = h('input', { type: 'date', value: draft.date });
    dateInput.addEventListener('input', () => { draft.date = dateInput.value; });

    const contentInput = h('textarea', { maxlength: 8000, placeholder: '写到哪儿算哪儿，没人在旁边打分。' });
    contentInput.style.minHeight = '180px';
    contentInput.addEventListener('input', () => { draft.content = contentInput.value; });

    const moodHost = h('div.chip-row');
    const visHost = h('div.chip-row');

    const petSelect = h('select', {},
      h('option', { value: '' }, '不关联也没关系'),
      ui.pets.map((p) => h('option', { value: p.id, selected: p.id === draft.petId }, speciesOf(p.species).emoji + ' ' + p.name))
    );
    petSelect.addEventListener('change', () => { draft.petId = petSelect.value; });

    function renderMoods() {
      moodHost.replaceChildren(...MOODS.map((m) => h('button.chip' + (draft.mood === m.value ? '.is-active' : ''), {
        type: 'button',
        onclick: () => { draft.mood = m.value; renderMoods(); },
      }, m.emoji + ' ' + m.value)));
    }

    function renderVis() {
      visHost.replaceChildren(...VIS_OPTIONS.map((v) => h('button.chip' + (draft.visibility === v.value ? '.is-active' : ''), {
        type: 'button',
        title: v.hint,
        onclick: () => { draft.visibility = v.value; renderVis(); },
      }, v.icon + ' ' + v.label)));
    }

    renderMoods();
    renderVis();

    const submitBtn = h('button.btn.primary', { type: 'button', onclick: () => submit() }, '写进去');

    const body = h('div.journal-form', {},
      field('标题', titleInput, '想不出来可以留着，正文第一行会替你补上'),
      h('div.form-grid.two', {},
        field('哪一天', dateInput),
        field('当时的心情', h('div', {}, moodHost))
      ),
      field('正文', contentInput),
      h('div.form-grid.two', {},
        field('和谁有关', petSelect),
        field('谁能看见', h('div', {}, visHost))
      )
    );

    const m = modal({
      title: '写日记',
      wide: true,
      body,
      actions: [
        h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, '先不写'),
        submitBtn,
      ],
    });

    async function submit() {
      if (busy) return;
      if (!draft.content.trim()) { toast('正文还空着', 'err'); return; }
      busy = true;
      submitBtn.disabled = true;
      const label = submitBtn.textContent;
      submitBtn.textContent = '保存中…';
      try {
        const res = await api.post('/api/diary', {
          title: draft.title.trim(),
          content: draft.content.trim(),
          mood: draft.mood,
          date: draft.date || todayISO(),
          visibility: draft.visibility,
          petId: draft.petId || null,
        });
        if (res && res.gained && res.gained.length) toastGained(res.gained);
        else toast('写下了', 'ok');
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
