---
name: app-preview-video
description: 用代码制作 App Store / Google Play 应用商店里的 App 预览视频（竖屏、15–30 秒、标题大字 + 手机里的 App 画面 + 转场动效 + 音效），并给用户一个不用懂代码的中文网页控制台：改文案、拖入截图或录屏、增删页面、选转场和动效、一键导出 MP4。只要用户想做 App 预览视频、应用商店宣传视频、app preview video、App Store 视频、商店页动画、产品功能演示短视频，或者说"像应用商店里那种广告动画"，就用这个 skill，即使用户没有提到"控制台"。
---

# App 预览视频

给一个手机 App 做应用商店的预览视频。产出两样东西：

1. 一个视频工程（视频本身是 React 代码，可以反复改、反复导出）。画面由工程里自带的小引擎 `src/engine.tsx` 按帧号画出；控制台里的预览播放器是 `control/player.tsx`；导出交给开源渲染器 HyperFrames（Apache-2.0，逐帧截图 + FFmpeg 编码）。整套不依赖 Remotion，商用没有公司许可证的问题。
2. 一个中文网页控制台，让不懂代码的用户自己调：文案、素材、页面增删排序、转场、动效、音量、导出。

这个 skill 的用户通常不懂代码。所以目标不是"你把视频做完"，而是"你把内容和结构搭好，再把控制台交到用户手里"。和用户说话用大白话，不要让用户看代码或敲命令。

## 视频的结构

`开场（App 图标）` → `任意多个页面` → `结尾（Logo + 标语）`

页面有两种：

- **功能页**：两行大字 + 一台手机，手机里放 App 截图或录屏。可以在截图上框几块"讲解区域"，视频里手指会点它，区域放大并配一句说明。
- **卡片页**：两行大字 + 一组卡片，适合一次列出多个卖点。

所有可调内容都存在工程的 `src/settings.json` 里，控制台读写的就是它。字段说明见 [references/settings.md](references/settings.md)，改 JSON 之前先读。

## 流程

### 1. 先问清楚，再动手

缺什么问什么，一次问完：

- 是哪个 App，官网或商店链接（有链接就自己去读功能和卖点，不要让用户复述）。
- 想展示哪几个功能，面向哪个市场、用什么语言。
- 素材：App 图标、带文字的 Logo、每个功能的截图或录屏。
- 有没有参考视频。有的话先看参考视频的节奏和转场。

素材还没到也可以先搭结构，功能页留空，显示占位。

### 2. 策划页面

先给用户一份分镜表（每页：停多久、手机里是什么画面、两行大字写什么、用什么转场），用户点头再建工程。几条经验：

- 商店里视频是**静音自动播放**的，信息全靠大字，前 3 秒必须出现产品画面。
- 每页一个卖点，大字两行、每行不超过 4 个英文词，否则会超宽。
- 用具体数字代替"#1""最好"这类无法证实的最高级说法，苹果审核对后者敏感。
- 总长 15–30 秒。一个带讲解的功能页约 4–5.5 秒，普通功能页 3–4 秒。

### 3. 建工程

Mac / Linux：

```bash
<skill 目录>/scripts/create_project.sh <目标文件夹>
```

Windows：

```
powershell -ExecutionPolicy Bypass -File <skill 目录>\scripts\create_project.ps1 -Target <目标文件夹>
```

脚本会复制模板并安装依赖（首次要联网，一两分钟）。目标文件夹选用户能找到的地方；如果会话没有项目文件夹，就建在当前工作目录下。不要直接在 skill 目录里的模板上改。

**需要两样东西：Node.js 22 以上、FFmpeg（导出视频用）。** 电脑上缺哪样，脚本都不会自己动手，而是打印 `NEED_NODE` / `NEED_FFMPEG`、以退出码 3 结束，并说明要下载什么。这时：

1. 用大白话告诉用户缺什么、从哪下、多大：
   - Node.js：运行环境，从 nodejs.org 下载官方免安装版（Mac 约 45MB，Windows 约 30MB）。
   - FFmpeg：把画面编码成视频的工具，从 GitHub 上 eugeneware/ffmpeg-static 项目下载静态编译版（FFmpeg 6.0，ffmpeg 和 ffprobe 两个文件，各约 20–30MB）。
   - 都放在用户自己的文件夹里（Mac/Linux：`~/.app-preview-video/`，Windows：`%LOCALAPPDATA%\app-preview-video\`），只给这个工具用，不改动系统、不需要管理员密码。
2. 用户同意后，加上对应参数重新运行：`--install-node` / `--install-ffmpeg`（Windows 是 `-InstallNode` / `-InstallFfmpeg`）。
3. 用户不同意，或者下载被公司网络拦截，就请用户（或 IT）自己安装 Node.js 22+（https://nodejs.org）和 FFmpeg 后再来。

先问再装是有意的：从网上下载并运行程序不应该悄悄发生。脚本里写死了校验码（Node.js 取自官方 SHASUMS256.txt，FFmpeg 取自 GitHub 公布的值），下载到的文件对不上会被删除并报错，这时不要绕过校验，让用户重试或手动安装。

**之后所有命令都通过工程里的启动器运行**：Mac / Linux 用 `./run.sh <命令>`，Windows 用 `run.cmd <命令>`。它会自动带上下载的那份 Node.js；用的是系统 Node.js 时它什么都不改，所以统一这样写最省事。导出脚本会从工程里的 `.ffmpeg-dir` 找到下载的 FFmpeg。下文的命令都省略了这个前缀。

### 4. 填内容

- 把素材复制到工程的 `public/` 下，在 `src/settings.json` 里填文件名。
- 按分镜表改 `页面` 数组：每页的文案、时长、转场、配色。
- 品牌色从 Logo 取，填到 `品牌.主色` / `品牌.深色`。目测的颜色要告诉用户"这是我照 Logo 估的"。
- 填完后把同样的内容复制一份到 `src/settings.default.json`，这样控制台里的"恢复默认"会回到你搭好的版本，而不是空模板。

### 5. 检查画面

导出前先抽几帧看，不要只凭类型检查通过就说做好了：

```bash
node render/render.mjs --build-only
DO_NOT_TRACK=1 HYPERFRAMES_NO_TELEMETRY=1 npx hyperframes snapshot composition --at 2.5,6,10.2 --no-end -o out/check
```

第一条把当前设置打包成 `composition/`（不渲染），第二条在指定的秒数截图到 `out/check/`。每页至少看一帧。重点看：大字有没有超宽、讲解区域的说明有没有贴边、两页交界处有没有闪白。这两个环境变量是关掉 HyperFrames 的使用统计，自己运行它的命令时都要带上。

### 6. 启动控制台，交给用户

在工程文件夹里运行 `./run.sh npm run panel`（Windows：`run.cmd npm run panel`）。它是一个 Vite 服务，默认 `http://127.0.0.1:5173`。在 Claude 桌面版里，把它配进会话根目录的 `.claude/launch.json` 再用预览面板打开，用户就能在右侧直接操作：

```json
{"name": "control-panel", "runtimeExecutable": "<工程文件夹>/run.sh", "runtimeArgs": ["npm", "run", "panel"], "port": 5173}
```

Windows 上把 `runtimeExecutable` 换成 `<工程文件夹>\\run.cmd`。没有预览面板的环境，就把网址告诉用户，让用户在浏览器里打开。

然后用几句话告诉用户控制台怎么用：

- 顶部页签点哪页，左边视频就跳到哪页，右边是这一页能改的东西。
- "+ 加一页"可以加功能页或卡片页；每页里可以改名、前后移动、复制、删除。
- 截图或录屏直接拖进虚线框。在截图上按住拖一个框，就是一块讲解区域。
- 改动自动保存。点动效选项会自动重播这一页。
- "导出视频"约一分钟，成品放在桌面。

控制台只有在这个服务开着时才能用。用户下次回来打不开，就重新启动它。

### 7. 导出

用户可以在控制台里点"导出视频"。你自己导出用：

```bash
npm run render                      # 输出 out/app-preview.mp4
node render/render.mjs <输出文件.mp4>  # 指定位置
```

导出脚本会：读 `src/settings.json` → 打包成 `composition/` 合成页 → 用 FFmpeg 把用到的录屏片段拆成图片 → 调 HyperFrames 逐帧截图、混入音效、编码成 MP4。24 秒左右的视频大约半分钟。

导出后说清楚：规格（886×1920、30fps、时长）、哪些页还是占位、哪些你实际看过。声音你听不到，要请用户试听。

## 必须遵守的几条

这些都是踩过的坑，原因写在后面。

- **真实界面。** 苹果要求预览视频以 App 内的真实画面为主。没有截图的功能页只显示占位，不要自己画一个"看起来像 App"的界面当成品交付。模板里留了示意动画的登记口（`MOCKS`），只能在用户明确要求临时占位时用，并且每次都要说明"这不是 App 真实界面，不能用于提交"。
- **音效只用自带的。** `public/sfx/` 里的 8 个音效是 `tools/make_sfx.py` 用正弦波和噪声合成的，没有第三方素材，商用没有许可问题。要换音色就改这个脚本重新生成。要用外部音效或音乐，先和用户确认来源和许可。
- **不要动用户已经调好的设置。** 用户会在控制台里改 `src/settings.json`。你改代码或加字段时，对这个文件只做"补上缺的字段"，不要整份覆盖。测试时不要在用户的真实设置上点删除、恢复默认这类操作；要测就先备份。控制台正开着时你改了 `settings.json`，控制台会自动重新读取，但不要在它保存的同时写入。
- **尺寸和时长。** 模板是 886×1920（6.9 英寸 iPhone）、30fps。App Store 要求 15–30 秒，控制台顶部会在超出时变红。其他机型或 Google Play 的尺寸要求不同，提交前让用户对照官方规格。
- **如实说明验证情况。** 抽帧看过的说看过，没逐个点过的选项说没点过。

## 控制台里没有的功能

控制台覆盖了常用调整。用户想要的效果它没有时（新的转场、新的页面版式、别的动效），改 `src/AppPreview.tsx`。这个文件按段落组织，每段开头有中文注释。加一个可选效果的套路是三步：

1. 在文件开头对应的 `z.enum([...])` 里加一个选项名。
2. 在对应的组件里实现它（转场在 `useEnterStyle`，标题动画在 `Title`，手机进场和动态在 `Phone`，讲解效果在 `SpotPop` / `SpotRing` / `Phone` 里的镜头推近）。
3. 控制台的选项按钮是从 `OPTIONS` 自动生成的，一般不用改 `control/main.tsx`。加了新字段才需要在那里加控件，同时给 `settings.json` 和 `settings.default.json` 补默认值。

动画只能用 `src/engine.tsx` 里的零件（`useCurrentFrame`、`interpolate`、`spring`、`Easing`、`Sequence`、`Freeze`、`AbsoluteFill`、`Img`、`OffthreadVideo`、`staticFile`）。画面必须只由帧号决定：不要用 `setTimeout`、CSS 动画或 `Date.now()`，否则预览和导出会对不上。

改完跑 `npx tsc --noEmit -p .`，再抽帧看效果。

## 常见问题

- **导出报错找不到 ffmpeg**：重新运行建工程脚本检查（会提示 `NEED_FFMPEG`），或者设环境变量 `HYPERFRAMES_FFMPEG_PATH` / `HYPERFRAMES_FFPROBE_PATH` 指向已有的 FFmpeg。FFmpeg 要完整版：缺 `fps` 滤镜或 `pcm_f32le` 编码器的精简版会在编码阶段失败。
- **HyperFrames 自己下载浏览器**：导出时找不到 Chrome，HyperFrames 会自动下载一份（约 270MB，放在 `~/.cache/hyperframes`）。导出脚本会优先用系统装的 Google Chrome 来避免这件事；用户电脑上没有 Chrome 时，第一次导出前先告诉用户会有这次下载。
- **录屏在导出里不动或错位**：导出时录屏是先用 FFmpeg 拆成每秒 60 张图片再按帧号显示的，不是直接播放视频。改了录屏的 `开始`/`速度` 后要重新导出，`composition/` 会重新生成。
- **刚上传的图片不显示**：上传的文件由 `control/vite.config.mts` 里的 `/uploads` 中间件直接从磁盘读，不要去掉它（Vite 只认启动时就存在的 public 文件）。
- **讲解区域对不准**：手机框内屏的宽高比是按 iPhone 截图（约 1:2.17）定的。别的比例的截图会被裁切，讲解框就会偏，让用户换成 iPhone 竖屏截图。
- **"让小车往前开"**（把截图里的车辆图标抠出来沿路线移动）只适合直线路段，框要贴合车辆；它是给导航类 App 的截图用的，别的 App 不用管。
- **导出后找不到视频**：控制台导出完成时会显示文件的完整位置。有桌面就放桌面（包括 Windows 上被 OneDrive 接管的桌面），没有就留在工程的 `out` 文件夹。
- **Windows**：安装脚本和启动器是按 Windows 的规则写的，但这个 skill 是在 Mac 上开发和测试的，Windows 上还没有实际跑过。第一次在 Windows 上用时每一步都看输出，出问题先修脚本再继续，并告诉用户。两个系统的默认字体不同（Mac 是 SF，Windows 是 Segoe UI），同一份设置导出的视频字形会略有差别。
- **5173 端口被占用**：Vite 会自动换下一个端口，以启动日志里的地址为准。
