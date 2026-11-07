// 落地页：未登录访客看到的第一屏。纯静态，不发任何请求。
// 样式随模块注入（<style id="landing-view-css">），不额外改 index.html。
import { h, api } from '../lib.js';

const CSS = `
.landing { display: grid; gap: 40px; padding-bottom: 10px; }

.landing-hero {
  display: grid; grid-template-columns: minmax(0, 1fr) 312px;
  gap: 40px; align-items: center; padding: 10px 0 4px;
}
.landing-eyebrow { font-size: 11.5px; letter-spacing: .24em; text-transform: uppercase; color: var(--ink-3); }
.landing-title { font-family: var(--serif); font-size: 42px; line-height: 1.3; margin: 14px 0 0; letter-spacing: .01em; }
.landing-title em {
  font-style: normal; color: var(--coral);
  background: linear-gradient(transparent 64%, var(--coral-soft) 64%, var(--coral-soft) 92%, transparent 92%);
  padding: 0 2px;
}
.landing-sub { margin: 18px 0 0; color: var(--ink-2); font-size: 14.5px; line-height: 1.95; max-width: 33em; }
.landing-cta { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 26px; }
.landing-cta .btn { padding: 12px 26px; font-size: 15px; }
.landing-note { margin-top: 14px; font-size: 12.5px; color: var(--ink-3); }
.landing-count { display: flex; align-items: center; gap: 8px; margin-top: 30px; font-size: 12.5px; color: var(--ink-3); }
.landing-count .dots { display: flex; }
.landing-count .dots i {
  width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--paper);
  margin-left: -7px; background: var(--sage-soft); display: grid; place-items: center;
  font-size: 10px; color: #6C8563; font-style: normal;
}
.landing-count .dots i:nth-child(2) { background: var(--coral-soft); color: #C0563A; }
.landing-count .dots i:nth-child(3) { background: #F3E7CE; color: #9A7530; }

/* ---------- 手机预览卡 ---------- */
.landing-phone-wrap { position: relative; justify-self: center; }
.landing-phone {
  width: 300px; background: #FFFDFA; border-radius: 42px; padding: 10px;
  box-shadow: 0 34px 64px -34px rgba(43,33,28,.55), 0 0 0 1px rgba(237,227,215,.9);
  transform: rotate(-1.8deg);
}
.landing-screen {
  border-radius: 33px; background: var(--paper); padding: 14px 13px 15px;
  display: grid; gap: 11px; border: 1px solid rgba(237,227,215,.9);
}
.landing-notch { width: 66px; height: 5px; border-radius: 999px; background: #E7DCCD; margin: 2px auto 4px; }
.landing-mini { display: flex; align-items: center; gap: 9px; }
.landing-mini-avatar {
  width: 34px; height: 34px; border-radius: 50%; flex: none;
  background: var(--sage-soft); color: #5A7152; display: grid; place-items: center;
  font-family: var(--serif); font-weight: 700; font-size: 14px;
}
.landing-mini-name { font-size: 12.5px; font-weight: 600; line-height: 1.4; }
.landing-mini-meta { font-size: 10.5px; color: var(--ink-3); line-height: 1.4; }
.landing-post-text { font-size: 12.5px; line-height: 1.75; color: var(--ink-2); }
.landing-photo {
  aspect-ratio: 1 / 1; border-radius: 4px; border: 8px solid #fff; border-bottom-width: 26px;
  background: linear-gradient(155deg, #F6E7D6 0%, #EFE6D6 46%, #E1E9DC 100%);
  box-shadow: 0 14px 26px -18px rgba(43,33,28,.6);
  display: grid; place-items: center; color: #B6A38E;
}
.landing-photo svg { width: 92px; height: 92px; opacity: .8; }
.landing-acts { display: flex; align-items: center; gap: 15px; font-size: 11.5px; color: var(--ink-3); }
.landing-acts span { display: inline-flex; align-items: center; gap: 4px; }
.landing-acts b { color: var(--ink-2); font-weight: 600; }
.landing-badge {
  position: absolute; left: -16px; bottom: 44px; transform: rotate(-4deg);
  background: #fff; border-radius: 14px; padding: 8px 13px;
  box-shadow: var(--shadow-lift); border: 1px solid rgba(237,227,215,.9);
  font-size: 11.5px; color: var(--ink-2);
}
.landing-badge b { font-family: var(--serif); color: var(--coral); font-size: 13px; }

/* ---------- 三张功能卡 ---------- */
.landing-features { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.landing-feature {
  background: var(--card); border-radius: var(--radius); padding: 22px 20px;
  border: 1px solid rgba(237,227,215,.75); box-shadow: var(--shadow);
  transition: transform .2s, box-shadow .2s;
}
.landing-feature:hover { transform: translateY(-2px); box-shadow: var(--shadow-lift); }
.landing-ic { width: 38px; height: 38px; border-radius: 13px; display: grid; place-items: center; margin-bottom: 13px; }
.landing-ic svg { width: 20px; height: 20px; }
.landing-ic.c1 { background: var(--coral-soft); color: #C0563A; }
.landing-ic.c2 { background: var(--sage-soft); color: #5A7152; }
.landing-ic.c3 { background: #F6EAD3; color: #9A7530; }
.landing-feature h3 { font-size: 15.5px; line-height: 1.5; margin-bottom: 7px; }
.landing-feature p { margin: 0; font-size: 13px; line-height: 1.85; color: var(--ink-2); }

.landing-foot {
  display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  border-top: 1px solid var(--line); padding-top: 16px; font-size: 11.5px; color: var(--ink-3);
}

@media (max-width: 980px) {
  .landing-hero { grid-template-columns: minmax(0, 1fr) 280px; gap: 26px; }
  .landing-phone { width: 268px; }
  .landing-title { font-size: 36px; }
}
@media (max-width: 720px) {
  .landing { gap: 28px; }
  .landing-hero { grid-template-columns: 1fr; gap: 26px; }
  .landing-title { font-size: 29px; line-height: 1.36; }
  .landing-sub { font-size: 13.5px; line-height: 1.85; }
  .landing-cta .btn { flex: 1; padding: 11px 18px; }
  .landing-phone-wrap { justify-self: start; }
  .landing-phone { width: 250px; transform: none; }
  .landing-badge { left: auto; right: -6px; bottom: 30px; }
  .landing-features { grid-template-columns: 1fr; }
  .landing-feature { padding: 18px; }
}
`;

const PAW_SVG = '<svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">'
  + '<ellipse cx="19.5" cy="21" rx="6.2" ry="7.8"/>'
  + '<ellipse cx="32" cy="15.6" rx="6.4" ry="8.4"/>'
  + '<ellipse cx="44.5" cy="21" rx="6.2" ry="7.8"/>'
  + '<ellipse cx="51.6" cy="32.4" rx="5.4" ry="6.8"/>'
  + '<path d="M32 26.6c8.7 0 15.2 6.7 15.2 14.2 0 6.5-6.3 10.2-15.2 10.2S16.8 47.3 16.8 40.8c0-7.5 6.5-14.2 15.2-14.2Z"/>'
  + '</svg>';

const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const ICON_RECORD = SVG_OPEN + '<path d="M7.5 3.6h9a2.2 2.2 0 0 1 2.2 2.2v12.6a2.2 2.2 0 0 1-2.2 2.2h-9a2.2 2.2 0 0 1-2.2-2.2V5.8a2.2 2.2 0 0 1 2.2-2.2Z"/><path d="M9.4 3.4h5.2v3.1H9.4z"/><path d="M8.6 11.2h6.8M8.6 15.4h4.2"/></svg>';
const ICON_FRAME = SVG_OPEN + '<rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.4"/><path d="M3.8 15.6l4.7-4.4 3.1 2.9 3.3-3.5 5.5 4.9"/><circle cx="8.9" cy="9.2" r="1.3"/></svg>';
const ICON_LEVEL = SVG_OPEN + '<path d="M12 3.7l2.6 5.2 5.7.9-4.1 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.7 9.8l5.7-.9z"/></svg>';

function ensureStyle() {
  if (document.getElementById('landing-view-css')) return;
  document.head.appendChild(h('style#landing-view-css', {}, CSS));
}

function featureCard(cls, icon, title, text) {
  return h('div.landing-feature', {},
    h('div.landing-ic.' + cls, { html: icon }),
    h('h3', {}, title),
    h('p', {}, text)
  );
}

function phonePreview() {
  return h('div.landing-phone-wrap', {},
    h('div.landing-phone', {},
      h('div.landing-screen', {},
        h('div.landing-notch'),
        h('div.landing-mini', {},
          h('div.landing-mini-avatar', {}, '豆'),
          h('div', {},
            h('div.landing-mini-name', {}, '豆豆的铲屎官'),
            h('div.landing-mini-meta', {}, '12 分钟前 · Lv.12 记录达人')
          )
        ),
        h('div.landing-post-text', {}, '今天第三次绕小区，它还是要在同一棵树下闻三分钟。'),
        h('div.landing-photo', { html: PAW_SVG }),
        h('div.landing-acts', {},
          h('span', {}, '♥ ', h('b', {}, '128')),
          h('span', {}, '💬 ', h('b', {}, '12')),
          h('span', {}, '今天遛了 3 圈')
        )
      )
    ),
    h('div.landing-badge', {}, h('b', {}, 'Lv.12'), ' 记录达人')
  );
}

export default async function landing() {
  ensureStyle();
  const countEl = { current: null };

  const hero = h('section.landing-hero', {},
    h('div.landing-copy', {},
      h('div.landing-eyebrow', {}, '爪爪星球 · PAW PLANET'),
      h('h1.landing-title', {},
        '每个毛孩子，', h('br'), '都值得被', h('em', {}, '认真记住')
      ),
      h('p.landing-sub', {},
        '它的第一颗乳牙、第一次打疫苗、每周三固定的那条散步路线——这些小事不写下来，过两年就只剩「好像有过」的印象。爪爪星球给你一个安静的地方：驱虫和病例、遛弯的圈数、贴了相框的照片，还有那些只写给自己看的日记。'
      ),
      h('div.landing-cta', {},
        h('a.btn.primary', { href: '#/register' }, '免费注册'),
        h('a.btn.ghost', { href: '#/feed' }, '看看大家')
      ),
      h('div.landing-note', {}, '起个名字就能开始，邮箱和手机号都不用填。'),
      h('div.landing-count', {},
        h('div.dots', {}, h('i', {}, '豆'), h('i', {}, '团'), h('i', {}, '毛')),
        h('span', { ref: (el) => { countEl.current = el; } }, '毛家长们已经在这里留下爪印')
      )
    ),
    phonePreview()
  );

  const features = h('section.landing-features', {},
    featureCard('c1', ICON_RECORD, '健康记录，别再靠脑子记',
      '驱虫哪天到期、下次疫苗什么时候、体重这条线是往上还是往下，一条条记下来，到日子翻一眼就清楚。'),
    featureCard('c2', ICON_FRAME, '照片配得上相框',
      '拍立得、胶带、手写贴纸，随手一张也能像刚从冲印店拿出来的；贴完直接发进广场。'),
    featureCard('c3', ICON_LEVEL, '记着记着就升级了',
      '发帖、拍照、写日记都会攒经验，从新手铲屎官一路长到宇宙级毛家长。慢慢来，陪伴本来就是长跑。')
  );

  const foot = h('footer.landing-foot', {},
    h('span', {}, '爪爪星球 · 给毛孩子的共同记忆'),
    h('span', {}, '照片和数据都留在这台机器上，不往外跑。')
  );

  // 真实计数：拿不到就退回首屏那句不带数字的话，不影响首屏
  api.get('/api/stats').then((s) => {
    if (!countEl.current || !s) return;
    const n = Number(s.users) || 0;
    if (n > 0) countEl.current.textContent = `已经有 ${n.toLocaleString('zh-CN')} 位毛家长在这里留下爪印`;
  }).catch(() => {});

  return h('div.landing', {}, hero, features, foot);
}
