# QJML（Qiji's Minecraft Launcher）（当前信息不一定与最新版本匹配准确，请自行查阅代码）

一个干净、丝滑、傻瓜式的 Minecraft Java 版启动器。参考 PCL2 / HMCL 的交互与默认路径，主打：  
离线启动、Modrinth 中英文搜索下载、版本隔离、模组/资源包/光影包/数据包管理、模组版本转换，  
以及**为任意原版版本一键安装 Forge / Fabric / Quilt**、**Java 自动下载**。

> 当前版本：&#x33;**.16**。版本号规则与历史见 `src/core/version.js` 的 `CHANGELOG`。  
> 已支持：离线 / 微软正版登录、原版游戏下载、Forge/NeoForge/Fabric/Quilt 加载器安装、  
> 模组 / 资源包 / 光影 / 数据包管理（Modrinth + CurseForge 双源）、新手一键预设、  
> 陶瓦联机、皮肤库、世界 / 备份管理、游戏选项同步、自定义模组清单、自动检查更新。

## 功能对照

- **横向菜单**：首页 / 下载 / 高级
- **纵向菜单**
  - 点「首页」：纵向菜单隐藏
  - 点「下载」：MOD / **加载器** / 原版游戏 / 资源包 / 数据包 / 光影包
  - 点「高级」：模组版本转换 / 设置 / 模组管理 / 资源包管理 / 光影包管理 / 数据包管理
- **首页**：一个超大的「启动游戏」+ 旁边的「测试游戏」。两者功能一样，区别是——  
  测试游戏会弹出日志窗口，启动游戏不弹窗（后台直接启动）。离线昵称 + 版本选择都在上面。
- **下载 → MOD / 资源包 / 数据包 / 光影包**：全部接入 **Modrinth**（免费公开、原生支持中文+英文搜索），  
  下载时按设置自动装到对应版本（或当前实例）。
- **下载 → 加载器（新增）**：为某个原版版本安装 **Forge / Fabric / Quilt**。  
  选版本 → 选加载器 → 选具体版本 → 安装。安装时内部自动确保原版基础就绪，并需要 Java  
  （没有就到「设置 → Java」一键下载）。
- **下载 → 原版游戏**：暂不做（占位说明，规避风险）。
- **高级 → 设置**：照搬 HMCL 的合理项——版本隔离**默认开启（各实例独立）**、  
  游戏存放目录（默认与 HMCL/PCL 一致，优先复用已有 `.minecraft`）、  
  模组下载路径（默认按版本自动匹配，可改为“当前实例”）、当前实例选择、内存、主题，  
  以及 **Java 管理**（探测系统 Java / 从 Adoptium 下载 Temurin JRE / 选择本地 Java）。
- **高级 → 管理**：按实例管理 模组 / 资源包 / 光影包 / 数据包，支持启用 / 禁用 / 删除 / 打开文件夹。
- **高级 → 模组版本转换**：两个模式
  - **本地文件**：拖入 jar → 检测加载器与当前版本 → 列出可转目标版本 → 改写声明版本 → 重新打包下载。
  - **在线选择（新增）**：直接复用 Modrinth 搜索挑模组 → 选源版本 jar → 选目标版本 →  
    选装进哪个实例的 mods 目录 → 一键下载+转换+安装。  
    （这是“声明版本改写”，让加载器允许在新版本加载；不等于源码移植，请先测试。）

## 首页板块化

首页改成**板块化布局**，按功能重要性分配面积：

- **启动游戏**（最大，2×2）：版本下拉 + 大「🚀 启动游戏」+ 小「🛠 测试游戏（弹出日志窗口）」
- **账户**：点击进入账户管理子页（可添加/切换/删除离线账户），子页带「← 返回首页」
- **皮肤**：选择本地 PNG 皮肤并预览
- **下载 / 管理 / 加载器**：一键直达对应功能页
- **右上角「完整 / 简洁」分段控件**：切到「简洁」只保留启动游戏 + 账户两个板块，适合新手；  
  设置页也有同一选项，两处状态同步。

## 搜索体验

Modrinth 以英文索引为主，纯中文命中率低。启动器内置**中英别名扩展**（光影→shader、  
资源包→resource pack、中文→chinese、铁路→train…）：先按原词搜，结果不足时用别名补充并合并去重。  
实测搜「光影」从 1 个结果提升到直接命中 Complementary Shaders。空关键词时按下载量展示热门。

## 默认路径（与 HMCL / PCL 一致）

启动器绿色便携：默认游戏目录为与启动器 exe **相邻的 `.minecraft`**，且首次运行会  
**自动探测已存在的 `.minecraft`**（相邻目录 与 `%APPDATA%\.minecraft` 官方目录），优先复用，  
这样你在 HMCL / PCL / 官方启动器下过的游戏能直接在这里用，不用重下。

版本隔离（默认开）时目录结构：

```
.minecraft/
├─ versions/
│  ├─ 1.20.1-forge-47.1.3/     ← 加载器安装后生成
│  │  ├─ mods/                 ← 各实例独立的 mod
│  │  ├─ resourcepacks/
│  │  ├─ shaderpacks/
│  │  └─ datapacks/
│  └─ 1.21.1-fabric/ ...
├─ libraries/
├─ assets/
└─ .mcjava/                    ← 本启动器下载的 Java（Temurin JRE）存放处
   └─ 17/...
```

## 运行 / 打包

```bash
npm install        # 安装 electron + 依赖（首次较慢，含 electron 二进制）
npm start          # 启动（开发模式，直接出 GUI）

npm run dist       # 打包 Windows 安装版（NSIS）输出到 dist/QJML-Setup-3.0.0.exe
node tools/make-zip.js 3.0.0   # 生成绿色版 dist/QJML-Green-3.0.0.zip（免解压，推荐分发）
```

### 产物说明

- `dist/QJML-Setup-3.0.0.exe` —— NSIS 安装版（可改安装目录、创建快捷方式）
- `dist/QJML-Green-3.0.0.zip` —— 绿色版（免解压，解压即用；**自带陶瓦联机组件，推荐分发给朋友**）

>   
> 并且【不要】设置 `ELECTRON_BUILDER_CACHE` 到非默认盘（会触发符号链接权限问题，同样导致缺 `ffmpeg.dll`）。  
> 例如（Git Bash）：`export TEMP="D:/AI/tmp/temp" TMP="D:/AI/tmp/temp"` 后再 `npm run dist`。

> 浏览器预览：`src/renderer/index.html` 可直接用浏览器打开，界面与 Modrinth 搜索真实可用  
> （无 Electron 时自动进入「浏览器演示模式」，配置存 localStorage）；  
> 但启动游戏 / 安装 / 转换等本地功能需要 `npm start` 或打包出的 exe。

## 仓库目录结构（开源范围）

本项目开源的是**启动器本体源码**（MIT 许可证，见 `LICENSE`）。上传到 GitHub 的是**纯代码 + 小资源**：

```
mc-launcher/                       ← 仓库根目录
├─ main.js                         主进程（窗口、IPC、各功能入口）
├─ preload.js                      预加载脚本（把主进程能力安全暴露给渲染层）
├─ package.json                    依赖与打包配置
├─ package-lock.json
├─ LICENSE                         MIT
├─ README.md
├─ .gitignore
├─ build/
│  └─ icon.ico                     应用图标
├─ src/
│  ├─ core/                        ← 主进程业务模块（36 个 .js）
│  │  ├─ config.js                 配置读写与游戏目录探测
│  │  ├─ theme.js                  界面配色方案（UMD，主进程与渲染层共用）
│  │  ├─ msauth.js                 微软正版登录（设备码流）
│  │  ├─ loaders.js                Forge / NeoForge / Fabric / Quilt 安装
│  │  ├─ bundledLoaders.js         内置安装器查找（本次新增）
│  │  ├─ bundledMods.js            内置模组登记表 + sha256 校验
│  │  ├─ curseforge.js             CF 镜像通道（免 API Key）
│  │  ├─ modrinth.js  mirror.js    Modrinth / 原版下载通道
│  │  ├─ launch.js  install.js     启动游戏 / 安装模组
│  │  ├─ worlds.js  gameproc.js    世界备份 / 游戏进程管理
│  │  └─ …（其余模块见目录）
│  │  └─ bin/                      ← ⚠ 以下不进 Git，构建时自动下载
│  │     ├─ loaders/               内置 Forge / NeoForge 安装器（~28.5MB）
│  │     │  ├─ 1.20.1-forge-47.4.28.jar
│  │     │  ├─ 1.20.1-neoforge-47.1.106.jar
│  │     │  ├─ 1.21.1-forge-52.0.40.jar
│  │     │  └─ 1.21.1-neoforge-21.1.209.jar
│  │     ├─ mods/                  内置模组 jar（航空学魔改版 ~31.6MB）
│  │     └─ terracotta/            陶瓦联机 exe + DLL（~9.1MB）
│  └─ renderer/                    ← 界面（渲染进程）
│     ├─ index.html  styles.css  app.js  splash.*
│     ├─ demo-api.js               浏览器演示模式（无 Electron 时）
│     └─ assets/
│        ├─ home-bg.jpg
│        ├─ skins/                 22 张内置正版皮肤
│        └─ versions/              版本通道方块图（草方块/熔炉/快照/金块/石块）
├─ tools/                          ← 构建与开发脚本
│  ├─ release.js                   一键发版（改版本号+打包+归档）
│  ├─ fetch-terracotta.js          构建时下载陶瓦联机组件
│  ├─ fetch-loaders.js             构建时下载内置加载器安装器
│  ├─ make-zip.js                  生成绿色版 zip
│  ├─ make-version-icons.js        处理版本方块图标（去白底）
│  └─ shot-*.js                    开发用截图工具
└─ test/                           ← 29 个测试文件（npm test 全跑）
   ├─ core.test.js  launch.test.js  render.test.js  …
   └─ theme-msauth-cf.test.js      配色 / 微软登录 / CF / 内置加载器
```

**不进 Git 的目录**（见 `.gitignore`）：`node_modules/`、`dist/`、`shots/`、`src/core/bin/**`  
（构建时由 `tools/fetch-*.js` 自动下载，仓库保持轻量）。

### 发一个版本要做什么

**两条线互不覆盖**：

| 线  | 放哪                  | 内容                                            | 频率    |
| -- | ------------------- | --------------------------------------------- | ----- |
| 源码 | GitHub 仓库 `main` 分支 | 只有代码，`git push` 只传改动部分，仓库不会越攒越大               | 每次改代码 |
| 成品 | GitHub Releases 附件  | `QJML-Setup-<版本>.exe` + `QJML-Green-<版本>.zip` | 每次发版  |

具体三步：

1. `node tools/release.js 3.0.5 "更新说明"` —— 自动改版本号、写更新日志、  
   跑 `npm run dist`（顺带抓取内置二进制）、打绿色版 zip、复制到 `D:\AI\QJML-3.0.5-Releases\`。
2. 把**改动过的源码文件** push 到仓库（二进制不入库，构建时自动下载）。
3. 把 Setup / Green 上传到 Releases，再把更新服务器的 `version.json` 里 `latest` 改成新版本号  
   （**先传安装包再改 json**，顺序反了会把用户引到还不存在的版本）。

### 一键生成可提交的仓库目录

`node tools/prepare-github-repo.js [目标目录]`（默认 `D:\AI\QJML-GitHub`）会：

- 按上面的目录树把源码复制过去，**自动排除** `src/core/bin/**`（二进制）、`node_modules/`、`dist/`、`shots/`
- 写一份 `仓库说明.txt`（怎么提交、哪些东西故意不在、以后怎么更新）
- 执行 `git init` 并把分支设为 `main`

生成后就能直接推到 GitHub，也可以把里面的文件拖到 GitHub 网页的「uploading an existing file」。

## 自定义模组清单  与内置组件

启动器支持两种「不走 Modrinth」的模组：

**① 内置组件（推荐，零依赖服务器）**

像「机械动力航空学（魔改版）」这种模组，就把 jar **直接打进软件本体**  
（`src/core/bin/mods/`，由 `asarUnpack` 解到 `app.asar.unpacked`），用户点一下就从本地释放到实例的 `mods/` 目录。

- 代码：`src/core/bundledMods.js`（登记表 + sha256 校验 + 带进度释放）
- 清单里用 `bundled: '<id>'` 标记（见 `src/core/custommods.js` 的 `DEFAULT_MANIFEST`）
- 该 jar 本身是 jarjar 打包（内含 3 个已压缩的模组 jar + 22MB OGG 音频），**外层再压缩几乎压不动**  
  （实测 gzip -9 后 31.60MB，比原文件还大 0.01MB），所以直接原样随包分发，不再做无意义的二次压缩。
- ⚠️ 仓库里会包含这个 ~31.6MB 的二进制（`src/core/bin/mods/`），这是为了保证「克隆下来就能构建、  
  构建出来的包自带该模组」。想改成运行时下载的话，把 `fetch-terracotta.js` 那套下载逻辑照搬一份即可。

**② 服务器 JSON 清单（想换下载地址时用）**

把 JSON 清单放到你的服务器（https），在「设置 → 自定义模组清单地址」填入链接即可，无需重新发版；  
服务器清单按 `id` 覆盖内置条目并保留服务器独有的条目。清单里给了 `fileUrl` 的条目会**改走网络下载**，  
没给 `fileUrl` 的条目继续走内置组件。

```json
{
  "version": 1,
  "mods": [
    {
      "id": "aeronautics",
      "name": "机械动力航空学 Create: Aeronautics（魔改版）",
      "mc": "1.20.1",
      "loader": "neoforge",
      "bundled": "aeronautics",
      "fileUrl": "",
      "fileName": "aeronautics-bundled-1.20.1-v1.jar",
      "size": 33128898,
      "desc": "简介"
    }
  ]
}
```

上传步骤：① 把 jar 传到服务器；② 写一份上面的 `manifest.json` 也放上；③ 启动器设置里填 `https://你的服务器/manifest.json`。

## 微软登录与 Client ID

微软正版登录用 **OAuth 2.0 设备码流**，内置一个 Azure 应用（客户端）ID（`src/core/msauth.js` 的 `BUILTIN_CLIENT_ID`）。  
**这是公开的 OAuth 公共客户端 ID（非机密）** —— 与 HMCL、PolyMC 等开源启动器一样，设备码流不依赖客户端密钥，  
因此随仓库开源是安全的，普通用户也无需任何配置即可登录；界面上不显示、也不提供自定义入口。

若想换成自己的 Azure 应用：在 Azure 门户把应用注册为「移动和桌面应用程序」并允许公共客户端流，再改 `BUILTIN_CLIENT_ID` 即可。

## 界面配色方案（3.0.5 新增）

设置页 →「界面配色」，6 个方案：**白色 / 黑色**（原有两套，一像素没改）+  
**中国红 / 爱马仕橙 / 草原绿** + **自定义**。

- 后三套与自定义还能再选「底色：浅 / 深」，各配一套深浅两版。
- 自定义带一个 **RGB 调色盘**：R/G/B 三个滑块 + 原生取色器 + HEX 输入 + 6 个快捷色块，  
  拖动即时预览。渐变、浅底上的柔和底色由算法派生，保证配色协调。
- 配置项：`colorScheme` / `colorBase` / `customColor`（老配置只有 `theme` 字段会自动迁移）。

代码在 `src/core/theme.js` —— **UMD 写法**，主进程 `require` 与渲染层 `<script>` 共用同一份，  
所以颜色数学可以写单测（`test/theme-msauth-cf.test.js`），不用启动 Electron 就能验证。

## 内置加载器安装器（3.0.5 新增）

装 Forge / NeoForge 的第一步是下载 `installer.jar`（8~10MB）。国内访问  
`maven.minecraftforge.net` 经常几十秒甚至超时失败 —— PCL 等主流启动器都做了缓存/内置。

本启动器把**常用几个版本**的安装器随包分发（`src/core/bin/loaders/`，共 28.5MB）：

| MC     | 加载器      | 版本       | 大小    |
| ------ | -------- | -------- | ----- |
| 1.20.1 | Forge    | 47.4.28  | 8.4MB |
| 1.20.1 | NeoForge | 47.1.106 | 7.5MB |
| 1.21.1 | Forge    | 52.0.40  | 6.0MB |
| 1.21.1 | NeoForge | 21.1.209 | 6.6MB |

安装时**优先用内置的**（`src/core/bundledLoaders.js`），没有覆盖到的版本照旧联网下载。  
构建时由 `tools/fetch-loaders.js` 自动抓取（不进 Git）。

> ⚠️ 内置的 installer 仍会联网下载它自己的依赖库，所以这只是省掉「第一步下载 installer」，  
> 不是完全离线安装。

## CurseForge 源（免 API Key，国内可用）

CurseForge 官方 API（`api.curseforge.com`）确实强制要 API Key，而申请 Key 的控制台  
（`console.curseforge.com`）**只能用 Google 账号登录** —— 邮箱 / 微信注册的账号进不去，  
所以绝大多数国内用户根本拿不到 Key。

**但这条限制只针对官方直连。** 国内启动器作者（以及本启动器）走的是：

| 环节                                 | 做法                                                                           | 需要 Key？ |
| ---------------------------------- | ---------------------------------------------------------------------------- | ------- |
| 元数据（搜索 / 详情 / 文件列表 / download-url） | 社区维护的 **MCIM 镜像** `https://mod.mcimirror.top/curseforge/v1`                  | ❌ 不需要   |
| 文件下载                               | **官方 CDN 直链** `edge.forgecdn.net` → `mediafilez.forgecdn.net`（镜像只把域名改写回国内线路） | ❌ 不需要   |

实测（2026-11）：搜索命中 85 条、文件列表 50 个、下载 4.57MB 完整 jar，全程零 Key。  
所以**用户什么都不用填**，CurseForge 源开箱即用。若用户自己拿到了 Key（写在 `config.json` 的  
`curseforgeApiKey`），则会优先使用官方 API。

代码在 `src/core/curseforge.js`：通道 `mcim`（默认，免 key）/ `curseforge`（官方，需要 key），  
主通道失败自动切另一条。

---

## 陶瓦联机组件（Terracotta）

联机基于开源的 [陶瓦联机](https://github.com/burningtnt/Terracotta)（AGPL-3.0 + 例外条款）。本启动器**不链接**其代码，仅通过 HTTP API 做进程间通信，并在界面标注版权。  
二进制由 `tools/fetch-terracotta.js` 在构建时下载，并随包分发（位于 `src/core/bin/terracotta/`，由 `asarUnpack` 解包），  
保证**安装版与绿色版都自带** —— 换到任何电脑都能直接联机，不必再手动准备组件。

## 技术栈


- **Electron**（主进程：文件操作 / 启动 / 安装 / 下载；渲染进程：PCL 风格纯 HTML/CSS/JS，无框架）
- **手写启动器**（`src/core/launch.js`）：解析版本 json（支持 `inheritsFrom` 递归合并，现代 Forge/Fabric 必需）、  
  下载缺失的 libraries / 原生 / assets、组装 classpath 与 JVM/游戏参数，真正用 Java 拉起游戏。
  > 说明：业界常用的 `minecraft-launcher-core`(Pierce01) 不支持现代 Forge/Fabric 的 `inheritsFrom`；  
  > 而 xmcl(`@xmcl/*`) 当前发版的 npm 包存在 workspace 协议未改写、`main` 指向 TS 源码、缺失 `utils` 子路径等发包缺陷，无法稳定使用。  
  > 故采用手写启动器，零第三方启动库依赖，完全可控。
- **官方安装器**（`src/core/loaders.js`）：下载 Forge/Fabric/Quilt 的官方安装器 jar，用 Java 无头运行完成安装。
- **Adoptium API**（`src/core/java.js`）：探测系统 Java + 下载 Temurin JRE 到本地 `.mcjava/`。
- `jszip`：模组 jar 元数据读写与版本改写；`adm-zip`：Java/原生库解压。
- Modrinth 公开 API（无需 key）。

## 测试核心逻辑（无需 Electron）

```bash
npm test            # 全部 82 项：core 14 + launch 17 + ui 23 + render 28
npm run test:core   # 路径/隔离/列举/Modrinth 搜索/转换
npm run test:launch # 启动器纯逻辑：版本合并/token 替换/库路径/rules
npm run test:ui     # 搜索别名扩展/分类切换重置/主题 await/在线转换参数
npm run test:render # 渲染层结构断言（板块/下载页/转换页/设置页）
```

## 后续计划

- 崩溃分析报告导出、整合包导入体验优化
- 自动更新：更新服务器（官网 `helloqiji.cn`）待内测转正式后启用（清单格式见 `tools/version.example.json`）

