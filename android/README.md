# 爪爪星球 · Android WebView 壳

把宠物社交站点（纯静态 SPA + hash 路由 + Node.js 后端）包成原生 App 的最小外壳。单 Activity、Kotlin、只用 AndroidX 基础库和 Material，没有任何第三方依赖。

壳本身不含业务逻辑，站点更新后 App 不用重新发版——它只是把网页装进一个带 Cookie 持久化、返回键处理、错误页和图片上传能力的容器里。

## 环境要求

- JDK 17（AGP 8.5 要求 JDK 17）
- Android SDK Platform 34 + Build-Tools 34.x
- Gradle 8.7（AGP 8.5.2 的对应版本）
- 推荐直接用 Android Studio（Koala 及以上）打开本目录，它会自动补 SDK 和 Gradle 配置

SDK 路径写在 `local.properties`（该文件不进版本库，Android Studio 会自动生成）：

```properties
sdk.dir=C\:\\Users\\<你的用户名>\\AppData\\Local\\Android\\Sdk
```

## 目录结构

```
android/
├── settings.gradle.kts                      工程与模块声明
├── build.gradle.kts                         根构建脚本（插件版本）
├── gradle.properties                        JVM 内存、AndroidX 开关
├── gradlew / gradlew.bat                    Gradle 启动脚本
├── gradle/wrapper/gradle-wrapper.properties Gradle 8.7 的下载地址
└── app/
    ├── build.gradle.kts                     applicationId / SDK / 依赖 / 签名
    ├── proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml              INTERNET 权限、明文 HTTP、单 Activity
        ├── java/com/pawplanet/app/MainActivity.kt
        └── res/
            ├── layout/activity_main.xml     WebView + 进度条 + 启动层 + 错误页
            ├── values/{strings,colors,themes}.xml
            ├── drawable/ic_launcher_{background,foreground}.xml
            └── mipmap-anydpi{,-v26}/ic_launcher{,_round}.xml
```

## 改站点地址（base_url）

站点地址只有一处：`app/src/main/res/values/strings.xml` 里的 `base_url`。

```xml
<string name="base_url" translatable="false">http://10.0.2.2:4780/</string>
```

仓库里默认填的是 Android 模拟器访问宿主机的地址 `10.0.2.2:4780`，方便本地联调。改成你自己的：

- 局域网调试：`http://192.168.1.10:4780/`
- 有域名：`https://your-domain.com/`
- 用内网穿透临时地址也行，写完整 URL 加结尾斜杠

站内 / 站外的判定是拿这个 `base_url` 现算的（同主机同端口算站内），另外额外放行 `*.trycloudflare.com` 这类隧道域名，所以换地址不会出现「点链接被踢到系统浏览器」。

主站是明文 HTTP，Manifest 里已经开了 `android:usesCleartextTraffic="true"`；换成 HTTPS 后这条留着也无害。

## 构建

用 Android Studio 打开本目录，等索引完成点 Run 即可。

命令行（有 wrapper 时）：

```bash
# Windows
gradlew.bat assembleDebug

# macOS / Linux
./gradlew assembleDebug
```

首次克隆后没有 `gradle-wrapper.jar`，需要先补一次：

```bash
gradle wrapper --gradle-version 8.7
```

产物：

```
app/build/outputs/apk/debug/app-debug.apk
```

安装：

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 打 Release 包

`app/build.gradle.kts` 里已经写好 `signingConfigs.release`：只要 `keystore/pawplanet.jks` 存在就自动签名，不存在就跳过（不会让构建失败）。

先生成自己的 key：

```bash
keytool -genkeypair -v -keystore keystore/pawplanet.jks -alias pawplanet \
  -keyalg RSA -keysize 2048 -validity 10950
```

密码别写死在代码里，用环境变量传：

```powershell
$env:PP_STORE_PASS = "你的store密码"
$env:PP_KEY_ALIAS  = "pawplanet"
$env:PP_KEY_PASS   = "你的key密码"
```

然后：

```bash
gradlew.bat assembleRelease
```

产物 `app/build/outputs/apk/release/app-release.apk`。需要上架时用 `bundleRelease` 出 `.aab`。

注意：换密钥等于「换了签名的另一个 App」，已经装过旧包的手机必须先卸载再装。

## 实现要点

**Cookie 持久化。** 登录态是 httpOnly Cookie（SameSite=Lax），所以 `CookieManager` 全程 `setAcceptCookie(true)`，代码里没有任何地方清 Cookie。`onPause` / `onResume` 时调 `CookieManager.getInstance().flush()` 把内存里的 Cookie 写盘，冷启动后仍是登录状态。

**站内 / 站外链接分流。** `shouldOverrideUrlLoading` 里判断 host：与 `base_url` 同主机同端口、以及 `*.trycloudflare.com` 留在 WebView；其它 http(s) 用 `Intent.ACTION_VIEW` 交给系统浏览器；`tel:`、`mailto:`、`sms:` 等非 http 协议也交给系统，找不到对应 App 时 Toast 提示。

**图片上传。** `WebChromeClient.onShowFileChooser` 里用 `ActivityResultContracts.StartActivityForResult` 注册的 launcher 拉起 `ACTION_GET_CONTENT`（按 `acceptTypes` 取 MIME，默认 `image/*`，支持多选），回调里把 `content://` Uri 数组回填给 `ValueCallback`。取消选择回 `null`，否则 WebView 会认为上传流程没结束，之后点上传没反应。启动新选择前会先把上一个挂起回调用 `null` 结束掉。

**返回键。** `OnBackPressedCallback`：WebView 能回退就 `goBack()`，到根路径后 2 秒内再按一次才 `finish()`，第一次按提示「再按一次退出」。

**离线/错误页。** `onReceivedError` 只在 `request.isForMainFrame` 时触发内置错误页（原生 View 覆盖层，不是 HTML），不污染 WebView 历史；错误页显示错误描述并提供「重新加载」按钮，重试顺序是 `failedUrl → requestedUrl → base_url`。图片等子资源加载失败不劫持，交给站点自己的占位图逻辑。

**安全区与键盘。** `WindowCompat.setDecorFitsSystemWindows(false)` 之后自己监听 `WindowInsets`，把 `systemBars` 的左右上内边距加到根容器上；底部取 `ime` 与导航条的较大值，配合 Manifest 的 `adjustResize`，发布框不会被输入法遮住。

**WebView 设置。** JavaScript、DOM Storage、数据库开启；`setSupportMultipleWindows(false)`；`mediaPlaybackRequiresUserGesture=false`；`mixedContentMode = MIXED_CONTENT_ALWAYS_ALLOW`（https 站里可能有 http 图片）；`cacheMode` 默认 `LOAD_DEFAULT`；UA 里去掉 `; wv` 标记。启动时显示爪印 + 文案加载层，首屏 `onPageFinished` 后淡出（220ms），顶部有 2dp 珊瑚色进度条跟随 `onProgressChanged`；另有 10 秒兜底定时器，网络一直不回来也不会卡在启动层。

## 已知限制

- 拍照上传没做，只做相册/文件选择（`ACTION_GET_CONTENT`）。
- 没有下拉刷新、没有推送、没有离线缓存策略，断网时只能看内置错误页。
- 站点是 hash 路由，返回键回退的是 hash 历史，不会重建 Activity。
- 只做编译期验证，没有真机/模拟器上的自动化 UI 测试。
