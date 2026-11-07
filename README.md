# 爪爪星球 · Paw Planet

一个给多人和多只毛孩子用的记录 + 社交小站。零第三方依赖，一个 Node 进程 + SQLite 就能跑。

## 跑起来

```bash
cd pawplanet
node server.js
# 打开 http://127.0.0.1:4780
```

环境变量：`PORT`（默认 4780）、`DATA_DIR`（默认 `./data`，数据库 `app.db` 和上传的图片都在这里）。

## 图片存储：本地磁盘 或 Cloudflare R2

默认图片写到 `DATA_DIR/uploads`。想走 R2，在项目根写一个 `.env`（`lib/env.js` 会自己读，不需要额外依赖）：

```ini
R2_ACCOUNT_ID=你的账号ID
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=你的桶名
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_PUBLIC_BASE=https://pub-xxxxxxxx.r2.dev
R2_PREFIX=pawplanet
```

`.env` 已经在 `.gitignore` 里，别提交。

配好之后新上传的图片会按 `pawplanet/u/<handle>/<photo|avatar|cover|sticker|frame>/<id>.<ext>` 的路径存进 R2；`/media/<key>` 会 302 到公开域名。R2 不可用时自动回落本地磁盘，站点不会因为存储挂了而无法上传。

已有的本地图片搬到 R2：

```bash
node tools/r2-migrate.js            # 先看计划（只读）
node tools/r2-migrate.js --apply    # 真搬，逐个校验公开地址后更新数据库
node tools/r2-migrate.js --apply --delete-local   # 顺带删本地副本
```

自检：

```bash
node tools/r2-check.js    # 配置/列举/上传/删除 四项逐条验，明确告诉你是「只能读」还是「连读都不通」
node tools/r2-smoke.js    # 会在库里插一行临时素材验证 urlFor/302，跑完删掉
```

注意：迁移需要 Access Key 具备 **Object Read & Write** 权限。只有读权限时 `PUT` 返回 `403 AccessDenied`（签名错则是 `SignatureDoesNotMatch`，两者可区分），`r2-check.js` 会把这种情况单独报出来。

## Android App

源码在 `android/`，是一个单 Activity 的 WebView 壳，站点更新后 App 不用重发版。

改站点地址只需改 `android/app/src/main/res/values/strings.xml` 里的 `base_url`（默认是模拟器访问宿主机的 `http://10.0.2.2:4780/`），然后 `assembleDebug` / `assembleRelease`，详见 [android/README.md](android/README.md)。

演示数据（可选，服务需要已经在跑）：

```bash
node tools/seed-demo.js
```

会创建两个账号，密码都是 `secret123`：

- `alice`（爱丽丝，狗「豆豆」）
- `bob`（鲍勃，猫「奶糖」）

演示完想清干净，用清理脚本（默认 dry-run，加 `--apply` 才动手，会先 `VACUUM INTO` 备份数据库到 `DATA_DIR/backup-before-cleanup-<时间>/`）：

```bash
DATA_DIR=./data node tools/cleanup-test-accounts.js --handles alice,bob        # 只打印将要删除的内容
DATA_DIR=./data node tools/cleanup-test-accounts.js --handles alice,bob --apply # 真删，账号/动态/评论/点赞/素材文件一并清
```

脚本会处理别人对这些账号动态的点赞评论、好友关系、通知、会话与经验记录，只删这些账号自己的上传文件；如果某个素材被别人内容引用（转发场景），只摘引用、不删文件。

## 功能

**账号与主页**：注册 / 登录 / 退出，每人独立的 `@handle` 和 `#/u/<handle>` 主页，昵称、头像、封面、简介、改密码。密码用 scrypt 加盐哈希，会话是 httpOnly Cookie，登录失败有限流。

**宠物档案**：一人可养多只，种类、品种、性别、生日、头像、简介，所有记录和动态都挂在具体某只名下。

**记录**：九种类型——遛狗（圈数 / 时长 / 地点）、驱虫（药品 / 下次日期）、就诊（医院 / 医生 / 花费）、疫苗、体重、洗澡、训练、喂食、其他。列表按时间倒序分组，顶部汇总近 30 天遛弯圈数、上次遛狗、下次驱虫、最近体重、就诊次数。

**日记**：一篇一篇写，带心情、日期、配图、以及「公开 / 仅好友 / 仅自己」三种可见性。

**动态（社交）**：发文字 + 最多 9 张图，可关联宠物、选可见范围；点赞、评论、转发、分享链接。广场有全部 / 好友 / 热门 / 我的 / 我赞过五个流，滚动到底自动加载。

**好友**：按昵称、@handle 或宠物名搜索；发请求、接受、忽略、撤销、删好友。非好友只能看到公开内容。

**贴纸与相框**：图片工坊里上传任意 PNG 当贴纸或相框素材（类型不限，尺寸随手传）；合成器里拖拽贴纸、调大小 / 旋转 / 透明度，相框有圆角、拍立得、胶带、柔化、内嵌白边五种样式。合成是「非破坏性」的——原图不动，只存一份 JSON 排版（贴纸的相对坐标 0~1、缩放、角度、透明度），前端渲染时叠加。

**任务与等级**：12 个任务（每日 6、每周 3、一次性 3），跟记录、发布、点赞、评论、加好友这些行为挂钩，达成即自动发经验，经验到点自动升级，共 60 级，九个称号。任务页有进度条、等级阶梯和经验排行榜。

**通知**：别人点赞、评论、加你都会收到通知，右下角小铃铛带未读角标。

**发现页**：按昵称、@handle、宠物名搜索人和毛孩子，可直接发好友请求；没输关键词时给热门内容。

## 技术

- 后端：纯 Node（`http`、`fs`、`crypto`、`node:sqlite`），无 npm 依赖。手写 multipart 解析、静态文件服务（ETag / 304 / Range）。
- 前端：原生 ESM + 手写 DOM 构建函数 `h()`，没有框架、没有构建步骤。路由是 hash 路由，一个视图一个模块。
- 图片：前端用 canvas 先把图压到 1600px 的 JPEG 再上传，服务端只存不转码。

## 目录

```
pawplanet/
  server.js          路由注册 + 静态服务 + 启动
  SPEC.md            接口与前端约定
  lib/
    db.js            建表、SQLite 封装、等级曲线、周期 key、可见性过滤
    http.js          JSON 响应、请求体解析（JSON / multipart）、文件服务
    auth.js          scrypt 密码、会话 Cookie、限流
    feed.js          动态序列化、可见性判断、经验发放、通知
    media.js         图片字段 id ↔ /media URL 互转
    upload.js        图片落盘与尺寸嗅探
  api/
    core.js          注册登录、我的资料、用户主页、搜索、通知
    pets.js          宠物 CRUD、记录 CRUD 与汇总
    diary.js         日记 CRUD
    posts.js         广场、动态、点赞、评论、转发
    friends.js       好友关系
    tasks.js         任务进度、等级、排行榜
    uploads.js       上传与素材库
  public/
    index.html       外壳
    styles.css       设计系统（配色、卡片、按钮、弹窗、照片框）
    lib.js           组件与工具（h、api、toast、modal、photoFrame…）
    router.js        hash 路由
    app.js           侧栏 / 底部 tab / 视图装载 / 通知
    views/           每个页面一个 js 一个 css
  test/e2e.js        端到端测试，40 条断言
  tools/             截图、控制台探针、引用检查、演示图与演示数据
  data/              SQLite 与上传的图片（不进版本库也可以）
```

## 测试

```bash
node server.js &          # 另开一个终端也行
node test/e2e.js          # 40 条断言：注册、登录、可见性、好友、任务、权限边界
```

浏览器里的几条自检要先开着 headless Chrome（端口 9333，见下），再执行 `node tools/ui-check.js`（发布链路）、`node tools/flow-check.js`（十条交互流程，10/10 通过）、`node tools/overflow-check.js --width 390`（十二个页面在手机宽度下不允许横向溢出）、`node tools/asset-delete-ui.js`（素材删除：浏览器点删除 → 确认 → 真的消失）。

`node test/assets-check.js` 是素材库的后端回归：上传一张 60×120 的非方形透明 PNG，验证记录的真实宽高、挂到帖子图层后带出宽高比、删除后引用它的 layout 被清理。

对着另一套数据跑：`DATA_DIR=./data-test PORT=4799 node server.js` 然后 `BASE=http://127.0.0.1:4799 node test/e2e.js`。

辅助脚本：

```bash
node tools/check-refs.js                       # 检查 index.html 的 css/js 与视图 import 是否有缺失
node tools/check-esm.js public/views/feed.js   # 检查 ESM 语法
node tools/shot.js "#/feed" shots/feed.png --login 你的用户名:你的密码 --full --clean   # CDP 截图（--clean 先清 Cookie）
node tools/console.js "#/tasks" --login 你的用户名:你的密码                # 打印页面控制台报错
node tools/eval.js "matchMedia('(max-width:720px)').matches" "#/feed" --width 420  # 在页面里执行任意表达式
node tools/ui-check.js                         # 浏览器里真跑一遍「登录→发帖→能搜到→删掉」
node tools/flow-check.js                       # 浏览器里跑十条流程：登录/搜索/点赞/转发/改资料/改密码拦错/退出/守卫
node tools/overflow-check.js --width 390       # 手机宽度下逐页检查横向溢出
node tools/asset-delete-ui.js                  # 浏览器里删一张贴纸，验证弹窗确认与删除真的生效
node test/assets-check.js                      # 素材库回归：宽高记录 / 图层宽高比 / 删素材清理布局
node tools/alpha-check.js                      # 验证压缩后透明通道没丢（贴纸不变黑底）
node tools/demo-images.ps1                     # （用 Invoke-Expression 跑）生成演示图
node tools/demo-avatars.ps1                    # （同上）生成两只宠物的头像
```

截图的 `--script "<js>" --after 800` 可以在截图前点一下页面（比如打开合成器弹窗），方便抓弹窗状态。

截图和探针脚本需要先有一个开了远程调试的 Chrome：

```bash
chrome --headless=new --remote-debugging-port=9333 --user-data-dir=.chrome-prof about:blank
```

## 部署

把整个目录拷到服务器，`node server.js` 常驻即可，用 systemd / pm2 托管都行。要注意两件事：`DATA_DIR` 指向的位置要有写权限且记得备份（图片和数据库都在里面，删了就没了）；反向代理记得 `X-Forwarded-For`，登录限流取的是这个头。

systemd 单元、nginx 反代、备份与升级的示例写在 [DEPLOY.md](DEPLOY.md) 里。
