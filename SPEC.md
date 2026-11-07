# 爪爪星球 PawPlanet — 技术契约

零依赖 Node 22 服务 + 原生 ES Module 前端。数据库 `node:sqlite`。所有数据本地磁盘，图片前端预压缩后上传。

## 目录

```
pawplanet/
  server.js            启动、路由分发、静态文件
  lib/db.js            建表、迁移、查询helper、等级曲线、任务周期
  lib/http.js          JSON/multipart 读写、cookie、静态文件、HttpError
  lib/auth.js          scrypt 口令、会话、requireUser
  lib/upload.js        图片落盘、尺寸嗅探
  lib/feed.js          可见性 SQL、帖子序列化、通知、XP、任务推进
  api/auth.js  api/me.js  api/pets.js  api/records.js
  api/diary.js api/posts.js api/friends.js api/tasks.js api/uploads.js
  public/index.html    SPA 外壳
  public/styles.css    设计系统（全局唯一）
  public/lib.js        前端通用：api / h / toast / modal / 时间 / 头像 / 上传
  public/router.js     路由表
  public/app.js        启动、导航栏渲染、全局状态
  public/views/*.js    每个页面一个模块，default export async function(ctx) -> Node
  public/views/*.css   页面自己的样式，index.html 里已逐个 link
  data/app.db          数据库
  data/uploads/        图片
```

## 运行

`node server.js`，默认 `PORT=4780`，`DATA_DIR=./data`。

## API 约定

- 统一前缀 `/api`。
- 成功 `{ ok: true, data: ... }`；失败 `{ ok: false, error: { code, message } }`，HTTP 状态 4xx/5xx。
- 认证靠 cookie `pp_sid`（httpOnly、SameSite=Lax、30 天）。
- 请求体 JSON；上传走 multipart。
- 时间一律 ISO 字符串。

### 对象形状

```js
user = { id, handle, display, bio, avatar, cover, level, xp, createdAt,
         stats: { posts, friends, records, entries } }   // stats 仅在详情接口里带
pet  = { id, name, species, breed, gender, birthday, avatar, cover, bio, createdAt }
asset= { id, kind, url, thumb, w, h, mime }
post = { id, user, body, visibility, createdAt, pet, assets:[asset & {layout}],
         likes, comments, liked, reposted, repostOf, source, tag,
         commentsPreview:[{id, user, body, createdAt}] }
record={ id, type, title, note, ts, data, visibility, petId, assets, createdAt }
diary ={ id, title, content, mood, date, visibility, petId, assets, createdAt, excerpt }
task  = { code, title, desc, period, target, xp, icon, progress, done, periodKey }
level = { level, title, xp, intoLevel, needLevel, nextXp, progress, levelUpXp }
```

`visibility` ∈ `public | friends | private`，默认 `public`。
`asset.layout` 是贴纸/相框合成参数（由编辑器产出，服务端只存 JSON）：

```js
{ frame: { assetId, style }, // style: 'none' | 'rounded' | 'polaroid' | 'tape' | 'blur' | 'inset'
  layers: [ { assetId, x, y, scale, rotate, opacity } ] }  // x/y/scale 均为 0..1 的相对值
```

## 接口清单

### 认证
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | `{handle,password,display}` → `{user}`，注册即登录 |
| POST | `/api/auth/login` | `{handle,password}` → `{user}` |
| POST | `/api/auth/logout` | 清 cookie |
| GET | `/api/auth/me` | → `{user, level, tasksDone, notificationsUnread}` |

handle 规则：`^[a-z0-9_]{3,20}$`，大小写不敏感存储小写；密码 ≥ 6。

### 我
| GET/PATCH | `/api/me` | PATCH 字段：`display,bio,avatar,cover` |
| POST | `/api/me/password` | `{old,new}` |

### 用户主页
| GET | `/api/users/:handle` | → `{user, pets, relation:{isSelf,isFriend,outgoing,incoming,blocked}, counts}` |
| GET | `/api/users/:handle/posts` | 分页 `?cursor=&limit=` → `{items, nextCursor}` |
| GET | `/api/users/:handle/records` | → `{items, pets}` |
| GET | `/api/users/:handle/diary` | → `{items}` |
| GET | `/api/search?q=` | → `{users, pets}` |

`/api/users/:handle/*` 未登录时只返回 `public` 内容；非好友看不到 `friends`。

### 宠物
| GET | `/api/pets` | 我的 → `{items}` |
| POST | `/api/pets` | `{name,species,breed,gender,birthday,avatar,bio}` |
| PATCH/DELETE | `/api/pets/:id` | |

### 记录（驱虫 / 病例 / 遛狗 / 疫苗 / 体重 / 洗澡 / 训练）
| GET | `/api/records?petId=&type=&limit=` | 我的 → `{items, summary}` |
| POST | `/api/records` | `{petId,type,title,note,ts,data,visibility,assets:[assetId]}` |
| PATCH/DELETE | `/api/records/:id` | |

`type=walk` 时 `data={ rounds, minutes, distanceKm }`；`deworm` 时 `data={ product, nextDue }`；`medical` 时 `data={ clinic, diagnosis, cost, nextVisit }`；`weight` 时 `data={ kg }`。
`summary = { dewormNextDue, lastWalkAt, walkRounds30d, records30d, visits30d }`。

### 日记
| GET | `/api/diary?limit=` | → `{items}` |
| POST | `/api/diary` | `{title,content,mood,date,visibility,assets,petId}` |
| PATCH/DELETE | `/api/diary/:id` | |

### 动态与社交
| GET | `/api/feed?tab=all\|friends\|mine\|like\|pet&petId=&cursor=&limit=` | → `{items,nextCursor}` |
| POST | `/api/posts` | `{body,visibility,petId,assets:[{id,layout}],sourceType,sourceId,repostOf}` |
| GET/PATCH/DELETE | `/api/posts/:id` | |
| POST | `/api/posts/:id/like` | 切换 → `{liked,likes}` |
| GET | `/api/posts/:id/comments` | → `{items}` |
| POST | `/api/posts/:id/comments` | `{body,parentId}` |
| DELETE | `/api/comments/:id` | |
| POST | `/api/posts/:id/repost` | `{body,visibility}` → 新帖，`repostOf` 指向原帖 |
| GET | `/api/hot` | 近 7 天热门 `{items}` |

`sourceType` ∈ `post|record|diary`，用于在卡片上标注「来自遛狗记录」。

### 好友
| GET | `/api/friends` | → `{friends,incoming,outgoing}` |
| POST | `/api/friends/request` | `{handle}` |
| POST | `/api/friends/accept` | `{userId}` |
| POST | `/api/friends/reject` | `{userId}` |
| DELETE | `/api/friends/:userId` | 删好友 |

### 任务与等级
| GET | `/api/tasks` | → `{tasks, level, streak, todayXp}` |
| POST | `/api/tasks/claim` | 兼容端点：已完成任务自动发奖，此处直接返回当前状态 |

任务达标即自动发 XP，不需要手动领取；`done=true` 表示本周期已完成。

### 上传
| POST | `/api/upload` | multipart：`file`、`kind=photo\|avatar\|sticker\|frame\|cover` → `{asset}` |
| GET | `/api/assets?kind=sticker,frame` | 我上传的素材 + 内置素材 → `{items}` |
| DELETE | `/api/assets/:id` | |

内置素材（`builtin:true`）是 CSS 画出来的相框，不出现在上传列表里，由编辑器内置。

### 通知
| GET | `/api/notifications` | → `{items, unread}` |
| POST | `/api/notifications/read` | `{ids}` 或 `{all:true}` |

## 等级曲线

`xpForLevel(n) = 50*(n-1)^2`，累计制，上限 60 级。
称号 1 新手铲屎官 / 3 遛狗学徒 / 6 记录达人 / 10 星球居民 / 15 毛孩子摄影师 / 20 治愈系大佬 / 30 星球守护者 / 40 传说铲屎官 / 50 宇宙级毛家长。

## 任务种子

| code | 事件 | 周期 | 目标 | XP |
|---|---|---|---|---|
| daily_post | post_create | daily | 1 | 15 |
| daily_photo | photo_upload | daily | 3 | 20 |
| daily_walk | walk_log | daily | 1 | 15 |
| daily_diary | diary_write | daily | 1 | 15 |
| daily_like | like_give | daily | 3 | 10 |
| daily_comment | comment_give | daily | 2 | 15 |
| weekly_records | record_log | weekly | 5 | 60 |
| weekly_post | post_create | weekly | 5 | 60 |
| weekly_friend | friend_accept | weekly | 1 | 50 |
| once_pet | pet_create | once | 1 | 30 |
| once_editor | sticker_use | once | 1 | 40 |
| once_profile | profile_complete | once | 1 | 30 |

## 前端约定

- 视图模块签名：`export default async function(ctx)`，返回 `Node`（HTMLElement/DocumentFragment）。
- `ctx = { params, query, user, navigate, refreshUser }`。
- 只用 `lib.js` 的 `h()` 构造 DOM，不拼 innerHTML（用户输入必须走 `textContent`）。
- 视觉语言：米白 `#FBF6EE`、纸感卡片 `#FFFFFF`、墨色 `#2B211C`、珊瑚 `#F2643F`、鼠尾草 `#7C9A73`、圆角 22px、标题衬线 `"Noto Serif SC", Georgia, serif`、正文系统字体。
- 卡片阴影 `0 10px 30px -18px rgba(43,33,28,.45)`，hover 抬 2px。
- 移动端优先，`<=720px` 单列，底部 tab 栏；桌面侧边栏。

## 接口注意事项（实测）

- `level` 字段在两处是完整对象（`GET /api/me`、`GET /api/users/:handle`、`GET /api/tasks`），在列表类接口（`/api/leaderboard`、`/api/friends`、`/api/search`）里是数字。
- `GET /api/users/:handle` 的 `counts.posts` 是「当前访问者可见的动态数」，`user.stats.posts` 是作者自己的总数；两者在非好友访问时不相等，这是预期行为。
- `GET /api/users/:handle` 带 `authenticated` 布尔值，未登录时 `relation` 全为 false。
- `POST /api/friends/request` 接受 `handle` 或 `userId`（两者都可，内部会先按 handle 查再按 id 查）；`POST /api/friends/accept` 与 `/reject` 收 `{userId}`；撤销用 `DELETE /api/friends/:userId`。
- 所有写操作返回 `{gained:[{code,title,xp,level,leveledUp}]}`，`gained` 为空数组表示没有发经验。
- 图片字段（`user.avatar`、`user.cover`、`pet.avatar`、评论里的 `user.avatar`、搜索结果）对外统一是可直接放进 `img.src` 的 `/media/<file>` URL；原始 asset id 另放在 `avatarId` / `coverId` 里，写回接口时传 URL 或 id 都能被识别（`lib/media.js` 负责互转）。
- `/api/hot` 只返回 `{items}`，没有 `tags`（标签聚合未实现）。
- 登录限流触发时返回 `429 rate_limited`（不是 `locked`）。
- 静态资源与视图走 `no-cache` + ETag（304），改完前端刷新即生效；`/media/*` 是 `immutable` 长缓存。
