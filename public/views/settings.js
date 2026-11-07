// 设置：个人资料 / 毛孩子 / 安全 / 会话
import {
  h, api, state, avatarEl, pageHead, emptyState, loadingBlock, btn, field,
  modal, confirmModal, toast, handleError, uploadFile, compressImage,
  fmtDate, speciesOf, SPECIES, navigate,
} from '../lib.js';

const GENDERS = [
  { value: '', label: '还没填' },
  { value: 'male', label: '男孩' },
  { value: 'female', label: '女孩' },
];
const genderLabel = (v) => (GENDERS.find((g) => g.value === v) || GENDERS[0]).label;

// 服务端把 avatar / cover 存成 asset id，这里只在它确实是图片地址时才当 src 用，
// 否则退回头像首字，避免拼出 404 的 <img>。
const looksLikeUrl = (v) => typeof v === 'string'
  && (/^(https?:)?\/\//.test(v) || v.startsWith('/') || v.startsWith('data:') || v.startsWith('blob:'));
const picUrl = (v) => (looksLikeUrl(v) ? v : null);

function face(o, size) {
  const name = (o && (o.display || o.name)) || '？';
  return avatarEl({ name, avatar: picUrl(o && o.avatar) }, size);
}

export default async function settings(ctx) {
  let me = ctx.user || state.user || {};

  const root = h('div.settings');
  root.appendChild(pageHead('设置', '资料、毛孩子和账号上的事，都在这一页'));

  /* ================= 1. 资料 ================= */
  let avatarUrl = picUrl(me.avatar) || '';
  let coverUrl = picUrl(me.cover) || '';

  const avatarSlot = h('button.settings-avatar', { type: 'button', title: '换一张头像', onclick: () => pickImage('avatar', setAvatar) });
  const coverBox = h('div.settings-cover', { title: '换一张封面', onclick: () => pickImage('cover', setCover) });

  function paintAvatar() {
    avatarSlot.replaceChildren(
      face({ name: me.display || me.handle, avatar: avatarUrl }, 88),
      h('span.settings-avatar-edit', {}, '更换')
    );
  }
  function paintCover() {
    coverBox.replaceChildren(
      coverUrl
        ? h('img', { src: coverUrl, alt: '封面' })
        : h('div.settings-cover-hint', {}, '还没有封面。挑一张它最舒展的照片吧。'),
      h('span.settings-cover-edit', {}, '更换封面')
    );
  }
  paintAvatar();
  paintCover();

  async function setAvatar(asset) {
    avatarUrl = asset.url || '';
    paintAvatar();
    paintSession();
    try {
      await api.patch('/api/me', { avatar: asset.id });
      const fresh = await ctx.refreshUser();
      if (fresh) me = fresh;
      toast('头像换好了', 'ok');
    } catch (e) { handleError(e); }
  }

  async function setCover(asset) {
    coverUrl = asset.url || '';
    paintCover();
    try {
      await api.patch('/api/me', { cover: asset.id });
      const fresh = await ctx.refreshUser();
      if (fresh) me = fresh;
      toast('封面换好了', 'ok');
    } catch (e) { handleError(e); }
  }

  function pickImage(kind, done) {
    const input = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      try {
        const small = await compressImage(file, kind === 'avatar' ? 640 : 1600, 0.86);
        const up = await uploadFile(small, kind);
        const asset = (up && up.asset) || up;
        if (!asset || !asset.id) throw new Error('图片没传上去，再试一次');
        await done(asset);
      } catch (e) { handleError(e); }
    });
    document.body.appendChild(input);
    input.click();
  }

  const displayInput = h('input', { type: 'text', maxlength: 24, value: me.display || '', placeholder: '显示给别人的名字' });
  const bioInput = h('textarea', { rows: 4, maxlength: 300, placeholder: '它是什么脾气，你俩怎么认识的，家里还有谁' });
  bioInput.value = me.bio || '';
  const bioCount = h('span.settings-count', {}, (me.bio || '').length + '/300');
  bioInput.addEventListener('input', () => { bioCount.textContent = bioInput.value.length + '/300'; });

  const saveProfile = btn('保存资料', async () => {
    const display = displayInput.value.trim();
    if (!display) return toast('昵称不能空着', 'err');
    saveProfile.disabled = true;
    saveProfile.textContent = '保存中…';
    try {
      await api.patch('/api/me', { display, bio: bioInput.value });
      const fresh = await ctx.refreshUser();
      if (fresh) {
        me = fresh;
        paintAvatar();
        paintSession();
      }
      toast('资料存好了', 'ok');
    } catch (e) { handleError(e); }
    finally {
      saveProfile.disabled = false;
      saveProfile.textContent = '保存资料';
    }
  }, { variant: 'primary' });

  const profileCard = h('section.card.settings-card', {},
    h('header.settings-head', {},
      h('div', {},
        h('h3', {}, '个人资料'),
        h('div.small.muted', {}, '别人点进你的主页，看到的就是这些')
      )
    ),
    coverBox,
    h('div.settings-profile', {},
      h('div.settings-avatar-col', {}, avatarSlot),
      h('div.settings-fields', {},
        field('昵称', displayInput),
        h('label.field', {},
          h('span.settings-label-row', {}, h('span', {}, '简介'), bioCount),
          bioInput
        )
      )
    ),
    h('div.settings-actions', {}, saveProfile)
  );

  /* ================= 2. 毛孩子 ================= */
  const petsBox = h('div.settings-pets');

  const petsCard = h('section.card.settings-card', {},
    h('header.settings-head', {},
      h('div', {},
        h('h3', {}, '毛孩子'),
        h('div.small.muted', {}, '记录和动态都挂在他们名下')
      ),
      btn('添加', () => openPetForm(null), { variant: 'primary', sm: true, icon: '＋' })
    ),
    petsBox
  );

  async function loadPets() {
    petsBox.replaceChildren(loadingBlock('正在找你的毛孩子…'));
    try {
      const d = await api.get('/api/pets');
      renderPets((d && d.items) || []);
    } catch (e) {
      petsBox.replaceChildren(emptyState('😿', '宠物列表没加载出来'));
      handleError(e);
    }
  }

  function renderPets(items) {
    if (!items.length) {
      petsBox.replaceChildren(h('div.settings-pets-empty', {},
        h('p.small.muted', {}, '还没登记毛孩子。加一只之后，驱虫、体重、照片就都有地方放了。'),
        btn('添加第一只', () => openPetForm(null), { sm: true })
      ));
      return;
    }
    petsBox.replaceChildren(...items.map(petRow));
  }

  function petRow(pet) {
    const sp = speciesOf(pet.species);
    const bits = [];
    if (pet.breed) bits.push(pet.breed);
    if (pet.gender) bits.push(genderLabel(pet.gender));
    bits.push(pet.birthday ? '生日 ' + fmtDate(pet.birthday) : '生日还没填');
    return h('div.settings-pet', { onclick: () => openPetForm(pet) },
      face(pet, 52),
      h('div.settings-pet-main', {},
        h('div.settings-pet-name', {}, pet.name, h('span.settings-pet-species', {}, sp.emoji + ' ' + sp.label)),
        h('div.settings-pet-meta', {}, bits.join(' · '))
      ),
      h('div.settings-pet-acts', {},
        btn('编辑', (e) => { e.stopPropagation(); openPetForm(pet); }, { sm: true, variant: 'ghost' }),
        btn('删除', (e) => { e.stopPropagation(); deletePet(pet); }, { sm: true, variant: 'ghost' })
      )
    );
  }

  async function deletePet(pet) {
    const ok = await confirmModal('删掉「' + pet.name + '」？这一步没法撤回。', { okText: '删除', danger: true });
    if (!ok) return;
    try {
      await api.del('/api/pets/' + pet.id);
      toast('已经删掉了', 'ok');
      await loadPets();
      const fresh = await ctx.refreshUser();
      if (fresh) me = fresh;
    } catch (e) { handleError(e); }
  }

  function openPetForm(pet) {
    const isNew = !pet;
    let avatarId = pet && pet.avatar ? pet.avatar : null;
    let previewUrl = picUrl(pet && pet.avatar) || '';

    const nameInput = h('input', { type: 'text', maxlength: 20, value: pet ? pet.name : '', placeholder: '豆豆' });
    const speciesSel = h('select', {}, SPECIES.map((s) =>
      h('option', { value: s.value, selected: (pet ? pet.species : 'dog') === s.value }, s.emoji + ' ' + s.label)));
    const breedInput = h('input', { type: 'text', maxlength: 30, value: pet ? pet.breed || '' : '', placeholder: '柯基 / 英短 / 中华田园猫' });
    const genderSel = h('select', {}, GENDERS.map((g) =>
      h('option', { value: g.value, selected: (pet ? pet.gender || '' : '') === g.value }, g.label)));
    const bdayInput = h('input', { type: 'date', value: pet && pet.birthday ? String(pet.birthday).slice(0, 10) : '' });
    const petBio = h('textarea', { rows: 3, maxlength: 200, placeholder: '它的怪癖、怕的东西、最爱的那口零食' });
    petBio.value = pet ? pet.bio || '' : '';

    const photoPick = h('button.settings-pet-photo', { type: 'button' },
      face({ name: pet ? pet.name : '新成员', avatar: previewUrl }, 64),
      h('span.small.muted', {}, '换照片')
    );
    photoPick.addEventListener('click', () => pickImage('avatar', async (asset) => {
      avatarId = asset.id;
      previewUrl = asset.url || '';
      photoPick.replaceChildren(
        face({ name: nameInput.value || '新成员', avatar: previewUrl }, 64),
        h('span.small.muted', {}, '换照片')
      );
    }));

    const submit = h('button.btn.primary', {}, isNew ? '添加' : '保存');

    async function savePet() {
      const name = nameInput.value.trim();
      if (!name) return toast('先给它起个名字', 'err');
      const body = {
        name,
        species: speciesSel.value,
        breed: breedInput.value.trim(),
        gender: genderSel.value,
        birthday: bdayInput.value || '',
        bio: petBio.value,
      };
      if (avatarId) body.avatar = avatarId;
      submit.disabled = true;
      submit.textContent = '保存中…';
      try {
        if (isNew) await api.post('/api/pets', body);
        else await api.patch('/api/pets/' + pet.id, body);
        m.close();
        toast(isNew ? name + ' 已经加入啦' : '已经更新', 'ok');
        await loadPets();
        const fresh = await ctx.refreshUser();
        if (fresh) me = fresh;
      } catch (e) {
        handleError(e);
        submit.disabled = false;
        submit.textContent = isNew ? '添加' : '保存';
      }
    }

    submit.addEventListener('click', savePet);

    const m = modal({
      title: isNew ? '添加一只毛孩子' : '编辑 ' + pet.name,
      body: h('div.stack', {},
        h('div.settings-pet-photo-row', {}, photoPick,
          h('div.small.muted', {}, '照片可传可不传，之后在记录里也能补。')
        ),
        h('div.form-grid.two', {},
          field('名字', nameInput),
          field('种类', speciesSel)
        ),
        h('div.form-grid.two', {},
          field('品种', breedInput),
          field('性别', genderSel)
        ),
        field('生日', bdayInput, '只记得大概的话，填个年份就行'),
        field('小传', petBio)
      ),
      actions: [
        h('button.btn.ghost', { onclick: () => m.close() }, '取消'),
        submit,
      ],
    });
  }

  /* ================= 3. 安全 ================= */
  const oldPass = h('input', { type: 'password', autocomplete: 'current-password', placeholder: '现在用的密码' });
  const newPass = h('input', { type: 'password', autocomplete: 'new-password', placeholder: '至少 6 位' });
  const newPass2 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: '再输一遍' });

  const pwBtn = btn('更新密码', async () => {
    if (!oldPass.value) return toast('先填原密码', 'err');
    if (newPass.value.length < 6) return toast('新密码至少 6 位', 'err');
    if (newPass.value !== newPass2.value) return toast('两次输入的新密码不一样', 'err');
    pwBtn.disabled = true;
    pwBtn.textContent = '提交中…';
    try {
      // silent401：原密码错了只是这个表单的错，别把整站会话清掉
      await api.post('/api/me/password', { old: oldPass.value, next: newPass.value }, { silent401: true });
      oldPass.value = '';
      newPass.value = '';
      newPass2.value = '';
      toast('密码换好了，这台设备还用着原来的登录', 'ok');
    } catch (e) { handleError(e); }
    finally {
      pwBtn.disabled = false;
      pwBtn.textContent = '更新密码';
    }
  }, { variant: 'primary' });

  const securityCard = h('section.card.settings-card', {},
    h('header.settings-head', {},
      h('div', {},
        h('h3', {}, '改密码'),
        h('div.small.muted', {}, '改完其他设备需要重新登录')
      )
    ),
    h('div.form-grid', {},
      field('原密码', oldPass),
      h('div.form-grid.two', {},
        field('新密码', newPass),
        field('确认新密码', newPass2)
      ),
      h('div.settings-actions', {}, pwBtn)
    )
  );

  /* ================= 4. 会话 ================= */
  const sessionBox = h('div.settings-session');
  function paintSession() {
    sessionBox.replaceChildren(
      face({ name: me.display || me.handle, avatar: avatarUrl || me.avatar }, 44),
      h('div.settings-session-main', {},
        h('div.settings-session-name', {}, me.display || me.handle),
        h('div.small.muted', {},
          '@' + me.handle + (me.createdAt ? ' · 注册于 ' + fmtDate(me.createdAt) : '')
        )
      )
    );
  }
  paintSession();

  const logoutBtn = btn('退出登录', async () => {
    const ok = await confirmModal('退出后要看自己的记录得重新登录，确定吗？', { okText: '退出', danger: true });
    if (!ok) return;
    logoutBtn.disabled = true;
    try {
      await api.post('/api/auth/logout');
      await ctx.refreshUser(); // 重新拉会话：这里会把 state.user 清空
      toast('已经退出', 'ok');
      navigate('#/');
    } catch (e) {
      handleError(e);
      logoutBtn.disabled = false;
    }
  }, { variant: 'ghost' });

  const sessionCard = h('section.card.settings-card', {},
    h('header.settings-head', {},
      h('div', {},
        h('h3', {}, '这台设备'),
        h('div.small.muted', {}, '现在登录着的账号')
      )
    ),
    sessionBox,
    h('div.settings-actions', {}, logoutBtn)
  );

  root.appendChild(profileCard);
  root.appendChild(petsCard);
  root.appendChild(h('div.settings-two', {}, securityCard, sessionCard));

  loadPets();
  return root;
}
