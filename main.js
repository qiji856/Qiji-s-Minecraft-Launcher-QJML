'use strict';
// ============================================================================
// QJML 主进程入口 · 开发者须知（架构 + 协议栈总览）
// ----------------------------------------------------------------------------
// ▸ 架构：Electron 三进程模型
//   · main.js（本文件 / 主进程）：所有"碰磁盘 / 碰网络 / 拉起 Java"的敏感操作都在这，
//     通过 ipcMain.handle 注册能力，绝不直接把 Node / fs 暴露给界面。
//   · preload.js（预加载）：用 contextBridge 把主进程能力以 window.api 形式
//     安全暴露给渲染层（渲染层 = 纯 HTML/CSS/JS，contextIsolation 已开、nodeIntegration 关）。
//   · src/renderer/*（渲染进程）：只负责画界面、调 window.api，不做任何本地操作。
//   为什么这样分：把"能删文件 / 能联网"的能力锁在主进程，界面即便被 XSS 也拿不到 Node。
//
// ▸ 本产品用到的外部协议 / 接口（每条的"调用顺序 + 失败兜底"是关键，详见各模块顶部注释）：
//   1) 微软登录 —— OAuth 2.0 设备码授权流 + Xbox Live(RPS)→XSTS 链 + Minecraft Services
//      令牌交换。自带 Azure 应用 ID 走设备码；遇 login_with_xbox 403（应用未过 Mojang 审核）
//      时自动切 Mojang 官方客户端 ID + login.live.com 老端点授权码流兜底。     见 msauth.js
//   2) Modrinth REST API v2（api.modrinth.com/v2，无需 key）+ 国内 MCIM 镜像双通道。见 modrinth.js
//   3) CurseForge —— 走社区 MCIM 镜像（mod.mcimirror.top）免 API Key，主通道失败自动切官方。见 curseforge.js
//   4) Adoptium Temurin JRE 下载 API —— 自动探测 / 下载 Java 到 .mcjava/。       见 java.js
//   5) Forge / NeoForge / Fabric / Quilt 官方安装器 jar —— 用 Java 无头运行完成安装。见 loaders.js
//   6) 陶瓦联机（Terracotta）HTTP API —— 局域网 / 联机房间进程间通信（AGPL-3.0）。见 terracotta.js
//   7) Minecraft 官方启动协议 —— launchermeta.mojang.com 版本清单、libraries.minecraft.net
//      依赖、resources.download.minecraft.net 资源；手写解析 version.json 的 inheritsFrom
//      递归合并、组装 classpath 与 JVM / 游戏参数。                             见 launch.js
//
// ▸ 要复刻这类启动器：先把上面 7 条协议的"调用顺序 + 失败兜底"想清楚，
//   再决定哪些用第三方库、哪些手写。本项目选择【手写启动器】以保证现代 Forge/Fabric 兼容
//   （主流启动库对 inheritsFrom 递归合并支持不佳），其余下载 / 安装尽量复用官方安装器。
// ============================================================================
// Electron 主进程：文件操作、Modrinth 下载安装、离线启动、模组转换
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

// ---------- 下载/安装进行中的全局守卫 ----------
// 这些 IPC 里有任何一个在跑，就算「正在下载中」：
//  · 点窗口右上角 × → 拦下来弹窗「正在下载中，请等待」（可选强行退出）
//  · 右下角关闭按钮 → 渲染端先查 dl:isActive，下载中直接提示不动作
// （用户 2026-11-03 定：下载时不让关，避免关出半截文件还不知道哪里错了）
const GUARDED_IPC = new Set([
  'vanilla:install', 'loader:install', 'curseforge:install', 'modrinth:install',
  'custommod:install', 'optifine:install', 'convert:online', 'java:download', 'modpack:install',
]);
let activeDl = 0;
function dlStateToRenderer() {
  if (mainWindow) { try { mainWindow.webContents.send('dl:state', { active: activeDl > 0, count: activeDl }); } catch (_) {} }
}
function guardWrap(fn) {
  return async (...a) => {
    activeDl++;
    dlStateToRenderer();
    try { return await fn(...a); }
    finally { activeDl--; dlStateToRenderer(); }
  };
}
// 包装 ipcMain.handle：名单内的处理器自动套守卫（放在所有 handle 注册之前才生效）
const origIpcHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (name, fn) => origIpcHandle(name, GUARDED_IPC.has(name) ? guardWrap(fn) : fn);

const { Config, detectGameDirectory } = require('./src/core/config');
const { scanInstances, listPacks, togglePack, deletePack, ensureDir, mcVersionOfInstance, packDir } = require('./src/core/instances');
const modrinth = require('./src/core/modrinth');
const { resolveInstallInstance, installFile, installBuffer, sanitize } = require('./src/core/install');
const vanilla = require('./src/core/vanilla');
const convert = require('./src/core/convert');
const java = require('./src/core/java');
const mirror = require('./src/core/mirror');
const loaders = require('./src/core/loaders');
const launchMod = require('./src/core/launch');
const presets = require('./src/core/presets');
const presetRunner = require('./src/core/presetRunner');
const modscan = require('./src/core/modscan');
const zhNames = require('./src/core/zhNames');
const terracotta = require('./src/core/terracotta');
const invite = require('./src/core/invite');
const manifest = require('./src/core/manifest');
const msauth = require('./src/core/msauth');
const curseforge = require('./src/core/curseforge');
const gameOptions = require('./src/core/gameOptions');
const worlds = require('./src/core/worlds');
const custommods = require('./src/core/custommods');
const gameproc = require('./src/core/gameproc');

const configPath = path.join(app.getPath('userData'), 'config.json');
const appDir = path.dirname(process.execPath); // 打包后与 exe 相邻；开发时为 electron 所在目录
const config = new Config(configPath);
config.load(appDir);

let mainWindow = null;
let splashWindow = null;

// 启动动画窗口：碎片拼图动画，避免「点了没反应、傻等好几秒」。
// 主窗口先藏在后台，等渲染端把配置 / 实例都加载完（app:ready），动画淡出后再显示主窗口。
function createSplashWindow() {
  try {
    splashWindow = new BrowserWindow({
      width: 560,
      height: 340,
      frame: false,
      resizable: false,
      center: true,
      show: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#0e1014',
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    splashWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'splash.html'));
    splashWindow.once('ready-to-show', () => { try { splashWindow.show(); } catch (_) {} });
    splashWindow.on('closed', () => { splashWindow = null; });
  } catch (_) { splashWindow = null; }
}

function closeSplash() {
  if (!splashWindow) return;
  const w = splashWindow;
  splashWindow = null;
  try { w.close(); } catch (_) {}
}

function createWindow() {
  // 去掉 Electron 默认的 File/Edit/View/Window/Help 菜单栏，像一个真正的桌面软件
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#f0f2f8',
    title: "Qiji's Minecraft Launcher",
    icon: path.join(__dirname, 'build', 'icon.ico'),
    // 隐藏系统标题栏，用应用顶栏当标题栏（可拖拽），右侧叠加原生最小化/最大化/关闭
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#ffffff', symbolColor: '#1a1d29', height: 60 },
    show: false, // 等启动动画播完再显示
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // 应用内网页视图（网页不再跳外部浏览器）
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  // 关闭前检查「当前世界有没有未保存的进度」：
  // 有风险时不直接关，而是让渲染端弹窗让用户确认（自行保存 或 输入 OK/close）。
  let closeConfirmed = false;
  mainWindow.on('close', (e) => {
    if (closeConfirmed) return;
    // ★ 下载/安装进行中 → 拦下来（用户 2026-11-03 定：下载时不让关，避免关出半截文件干蒙）
    if (activeDl > 0) {
      e.preventDefault();
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '正在下载中',
        message: '正在下载 / 校验文件，请等待完成。',
        detail: '正在进行的下载还有 ' + activeDl + ' 个。强行退出可能留下不完整的游戏文件，导致之后启动报错都不知道哪里错了。',
        buttons: ['继续等待（推荐）', '强行退出'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      }).then(({ response }) => {
        if (response === 1) {
          closeConfirmed = true;
          setTimeout(() => { try { mainWindow.close(); } catch (_) {} }, 60);
        }
      }).catch(() => {});
      return;
    }
    let risk = { safe: true };
    try { risk = gameproc.closingRisk(); } catch (_) { risk = { safe: true }; }
    if (risk.safe) return;               // 没风险 → 正常关闭
    e.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:askClose', risk);
    }
  });
  ipcMain.handle('app:confirmQuit', () => {
    closeConfirmed = true;
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close(); }, 60);
    return { ok: true };
  });
  // 开发调试快捷键：F12 开关开发者工具（菜单栏已移除，保留此入口方便排查问题）
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') mainWindow.webContents.toggleDevTools();
  });
  // 兜底：15 秒内渲染端没报 ready（初始化异常等），也要把窗口放出来，别让人干等
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      try { mainWindow.show(); } catch (_) {}
      closeSplash();
    }
  }, 15000);
}

// 所有页面里点开的新窗口（target=_blank 等）都改为「在启动器内部打开」，
// 不再弹外部浏览器。微软 / Azure 这类需要真实浏览器登录的站点除外。
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    const u = String(url || '');
    if (/^https?:/i.test(u)) {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:open-web', u);
    }
    return { action: 'deny' };
  });
});

app.whenReady().then(() => {
  createSplashWindow();
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// 开发辅助（仅在设置环境变量 QJML_SHOT 时生效，正式版完全不影响）：
// 启动真实应用 → 跳到指定页面 → 截图 → 退出，用来自查界面排版。
if (process.env.QJML_SHOT) {
 app.whenReady().then(() => {
  const shotPage = process.env.QJML_SHOT;
  const shotOut = path.join(__dirname, 'shots', (process.env.QJML_SHOT_NAME || 'app') + '.png');
  mainWindow.webContents.once('did-finish-load', async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await sleep(2200);
    const run = (js) => mainWindow.webContents.executeJavaScript(js, true);
    const top = { download: 'download', advanced: 'advanced', home: 'home', more: 'more' }[shotPage] || 'home';
    if (top !== 'home') { await run(`document.querySelector('.topbtn[data-top="${top}"]').click()`); await sleep(6000); }
    const sideMap = {
      convert: ['advanced', '模组版本转换'], instances: ['advanced', '实例管理'], settings: ['advanced', '设置'],
      'mod-manage': ['advanced', '模组管理'], loader: ['download', '加载器'], vanilla: ['download', '原版游戏'],
      shader: ['download', '光影包'], resourcepack: ['download', '资源包'], room: ['multiplayer', '联机房间'],
    };
    if (shotPage === 'web') {
      // 功能验证：注入一个 webview，看它能不能真的把网页加载起来
      await run(`(()=>{
        const m = document.getElementById('main');
        m.innerHTML = '<div class="webview-wrap"><div class="wv-bar"><button class="btn ghost sm">←</button><div class="wv-url" id="wvUrl">https://www.minecraft.net/zh-hans</div></div><webview id="wv" class="wv-frame" src="https://www.minecraft.net/zh-hans"></webview></div>';
        return 'ok';
      })()`);
      await sleep(9000);
      const info2 = await run(`(()=>{const w=document.getElementById('wv'); return w ? JSON.stringify({url:w.getURL(), loading:w.isLoading(), title:w.getTitle()}) : 'no-webview';})()`);
      console.log('WEBVIEW ' + info2);
    }
    if (shotPage === 'skin') {
      await run(`(()=>{const t=[...document.querySelectorAll('.tile[data-go]')].find(x=>x.dataset.go==='skin'); if(t) t.click();})()`);
      await sleep(2500);
    }
    if (sideMap[shotPage]) {
      const [t, label] = sideMap[shotPage];
      await run(`document.querySelector('.topbtn[data-top="${t}"]').click()`);
      await sleep(700);
      await run(`(()=>{const s=[...document.querySelectorAll('.sideitem')].find(x=>x.textContent.includes(${JSON.stringify(label)})); if(s) s.click();})()`);
      await sleep(1200);
    }
    if (shotPage === 'theme') {
      // 配色自查：切到指定配色方案（QJML_SHOT_THEME），再截设置页
      const scheme = process.env.QJML_SHOT_THEME || 'cn-red';
      const base = process.env.QJML_SHOT_BASE || '';
      await run(`document.querySelector('.topbtn[data-top="advanced"]').click()`);
      await sleep(700);
      await run(`(()=>{const s=[...document.querySelectorAll('.sideitem')].find(x=>x.textContent.includes('设置')); if(s) s.click();})()`);
      await sleep(1200);
      await run(`(()=>{const b=[...document.querySelectorAll('.scheme-card')].find(x=>x.dataset.scheme===${JSON.stringify(scheme)}); if(b) b.click(); return 'ok';})()`);
      await sleep(900);
      if (base) {
        await run(`(()=>{const b=[...document.querySelectorAll('#schemeBaseSeg .seg-btn')].find(x=>x.dataset.base===${JSON.stringify(base)}); if(b) b.click(); return 'ok';})()`);
        await sleep(900);
      }
      const tinfo = await run(`(()=>{const cs=getComputedStyle(document.body); return JSON.stringify({accent:cs.getPropertyValue('--accent').trim(),soft:cs.getPropertyValue('--accent-soft').trim(),dark:document.body.classList.contains('dark')});})()`);
      const diag = await run(`(()=>{
        const cards=[...document.querySelectorAll('.scheme-card')];
        const active=document.querySelector('.scheme-card.active');
        return JSON.stringify({
          cardCount: cards.length,
          schemeIds: cards.map(c=>c.dataset.scheme),
          activeScheme: active?active.dataset.scheme:null,
          hasThemeMod: !!window.QJMLTheme,
          bodyInline: document.body.getAttribute('style'),
        });
      })()`);
      try {
        fs.writeFileSync(path.join(__dirname, 'shots', 'theme-diag.json'), tinfo + '\n' + diag + '\n', 'utf8');
      } catch (_) {}
      // 滚动到配色区，方便肉眼检查卡片与调色盘
      await run(`(()=>{const el=document.getElementById('schemePicker'); if(el) el.scrollIntoView({block:'center'}); return 'ok';})()`);
      await sleep(600);
    }
try {
      fs.mkdirSync(path.dirname(shotOut), { recursive: true });
      if (shotPage === 'install' || shotPage === 'install2' || shotPage === 'install3') {
        // 打开「安装模组」弹窗并把弹窗内容导出，便于检查安装向导（前置 / 兼容 / 冲突提示）
        await run(`document.querySelector('.topbtn[data-top="download"]').click()`);
        await sleep(6000);
        // 等搜索结果出来再点安装（网络快慢不一，最多等 30 秒）
        for (let i = 0; i < 30; i++) {
          const ok = await run(`(()=>{const b=document.querySelector('[data-install]'); if(!b) return 0; b.click(); return 1;})()`);
          if (ok) break;
          await sleep(1000);
        }
        await sleep(5000);
        if (shotPage === 'install2') { await run(`(()=>{const b=document.querySelector('#mwNext'); if(b) b.click();})()`); await sleep(1500); }
        if (shotPage === 'install3') { await run(`(()=>{const b=document.querySelector('#mwNext'); if(b) b.click();})()`); await sleep(1500);
          await run(`(()=>{const b=document.querySelector('#mwNext'); if(b) b.click();})()`); await sleep(1500); }
        const html = await run(`document.getElementById('modalBody').innerHTML`);
        fs.writeFileSync(shotOut.replace(/\.png$/, '.html'), String(html || ''));
        console.log('SAVED ' + shotOut.replace(/\.png$/, '.html'));
        const img = await mainWindow.webContents.capturePage();
        fs.writeFileSync(shotOut, img.toPNG());
        console.log('SAVED ' + shotOut);
      } else {
        const img = await mainWindow.webContents.capturePage();
        fs.writeFileSync(shotOut, img.toPNG());
        console.log('SAVED ' + shotOut);
      }
    } catch (e) { console.log('SHOT FAILED ' + e.message); }
    app.quit();
  });
});
}

// 渲染端初始化完成 → 标记就绪，但【不立即】显示主窗口。
// 必须等启动动画把碎片拼好 + 闪光 + 淡出之后（splash 置 window.__splashFinished），
// 再由 waitForSplashDone 显示主窗口。这样即使文件 1~2 秒就加载完，主程序也会
// 等约 5~6 秒的拼合动画播完才进入（用户 2026-11-01 要求，看得见碎片拼的过程）。
ipcMain.handle('app:ready', async () => {
  if (splashWindow) {
    try {
      await splashWindow.webContents.executeJavaScript('window.__qjmlFinish && window.__qjmlFinish()');
    } catch (_) {}
  }
  waitForSplashDone();
  return true;
});

// 等启动动画彻底播完（碎片拼好 + 闪光 + 淡出）后再显示主窗口。
function waitForSplashDone() {
  let ticks = 0;
  const iv = setInterval(async () => {
    ticks++;
    let done = false;
    if (splashWindow && !splashWindow.isDestroyed()) {
      try { done = await splashWindow.webContents.executeJavaScript('!!window.__splashFinished'); } catch (_) { done = false; }
    }
    // 动画结束 / 轮询超时(10s) / splash 已不在 → 显示主窗口
    if (done || ticks > 200 || !splashWindow) {
      clearInterval(iv);
      revealMainWindow();
    }
  }, 50);
}

// 关闭启动动画并亮出主窗口（幂等：splash 已关 / 主窗口已显示都不报错）
function revealMainWindow() {
  if (splashWindow) closeSplash();
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.show(); mainWindow.focus(); } catch (_) {}
  }
}



function root() { return config.get('gameDirectory'); }
function isolation() { return config.get('versionIsolation'); }

ipcMain.handle('config:get', () => config.all());ipcMain.handle('config:set', (_e, key, value) => {
  config.set(key, value);
  // 切换便携模式时，重新探测游戏目录（否则开关拨了但目录没变，等于没生效）
  if (key === 'portable') {
    try { config.set('gameDirectory', detectGameDirectory(appDir, config.get('portable'))); } catch (_) {}
  }
  return config.all();
});
// ---------- 游戏选项（启动器预设，启动前同步进 options.txt） ----------
ipcMain.handle('gameOptions:get', () => {
  const baseDir = app.getPath('userData');
  const preset = gameOptions.parseOptions(gameOptions.readPresetText(baseDir));
  return {
    enabled: config.get('gameOptionsSync') !== false, // 默认开启
    preset,
    schema: gameOptions.SCHEMA,
    path: gameOptions.presetPath(baseDir),
  };
});
ipcMain.handle('gameOptions:save', (_e, { enabled, preset }) => {
  config.set('gameOptionsSync', !!enabled);
  gameOptions.writePreset(app.getPath('userData'), preset || {});
  return { ok: true };
});
ipcMain.handle('gameOptions:reset', () => {
  gameOptions.writePreset(app.getPath('userData'), {});
  return { ok: true };
});
// ---------- 世界管理 & 备份管理 ----------
// 世界的存放位置随「版本隔离」而变：
//   开启隔离 → <游戏目录>/versions/<实例>/saves/
//   关闭隔离 → <游戏目录>/saves/
// 因此这里必须按「实例」算出真正的游戏目录，不能一律用根目录。
function gameDirForInstance(instance) {
  const gameRoot = root();
  const iso = isolation();
  const inst = String(instance || config.get('currentInstance') || '').trim();
  return iso ? path.join(gameRoot, 'versions', inst) : gameRoot;
}
// 当前实例的游戏目录：与 launch:start 完全一致（版本隔离时 = versions/<实例>）
function currentGameDir() {
  return gameDirForInstance(config.get('currentInstance'));
}
ipcMain.handle('worlds:list', (_e, payload) => {
  const instance = (payload && payload.instance) || config.get('currentInstance') || '';
  const gameDir = gameDirForInstance(instance);
  const worldsList = worlds.listWorlds(gameDir);
  return {
    gameDir,
    savesDir: path.join(gameDir, 'saves'),
    instance,
    isolation: !!isolation(),
    worlds: worldsList,
  };
});
ipcMain.handle('worlds:backup', (_e, { worldName, instance }) => {
  const inst = instance || config.get('currentInstance') || '';
  const gameDir = gameDirForInstance(inst);
  const r = worlds.backupWorld(app.getPath('userData'), gameDir, worldName, {
    instance: inst,
    isolation: !!isolation(),
  });
  return { ok: true, ...r };
});
ipcMain.handle('backups:list', (_e, { worldFilter }) => {
  const list = worlds.listBackups(app.getPath('userData'), worldFilter);
  return { backups: list };
});
ipcMain.handle('backups:restore', (_e, { worldName, backupName, instance }) => {
  // 目标目录优先用备份里记录的来源实例（避免把 A 实例的存档恢复到 B 实例）
  const gameDir = gameDirForInstance(instance || config.get('currentInstance'));
  const r = worlds.restoreBackup(app.getPath('userData'), gameDir, worldName, backupName);
  return { ok: true, ...r };
});
ipcMain.handle('zh:names', () => zhNames.ZH_NAMES);
// 一次性把完整中文名大词典传给渲染端（渲染端本地查表，同步可用）
ipcMain.handle('zh:dict', () => {
  try {
    const fs2 = require('fs');
    const path2 = require('path');
    const zlib2 = require('zlib');
    const p = path2.join(__dirname, 'src', 'core', 'zhDict.json.gz');
    if (!fs2.existsSync(p)) return null;
    const raw = zlib2.gunzipSync(fs2.readFileSync(p)).toString('utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn('中文名大词典加载失败：', e.message);
    return null;
  }
});
// 按 slug / 文件名查中文名（大词典 5 万+ 条）
ipcMain.handle('zh:lookup', (_e, { slug, file, title }) => {
  try {
    if (file) return zhNames.chineseNameByFile(file) || '';
    return zhNames.chineseName(slug, title) || '';
  } catch (_) { return ''; }
});
// 中文反查：输入中文 → 英文搜索词
ipcMain.handle('zh:aliases', (_e, q) => {
  try { return zhNames.aliasesFor(q); } catch (_) { return []; }
});

// 标题栏叠加层颜色跟随深浅色主题
ipcMain.handle('window:setOverlay', (_e, dark) => {
  try {
    if (mainWindow && mainWindow.setTitleBarOverlay) {
      mainWindow.setTitleBarOverlay(dark
        ? { color: '#1a1d2a', symbolColor: '#e6e9f0', height: 60 }
        : { color: '#ffffff', symbolColor: '#1a1d29', height: 60 });
    }
  } catch (_) { /* 旧系统不支持则忽略 */ }
  return true;
});

ipcMain.handle('instances:list', () => scanInstances(root()));
ipcMain.handle('instances:delete', (_e, { name }) => {
  const removed = require('./src/core/instances').deleteInstance(root(), name);
  return { removed };
});
ipcMain.handle('instances:rename', (_e, { from, to }) => {
  const { renameInstance } = require('./src/core/instances');
  return { ok: renameInstance(root(), from, to) };
});
ipcMain.handle('instances:dir', (_e, { name }) => path.join(root(), 'versions', name));
// 崩溃自愈：列出最近新增的模组（按安装时间倒序）
ipcMain.handle('mods:recent', (_e, { instance, limit }) => {
  const cfg = config.all();
  return require('./src/core/instances').recentMods(root(), instance, cfg.versionIsolation, limit || 5);
});
ipcMain.handle('packs:list', (_e, { instance, type }) => listPacks(root(), instance, type, isolation()));
ipcMain.handle('pack:toggle', (_e, { instance, type, file, enable }) => togglePack(root(), instance, type, isolation(), file, enable));
ipcMain.handle('pack:delete', (_e, { instance, type, file }) => deletePack(root(), instance, type, isolation(), file));

// ---------- 实例模组体检（重复 / 冲突 / 前置 / 桥接工具） ----------
// 装模组前先扫一遍实例的 mods 目录：
//   · 有没有信雅互联（Sinytra Connector）这类桥接工具 → 决定 Forge 实例能不能装 Fabric 模组
//   · 有没有 Fabric API / Forgified Fabric API → 决定 Fabric 模组能不能直接用
//   · 已经装了同一个模组吗（重复 / 旧版本）
ipcMain.handle('mods:scan', (_e, { instance }) => {
  const compat = require('./src/core/modcompat');
  const dir = packDir(root(), instance, 'mod', isolation());
  const scan = modscan.scanModsDir(dir);
  return {
    dir,
    mods: (scan.mods || []).map((m) => ({
      id: m.id || '', name: m.name || '', version: m.version || '',
      file: m.file || '', relPath: m.relPath || m.file || '',
    })),
    allJars: (scan.allJars || []).map((j) => ({ file: j.file || '', relPath: j.relPath || j.file || '' })),
    duplicates: scan.duplicates || [],
    missing: scan.missing || [],
    bridge: compat.findBridge(scan),
    fabricApi: compat.findFabricApi(scan),
  };
});

// 删除实例里的某个模组（重复 / 冲突时让用户「先卸载旧的」）
ipcMain.handle('mods:remove', (_e, { instance, file }) => {
  const dir = packDir(root(), instance, 'mod', isolation());
  const rel = String(file || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.includes('..')) throw new Error('非法的文件名');
  const full = path.resolve(dir, rel);
  const base = path.resolve(dir);
  if (!full.startsWith(base + path.sep) && full !== base) throw new Error('路径越界，拒绝删除');
  if (!fs.existsSync(full)) throw new Error('文件不存在：' + rel);
  fs.unlinkSync(full);
  return { removed: rel };
});

// 一次问清：重复模组 / 冲突模组 / 有没有信雅互联 / 有没有 Fabric API
ipcMain.handle('compat:check', (_e, { instance, targetIds, targetNames, targetFile, declared }) => {
  const compat = require('./src/core/modcompat');
  const dir = packDir(root(), instance, 'mod', isolation());
  const scan = modscan.scanModsDir(dir);
  return {
    mods: (scan.mods || []).map((m) => ({
      id: m.id || '', name: m.name || '', version: m.version || '',
      file: m.file || '', relPath: m.relPath || m.file || '',
    })),
    allJars: (scan.allJars || []).map((j) => ({ file: j.file || '', relPath: j.relPath || j.file || '' })),
    dup: compat.findDuplicate(scan, { matchIds: targetIds, targetNames: targetNames, matchFile: targetFile }),
    conflicts: compat.detectConflicts({ scan, targetIds, targetNames, declared }),
    bridge: compat.findBridge(scan),
    fabricApi: compat.findFabricApi(scan),
    duplicates: scan.duplicates || [],
  };
});


// ---------- 整合包导入 ----------
ipcMain.handle('modpack:parse', async (_e, { filePath }) => {
  const modpack = require('./src/core/modpack');
  try {
    const idx = modpack.readIndexFile(filePath);
    return { ok: true, index: idx };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('modpack:install', async (_e, { filePath, instance, mcVersion }) => {
  const modpack = require('./src/core/modpack');
  const idx = modpack.readIndexFile(filePath);
  const cfg = config.all();
  // 未指定实例时，按整合包里的 MC 版本新建一个实例
  let target = instance;
  if (!target) {
    const mc = mcVersion || idx.mcVersion;
    if (!mc) throw new Error('整合包未声明 Minecraft 版本，且未指定目标实例');
    target = mc + (idx.loader ? '-' + idx.loader : '') + '-' + (idx.name || '整合包');
    // 先装原版（若还没有）
    const insts = scanInstances(root());
    if (!insts.find((i) => i.name === target)) {
      try {
        await vanilla.downloadVanilla(root(), mc, {
          onProgress: (s) => { if (mainWindow) mainWindow.webContents.send('modpack:progress', { stage: String(s || '下载原版').trim() }); },
        });
      } catch (e) { throw new Error('整合包所需的原版 ' + mc + ' 下载失败：' + e.message); }
    }
  }
  const res = await modpack.installModpack({
    root: root(), instance: target, type: 'mod', index: idx, isolation: isolation(),
    onProgress: (p) => { if (mainWindow) mainWindow.webContents.send('modpack:progress', p); },
  });
  await scanInstances(root());
  return Object.assign({ instance: target }, res);
});

// ---------- 模组更新检查 ----------
ipcMain.handle('mods:checkUpdates', async (_e, { instance }) => {
  const modupdate = require('./src/core/modupdate');
  const mc = mcVersionOfInstance(root(), instance);
  return await modupdate.checkInstanceUpdates({
    root: root(), instance, isolation: isolation(), mcVersion: mc,
    onProgress: (p) => { if (mainWindow) mainWindow.webContents.send('mods:updateProgress', p); },
  });
});
ipcMain.handle('mods:applyUpdates', async (_e, { instance, results }) => {
  const modupdate = require('./src/core/modupdate');
  const mc = mcVersionOfInstance(root(), instance);
  return await modupdate.applyUpdates({
    root: root(), instance, isolation: isolation(), mcVersion: mc, results: results || [],
    onProgress: (p) => { if (mainWindow) mainWindow.webContents.send('mods:updateProgress', p); },
  });
});
// 导入本地模组/资源包（从外部文件夹或单文件）
ipcMain.handle('packs:import', async (_e, { instance, type, dirPath, filePath }) => {
  const fs2 = require('fs');
  const path2 = require('path');
  const { packDir: pd, ensureDir: ed } = require('./src/core/instances');
  const dest = pd(root(), instance, type || 'mod', isolation());
  ed(dest);
  const exts = type === 'mod' ? ['.jar'] : type === 'shader' ? ['.zip', '.jar'] : ['.zip'];
  const copied = [];
  const addFile = (src) => {
    const base = path2.basename(src);
    if (!exts.some((e) => base.toLowerCase().endsWith(e))) return;
    const target = path2.join(dest, base);
    let name = base; let i = 1;
    while (fs2.existsSync(target)) {
      const dot = base.lastIndexOf('.');
      name = base.slice(0, dot) + '(' + i + ')' + base.slice(dot);
      i++;
    }
    fs2.copyFileSync(src, path2.join(dest, name));
    copied.push(name);
  };
  try {
    if (filePath && fs2.existsSync(filePath) && fs2.statSync(filePath).isFile()) {
      addFile(filePath);
    } else if (dirPath && fs2.existsSync(dirPath)) {
      for (const f of fs2.readdirSync(dirPath)) {
        const p = path2.join(dirPath, f);
        try { if (fs2.statSync(p).isFile()) addFile(p); } catch (_) {}
      }
    }
  } catch (e) { throw new Error('导入失败：' + e.message); }
  return { copied, dest };
});

ipcMain.handle('modrinth:search', (_e, params) => modrinth.smartSearch(params));
ipcMain.handle('modrinth:versions', (_e, projectId) => modrinth.getProjectVersions(projectId));
ipcMain.handle('modrinth:project', (_e, projectId) => modrinth.getProject(projectId));
// 批量取项目详情（详情页展示「前置模组」名称/图标用）
ipcMain.handle('modrinth:projects', async (_e, ids) => {
  try { return await modrinth.getProjectsBatch(Array.isArray(ids) ? ids : []); } catch (_) { return []; }
});
ipcMain.handle('modrinth:resolve', async (_e, { projectId, mc, versionId }) => {
  try { return await modrinth.resolveDependencies(projectId, mc, { versionId }); } catch (_) { return []; }
});

// Fabric API 前置：按实例的 MC 版本 + 加载器挑一个「对得上的」版本
//   Fabric / Quilt 实例 → fabric-api
//   Forge / NeoForge（信雅互联跑 Fabric 模组）→ forgified-fabric-api
ipcMain.handle('modrinth:fabricApi', async (_e, { mc, loader }) => {
  const wantForge = /forge/i.test(String(loader || ''));
  const pid = wantForge ? 'forgified-fabric-api' : 'fabric-api';
  const all = await modrinth.getProjectVersions(pid);
  if (!all || !all.length) throw new Error('未找到 ' + pid + ' 的公开版本');
  const forMc = mc ? all.filter((v) => (v.game_versions || []).includes(mc)) : [];
  const pool = forMc.length ? forMc : all;
  const wantLoader = wantForge ? 'forge' : 'fabric';
  let v = pool.find((x) => (x.loaders || []).includes(wantLoader));
  if (!v) v = pool.find((x) => !(x.loaders || []).length);
  if (!v) v = pool[0];
  const file = (v.files || []).find((f) => f.primary) || (v.files || [])[0];
  if (!file) throw new Error(pid + ' 该版本没有可下载文件');
  return {
    projectId: pid, versionId: v.id, fileUrl: file.url, fileName: file.filename,
    versionNumber: v.version_number, mc: mc || '', exact: forMc.length > 0,
  };
});

// Modrinth 通道测速：选最快的（官方 / MCIM 国内镜像）
ipcMain.handle('modrinth:channel', async () => {
  const id = await modrinth.pickChannel((s) => { if (mainWindow) mainWindow.webContents.send('modrinth:log', s); });
  return { channel: id, name: require('./src/core/mirror').modrinthChannelName(id) };
});

// ============ CurseForge ============
// API Key 从配置读取并同步到模块（设置页保存后立即生效）
function syncCurseforgeKey() {
  curseforge.setApiKey(config.get('curseforgeApiKey') || '');
}
syncCurseforgeKey();
// CF 状态：有无 key、当前通道、key 是否有效
ipcMain.handle('curseforge:status', async () => {
  syncCurseforgeKey();
  const has = curseforge.hasApiKey();
  // 3.0.1 起 CurseForge 默认可用（免 key 的国内镜像 + 免 key 的 CDN 直链），
  // 所以「有没有 key」不再是能不能用的判据；只是有 key 时可以额外用官方 API。
  let keyValid = null;
  if (has) {
    try {
      await curseforge.request(curseforge.API_BASE + '/games');
      keyValid = true;
    } catch (e) {
      keyValid = false;
    }
  }
  return {
    available: curseforge.isAvailable(),
    needsKey: false,
    hasKey: has,
    keyValid,
    channel: curseforge.getChannel(),
    channelName: curseforge.channelName(curseforge.getChannel()),
  };
});
ipcMain.handle('curseforge:search', (_e, params) => curseforge.searchOrFallback(params));
ipcMain.handle('curseforge:project', (_e, id) => curseforge.getProjectOrFallback(id));
ipcMain.handle('curseforge:files', (_e, id) => curseforge.getProjectFilesOrFallback(id));
ipcMain.handle('curseforge:channel', async () => {
  syncCurseforgeKey();
  const id = await curseforge.pickChannel((s) => { if (mainWindow) mainWindow.webContents.send('modrinth:log', s); });
  return { channel: id, name: curseforge.channelName(id) };
});
// 下载并安装 CurseForge 文件（需要 API Key；下载走 CDN 带 x-api-key，国内可走 MCIM 镜像）
ipcMain.handle('curseforge:install', async (_e, { projectId, fileId, fileName, fileGameVersions, type, instance, mc, downloadUrl }) => {
  syncCurseforgeKey();
  const instances = scanInstances(root());
  let target = instance;
  if (!target) target = resolveInstallInstance(config.all(), fileGameVersions, instances);
  if (!target) throw new Error('无法确定安装到哪个实例，请先在设置选择“当前实例”或在安装时手动选择');

  const prog = (stage, info) => {
    if (!mainWindow) return;
    if (stage === 'progress') {
      mainWindow.webContents.send('modrinth:progress', {
        stage: 'progress',
        percent: info.percent, speed: info.speed, bytes: info.bytes, total: info.total,
        fileName: info.fileName || fileName,
      });
    } else {
      const text = (info && info.text) || (stage === 'start' ? '开始下载 ' + fileName : stage);
      mainWindow.webContents.send('modrinth:progress', { stage: 'log', info: text, fileName });
    }
  };

  prog('start', { fileName });
  // ★ sha1 校验（用户 2026-11-03 反复强调）：先从 CF 接口拿该文件的官方 sha1（拿不到就跳过）
  let expectedSha1 = null;
  try {
    const d = await curseforge.request(curseforge.API_BASE + '/mods/' + encodeURIComponent(projectId) + '/files/' + Number(fileId));
    const hs = d && d.data && d.data.hashes;
    if (Array.isArray(hs)) {
      // CF 算法编号：0 = SHA-1，1 = MD5
      const h = hs.find((x) => x && (x.algorithm === 0 || /sha1/i.test(String(x.algorithm || ''))));
      if (h && h.value) expectedSha1 = h.value;
    }
  } catch (_) { /* 拿不到哈希不阻塞 */ }
  const buf = await curseforge.downloadFile(fileId, fileName, {
    onLog: (s) => prog('log', { text: s }),
    onProgress: (p) => prog('progress', Object.assign({ fileName }, p)),
    url: downloadUrl,
    projectId,
  });
  if (expectedSha1 && !mirror.verifySha1(buf, expectedSha1)) {
    throw new Error('文件 sha1 校验失败（下载的 ' + fileName + ' 不完整或已损坏）。请重新下载；反复失败请在下载页切换 CurseForge 下载通道。');
  }

  const dir = packDir(root(), target, type || 'mod', isolation());
  fs.mkdirSync(dir, { recursive: true });
  const safeName = String(fileName || ('curseforge-' + fileId + '.jar')).replace(/[\\/:*?"<>|]/g, '_');
  const dest = path.join(dir, safeName);
  fs.writeFileSync(dest, buf);
  prog('done', { fileName: safeName, size: buf.length, dest });

  // 写元数据侧车，记录 CurseForge 坐标（联机同步时可精确重装）
  try {
    fs.writeFileSync(
      path.join(dir, safeName + '.qjml.json'),
      JSON.stringify({
        source: 'curseforge',
        projectId: projectId || '',
        fileId: fileId || '',
        fileName: safeName,
        fileGameVersions: fileGameVersions || [],
      }, null, 2)
    );
  } catch (_) { /* 侧车失败不影响主流程 */ }

  return { path: dest, size: buf.length };
});

// 精选推荐模组：进入下载页即展示，无需先搜索。
// 返回已合并中文名、分组、前置依赖的完整数据，渲染端直接铺开。
ipcMain.handle('modrinth:featured', async () => {  const rec = require('./src/core/recommended');
  const zh = require('./src/core/zhNames');
  const slugs = rec.FEATURED.map((f) => f.slug);
  const projects = await modrinth.getProjectsBatch(slugs);
  const bySlug = new Map(projects.map((p) => [p.slug, p]));

  const groups = rec.featuredByGroup().map((g) => ({
    group: g.group,
    items: g.items.map((f) => {
      const p = bySlug.get(f.slug) || null;
      const title = p ? p.title : f.slug;
      const d = zh.displayTitle({ slug: f.slug, title });
      return {
        slug: f.slug,
        projectId: p ? p.id : null,
        title: title,
        zh: d.zh,
        label: d.label,
        desc: f.desc,
        downloads: p ? p.downloads : 0,
        follows: p ? p.follows : 0,
        author: p ? p.author : '',
        iconUrl: p ? p.icon_url : null,
        gameVersions: p ? p.game_versions : [],
        // 显式前置（已实测核对）；完整传递依赖由 Modrinth API 在安装时实时解析
        deps: rec.explicitDeps(f.slug),
        // CurseForge 独占的模组（OptiFine 等，Modrinth 不收录）→ 走 CF 搜索安装
        cfQuery: f.cf || '',
        // CF 项目 ID（已知确切 ID 的走精确通道，不用模糊搜索）
        cfId: f.cfId || '',
        known: !!p,
      };
    }),
  }));
  return { groups, total: rec.FEATURED.length };
});

ipcMain.handle('modrinth:install', async (_e, { projectId, versionId, fileUrl, fileName, fileGameVersions, type, instance, mc, skipDeps }) => {
  const instances = scanInstances(root());
  let target = instance;
  if (!target) target = resolveInstallInstance(config.all(), fileGameVersions, instances);
  if (!target) throw new Error('无法确定安装到哪个实例，请先在设置选择“当前实例”或在安装时手动选择');

  // 进度实时回传渲染端，避免长时间下载时看起来像“卡住”
  const prog = (stage, info) => {
    if (!mainWindow) return;
    if (stage === 'progress') {
      mainWindow.webContents.send('modrinth:progress', {
        stage: 'progress',
        percent: info.percent,
        speed: info.speed,
        bytes: info.bytes,
        total: info.total,
        fileName: info.fileName || fileName,
      });
    } else {
      const text = (info && info.text) || (stage === 'start' ? '开始下载 ' + fileName : stage);
      mainWindow.webContents.send('modrinth:progress', { stage: 'log', info: text, fileName });
    }
  };

  // ★ 下载完必须校验 sha1（用户 2026-11-03 反复强调）：从 Modrinth 版本数据里找该文件的官方哈希。
  // 渲染层没传哈希时这里兜底查一次；查不到（接口抖动）就跳过，不阻塞安装。
  let expectedSha1 = null;
  try {
    const vs = await modrinth.getProjectVersions(projectId);
    const v = (vs || []).find((x) => x.id === versionId);
    const f = v && (v.files || []).find((x) => x.url === fileUrl || x.filename === fileName);
    expectedSha1 = f && f.hashes && f.hashes.sha1;
  } catch (_) {}

  const dest = await installFile({
    root: root(), instance: target, type, isolation: isolation(),
    fileUrl, fileName, expectedSha1, onProgress: prog,
  });

  // 写一份元数据侧车（.qjml.json），记录该模组的 Modrinth 精确坐标。
  // 这样「联机模组清单」就能带上 projectId/versionId/fileUrl，
  // 加入方自动安装时可直装而无需靠文件名模糊搜索，大幅提高命中率。
  try {
    // 侧车写到对应类型的目录（资源包不能写进 mods）
    const metaDir = packDir(root(), target, (type === 'mod' ? 'mod' : type), isolation());
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(
      path.join(metaDir, fileName + '.qjml.json'),
      JSON.stringify({
        projectId: projectId || '',
        versionId: versionId || '',
        fileUrl: fileUrl || '',
        fileName: fileName || '',
        fileGameVersions: fileGameVersions || [],
      }, null, 2)
    );
  } catch (_) { /* 侧车失败不影响主流程 */ }

  // PCL 风格：自动补齐「required」前置依赖（递归传递依赖），装到同一实例。
  // 关键：用「实例实际的 MC 版本」而不是模组声明的第一个版本，
  // 否则前置会解析到不兼容的版本上（这正是 PCL 提示「请补齐前置」的依据）。
  const targetMc = mc || mcVersionOfInstance(root(), target) || (fileGameVersions || [])[0];
  const depsInstalled = [];
  const depsSkipped = [];
  // 渲染端已经自己管依赖（用户可勾选 / 取消）时，这里不要再自动补一遍，
  // 否则同一个前置会被塞两份，Fabric API 这类「多一份就出事」的尤其致命。
  // 只有模组才需要自动补前置；资源包/光影/数据包没有「前置」概念
  if (targetMc && !skipDeps && (type === 'mod' || !type)) {
    let deps = [];
    try { deps = await modrinth.resolveDependencies(projectId, targetMc, { versionId }); } catch (_) { deps = []; }
    const modsDir = packDir(root(), target, 'mod', isolation());
    for (const d of deps) {
      // 已经装过的前置直接跳过，不重复下载
      try {
        if (d.fileName && fs.existsSync(path.join(modsDir, d.fileName))) { depsSkipped.push(d.name); continue; }
      } catch (_) { /* 目录读不到就照常安装 */ }
      try {
        await installFile({
          root: root(), instance: target, type: 'mod', isolation: isolation(),
          fileUrl: d.fileUrl, fileName: d.fileName, onProgress: prog,
        });
        depsInstalled.push(d.name + '（' + d.versionNumber + '）');
      } catch (e) {
        depsSkipped.push(d.name);
      }
    }
  }
  return { dest, instance: target, depsInstalled, depsSkipped, mc: targetMc };
});

ipcMain.handle('launch:start', async (e, { instance, username, test, memory }) => {
  const cfg = config.all();
  const gameRoot = root();
  const iso = isolation();

  // 3. 版本隔离时游戏目录 = versions/<实例>/ ；否则 = 根 .minecraft
  const gameDir = iso
    ? path.join(gameRoot, 'versions', instance)
    : gameRoot;

  // 0. 模组预检：某些模组声明了更高的 Java 要求，或缺少前置。
  //    提前发现可以在启动前就给出明确提示，而不是启动后崩溃退出。
  let modScan = { mods: [], missing: [], requiredJava: null, exists: false };
  try { modScan = modscan.scanMods(gameDir); } catch (_) {}
  const modJavaNeed = modScan.requiredJava || 0;

  // 1. 自动选择合适的 Java（按 MC 版本 + 模组要求取较高者）
  const mcVer = mcVersionOfInstance(gameRoot, instance);
  const managed = java.listManagedJavas(gameRoot);
  const system = java.detectSystemJava();
  let javaPick = java.pickJavaForVersion({
    gameDir: gameRoot, mc: mcVer,
    configured: cfg.javaPath, managed, system,
    requiredFeature: modJavaNeed,
  });

  // 系统 Java 版本不够时自动补装匹配的 JRE（PCL/HMCL 同款行为）
  let javaDownloaded = null;
  if (!javaPick) {
    const feature = Math.max(java.javaFeatureForMc(mcVer || '1.20'), modJavaNeed);
    if (mainWindow) mainWindow.webContents.send('launch:log', '未找到可用的 Java，正在自动下载 Java ' + feature + '…\n');
    try {
      const r = await java.downloadJava({
        gameDir: gameRoot, feature,
        onProgress: (p) => { if (mainWindow) mainWindow.webContents.send('launch:log', '[Java ' + feature + '] ' + p.stage + ' ' + p.percent + '%\n'); },
      });
      javaDownloaded = r;
      javaPick = { path: r.path, feature, source: 'managed', required: feature };
    } catch (err) {
      // 标记为「需要引导到设置里装 Java」，渲染端会弹出带按钮的引导窗
      const e = new Error(
        '未找到可用的 Java 运行环境，且自动下载失败！\n' +
        `Minecraft ${mcVer || '?'} 需要 Java ${java.javaFeatureForMc(mcVer || '1.20')}` +
        (modJavaNeed ? `，模组额外要求 Java ${modJavaNeed}` : '') + '。\n' +
        '（下载失败：' + (err && err.message) + '）'
      );
      e.javaGuide = { feature, reason: (err && err.message) || '未知原因' };
      throw e;
    }
  } else if (javaPick.insufficient && javaPick.source !== 'config') {
    // 系统 Java 版本低于要求 → 自动下载匹配版本
    const feature = javaPick.required || Math.max(java.javaFeatureForMc(mcVer || '1.20'), modJavaNeed);
    if (mainWindow) {
      mainWindow.webContents.send('launch:log',
        '⚠ 当前 Java ' + (javaPick.feature || '未知') + ' 低于所需版本 ' + feature + '，正在自动下载…\n');
    }
    try {
      const r = await java.downloadJava({
        gameDir: gameRoot, feature,
        onProgress: (p) => { if (mainWindow) mainWindow.webContents.send('launch:log', '[Java ' + feature + '] ' + p.stage + ' ' + p.percent + '%\n'); },
      });
      javaDownloaded = r;
      javaPick = { path: r.path, feature, source: 'managed', required: feature };
    } catch (err) {
      if (mainWindow) {
        mainWindow.webContents.send('launch:log',
          '⚠ 自动下载 Java ' + feature + ' 失败（' + (err && err.message) + '），仍使用系统 Java ' + (javaPick.feature || '未知') + ' 继续启动\n');
      }
    }
  }

  // 2. 选下载通道（设置里可分项指定；默认优先国内 BMCLAPI 镜像，auto 才测速）
  let downloadChannel = cfg.downloadChannel || null;
  if (!downloadChannel) {
    try {
      downloadChannel = await mirror.chooseChannel(
        cfg.downloadSourceLaunch,
        (s) => { if (mainWindow) mainWindow.webContents.send('launch:log', s); }
      );
    } catch (_) { downloadChannel = 'bmclapi'; }
  }

  // 预检结论：模组声明的 Java 要求与缺失前置，直接告诉用户
  const javaIssues = modscan.checkJavaRequirements(modScan, javaPick.feature || 0);
  const warnings = [];
  if (!javaIssues.ok) {
    warnings.push('模组要求的 Java 版本高于当前使用的 Java ' + (javaPick.feature || '未知') + '：' +
      javaIssues.conflicts.map((c) => c.mod + '（需 ' + c.range + '）').join('、'));
  }
  if (modScan.missing.length) {
    warnings.push('有 ' + modScan.missing.length + ' 个前置未安装：' +
      modScan.missing.slice(0, 6).map((x) => x.need).join('、') +
      (modScan.missing.length > 6 ? ' 等' : ''));
  }
  // 同一模组被加载多份：加载器会递归扫描 mods 的子目录，
  // 工具缓存目录（如 Sinytra Connector 的 .connector）里的 jar 也会被一起加载
  if (modScan.duplicates && modScan.duplicates.length) {
    warnings.push('有 ' + modScan.duplicates.length + ' 个模组被加载了多份（子目录里的 jar 也会被扫描）：' +
      modScan.duplicates.slice(0, 4).map((d) => d.id + '×' + d.files.length).join('、') +
      (modScan.duplicates.length > 4 ? ' 等' : '') + '。请只保留一份。');
  }
  if (modScan.hiddenDirs && modScan.hiddenDirs.length) {
    warnings.push('mods 下的隐藏目录也会被加载器扫描：' +
      modScan.hiddenDirs.map((d) => d.name + '（' + d.count + ' 个 jar）').join('、') +
      '。若里面是转换缓存，会造成模组重复加载。');
  }

  // 当前激活的账户：离线账户是字符串，正版微软账户是对象（带令牌）
  const activeName = cfg.activeAccount || '';
  const activeAcc = (cfg.accounts || []).find((a) => (typeof a === 'object' && a ? a.name === activeName : a === activeName));
  let msaAuth = null;
  if (activeAcc && typeof activeAcc === 'object' && activeAcc.type === 'msa' && activeAcc.accessToken) {
    // 令牌约 24 小时过期：超过 2 小时就在启动前自动刷新，免得用户玩到一半掉登录
    const age = Date.now() - (activeAcc.savedAt || 0);
    let token = activeAcc.accessToken;
    if (age > 2 * 60 * 60 * 1000 && activeAcc.refreshToken) {
      try {
        const refreshed = await refreshMsaToken(activeAcc);
        token = refreshed.accessToken;
        const accounts = (cfg.accounts || []).map((a) => (
          (typeof a === 'object' && a && a.uuid === activeAcc.uuid)
            ? Object.assign({}, a, {
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken,
                authChannel: refreshed.authChannel || a.authChannel || 'device',
                savedAt: Date.now(),
              })
            : a));
        config.set('accounts', accounts);
      } catch (e) {
        if (mainWindow) mainWindow.webContents.send('launch:log', '⚠ 微软账号令牌刷新失败（可能需要重新登录）：' + e.message + '\n');
      }
    }
    msaAuth = { name: activeAcc.name, uuid: activeAcc.uuid, accessToken: token };
  }

  // 启动前：若开启「游戏选项同步」，把启动器预设覆盖进该实例的 options.txt
  if (cfg.gameOptionsSync !== false) {
    try {
      const r = gameOptions.applyToGame(app.getPath('userData'), gameDir);
      if (mainWindow) {
        if (r.applied) mainWindow.webContents.send('launch:log', '✓ 已按启动器预设同步游戏选项（' + r.keys + ' 项）\n');
        else if (r.reason === 'no-preset') mainWindow.webContents.send('launch:log', '（未设置游戏选项预设，跳过同步）\n');
      }
    } catch (e) {
      if (mainWindow) mainWindow.webContents.send('launch:log', '⚠ 同步游戏选项失败（不影响启动）：' + e.message + '\n');
    }
  }

  launchMod.launch(
    {
      root: gameRoot,
      instance,
      username,
      msaAuth,
      memory: memory || cfg.memory,
      javaPath: javaPick.path,
      gameDir,
      downloadChannel,
      versionIsolation: iso,
      width: cfg.resolutionWidth,
      height: cfg.resolutionHeight,
    },
    {
      onStatus: (text) => { if (mainWindow) mainWindow.webContents.send('launch:status', text); },
      onLog: (line) => {
        // 顺带喂给游戏进程管理器：靠日志判断「当前是否正开着某个世界」
        try { gameproc.trackLog(line); } catch (_) {}
        if (mainWindow) mainWindow.webContents.send('launch:log', line);
      },
      onSpawn: (child) => {
        // 记下游戏进程，供右下角「强制结束 Minecraft」按钮使用
        gameproc.trackSpawn(child, { instance, gameDir, mc: mcVer });
        if (mainWindow) mainWindow.webContents.send('game:state', gameproc.status());
      },
      onClose: (code, diagnosis) => {
        gameproc.trackExit();
        if (mainWindow) mainWindow.webContents.send('game:state', gameproc.status());
        if (mainWindow) mainWindow.webContents.send('launch:close', code, diagnosis);
      },
      onError: (err) => {
        gameproc.trackExit();
        if (mainWindow) mainWindow.webContents.send('game:state', gameproc.status());
        if (mainWindow) mainWindow.webContents.send('launch:error', String(err && err.stack || err));
      },
    }
  );
  return {
    ok: true, isTest: !!test, java: javaPick.path,
    mc: mcVer, javaFeature: javaPick.feature,
    modCount: modScan.mods.length,
    warnings,
    javaDownloaded: javaDownloaded ? javaDownloaded.feature : null,
  };
});

// ---------- Java ----------
ipcMain.handle('java:list', () => {
  const managed = java.listManagedJavas(root());
  const system = java.detectSystemJava();
  return { managed, system, configured: config.get('javaPath') || '' };
});
ipcMain.handle('java:download', async (e, feature) => {
  const r = await java.downloadJava({
    gameDir: root(), feature,
    onProgress: (p) => { if (mainWindow) mainWindow.webContents.send('java:progress', p); },
  });
  return r;
});

// ---------- 加载器 ----------
ipcMain.handle('loader:versions', async (e, { type, mc }) => loaders.listVersions(type, mc, config.get('downloadProxy')));
ipcMain.handle('loader:install', async (e, { type, mc, version, targetInstance, customName }) => {
  const cfg = config.all();
  const managed = java.listManagedJavas(root());
  const system = java.detectSystemJava();
  const javaPick = java.pickJavaForVersion({ gameDir: root(), mc, configured: cfg.javaPath, managed, system });
  if (!javaPick) throw new Error('未找到可用 Java，请先到「设置 → Java」下载或选择 Java');

  // 如果没指定版本，自动选推荐版
  let ver = version;
  if (!ver) {
    const list = await loaders.listVersions(type, mc, cfg.downloadProxy);
    const rec = list.find(v => v.recommended) || list[0];
    if (!rec) throw new Error('未找到可用的 ' + type + ' 版本');
    ver = rec.value;
  }

  let versionId = await loaders.install({
    type, mc, version: ver, root: root(), javaPath: javaPick.path,
    onProgress: (t) => { if (mainWindow) mainWindow.webContents.send('loader:progress', t); },
    onFileProgress: (p) => { if (mainWindow) mainWindow.webContents.send('loader:fileProgress', p); },
    proxy: cfg.downloadProxy,
    channel: cfg.downloadSourceLoader,
  });

  // 如果指定了目标实例或自定义名称，就重命名
  const finalName = customName || targetInstance;
  if (finalName && finalName !== versionId) {
    if (mainWindow) mainWindow.webContents.send('loader:progress', '重命名实例为「' + finalName + '」…\n');
    const { renameInstance } = require('./src/core/instances');
    versionId = await renameInstance(root(), versionId, finalName);
  }

  return { versionId };
});

// ---------- 新手预设 ----------
ipcMain.handle('preset:list', () => presets.presetSummary());

ipcMain.handle('preset:apply', async (_e, { presetId }) => {
  const preset = presets.getPreset(presetId);
  if (!preset) throw new Error('未知预设：' + presetId);
  const cfg = config.all();
  const managed = java.listManagedJavas(root());
  const system = java.detectSystemJava();
  const javaPick = java.pickJavaForVersion({ gameDir: root(), mc: preset.mc, configured: cfg.javaPath, managed, system });
  return presetRunner.applyPreset({
    preset, root: root(), proxy: cfg.downloadProxy, isolation: cfg.versionIsolation,
    customModsUrl: cfg.customModsUrl || '',
    javaPath: javaPick && javaPick.path,
    onProgress: (s) => { if (mainWindow) mainWindow.webContents.send('preset:progress', s); },
  });
});

// ---------- 自定义模组（作者托管的整合包，不依赖 Modrinth） ----------
// 清单来源：内置默认 + 设置里的「自定义模组清单地址」服务器覆盖。
ipcMain.handle('custommod:manifest', async () => {
  return custommods.fetchManifest(config.get('customModsUrl') || '');
});
ipcMain.handle('custommod:install', async (_e, { id, instance }) => {
  if (!instance) throw new Error('请先选择要安装到的实例');
  const res = await custommods.fetchManifest(config.get('customModsUrl') || '');
  const mod = custommods.getMod(res, id);
  if (!mod) throw new Error('未找到自定义模组：' + id);
  const r = await custommods.installMod({
    root: root(), instance, isolation: isolation(), mod,
    onProgress: (stage, info) => {
      if (!mainWindow) return;
      if (stage === 'progress') {
        mainWindow.webContents.send('custommod:progress', {
          stage: 'progress',
          percent: info.percent, speed: info.speed, bytes: info.bytes, total: info.total,
          fileName: info.fileName || mod.fileName,
        });
      } else {
        const text = (info && info.text) || (stage === 'start' ? '开始释放 ' + (info.fileName || mod.fileName) : stage);
        mainWindow.webContents.send('custommod:progress', { stage: 'log', info: text, fileName: info && info.fileName || mod.fileName });
      }
    },
  });
  return {
    dest: r.dest,
    source: r.source, // 'bundled' 内置组件 | 'download' 服务器直链
    mod: { id: mod.id, name: mod.name, fileName: mod.fileName, mc: mod.mc, loader: mod.loader },
  };
});

// ---------- OptiFine（高清修复 / 光影） ----------
// OptiFine 不在 Modrinth 上；CurseForge 项目 ID 固定 2624，但作者不允许镜像再分发，
// 所以国内 CF 镜像常常查不到它 → 自动装不上时由渲染层给「手动指引 + 等效替代品」。
ipcMain.handle('optifine:info', async () => {
  const o = require('./src/core/optifine');
  return { cfId: o.OPTIFINE_CF_ID, page: o.OPTIFINE_PAGE, downloadPage: o.OPTIFINE_DOWNLOAD_PAGE };
});
ipcMain.handle('optifine:install', async (_e, { instance, mc, loader }) => {
  const o = require('./src/core/optifine');
  if (!instance) return { ok: false, reason: '没有指定实例' };
  let files = [];
  try {
    files = await curseforge.getProjectFiles(o.OPTIFINE_CF_ID);
  } catch (e) {
    return { ok: false, reason: 'CurseForge 镜像里没有 OptiFine（' + (e.message || e) + '）' };
  }
  const f = o.pickFile(files, mc, loader);
  if (!f) return { ok: false, reason: 'CurseForge 上没有适配 MC ' + (mc || '?') + ' 的 OptiFine' };
  const buf = await curseforge.downloadFile(f.id, f.fileName, {
    url: f.downloadUrl, projectId: o.OPTIFINE_CF_ID,
  });
  const dir = packDir(root(), instance, 'mod', isolation());
  ensureDir(dir);
  const dest = path.join(dir, sanitize(f.fileName));
  fs.writeFileSync(dest, buf);
  return { ok: true, fileName: f.fileName, dest, size: buf.length };
});

// ---------- 原版下载（双通道 + 校验，一次到位可离线游玩） ----------
ipcMain.handle('vanilla:install', async (_e, { mc, customName }) => {
  const r = await vanilla.downloadVanilla(root(), mc, {
    customName,
    onProgress: (s) => { if (mainWindow) mainWindow.webContents.send('vanilla:progress', s); },
    // 真实字节进度（percent/speed）→ 渲染端进度条
    onFileProgress: (p) => {
      if (!mainWindow) return;
      mainWindow.webContents.send('vanilla:progress', {
        stage: 'progress',
        percent: p.percent, speed: p.speed, bytes: p.bytes, total: p.total, label: p.label,
      });
    },
  });
  return r;
});
ipcMain.handle('vanilla:versions', async () => {
  return vanilla.listVersions();
});

// 本地导入：从外部 .minecraft 目录把已下载的原版（有 jar+json 的版本文件夹）复制进本启动器
ipcMain.handle('vanilla:importLocal', async (_e, { srcDir }) => {
  if (!srcDir) return { ok: false, error: '未选择目录' };
  const srcVersions = path.join(srcDir, 'versions');
  if (!fs.existsSync(srcVersions)) return { ok: false, error: '该目录下没有 versions 文件夹，请选择 .minecraft 所在目录' };
  let entries = [];
  try { entries = fs.readdirSync(srcVersions, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch (e) { return { ok: false, error: '读取目录失败：' + e.message }; }
  const imported = [];
  for (const d of entries) {
    const name = d.name;
    const srcV = path.join(srcVersions, name);
    const jar = path.join(srcV, name + '.jar');
    const json = path.join(srcV, name + '.json');
    if (!fs.existsSync(jar) || !fs.existsSync(json)) continue; // 只导入完整原版
    const destV = path.join(root(), 'versions', name);
    try {
      fs.mkdirSync(destV, { recursive: true });
      fs.cpSync(srcV, destV, { recursive: true });
      imported.push(name);
    } catch (e) { /* 跳过导入失败的 */ }
  }
  return { ok: true, imported };
});

ipcMain.handle('convert:detect', async (_e, buffer) => {
  const buf = Buffer.from(buffer);
  return convert.detectMod(buf);
});
ipcMain.handle('convert:run', async (_e, { buffer, targetVersion }) => {
  const buf = Buffer.from(buffer);
  const out = await convert.convert(buf, targetVersion, (s) => { if (mainWindow) mainWindow.webContents.send('convert:step', s); });
  return out; // ArrayBuffer 回传渲染进程供下载
});

// 在线转换：直接用 Modrinth 上的模组，无需本地先有 jar
// 流程：取项目版本 → 下载源 jar → 改写声明版本 → 写入目标实例的 mods 目录
// 关键：转换主模组后，把实例里「声明的 MC 版本与目标不符」的 required 前置也一起转换，
//      否则移植到低版本实例时前置会版本不符 / 未安装，启动必崩。
ipcMain.handle('convert:online', async (_e, { projectId, fileUrl, fileName, sourceVersion, targetVersion, instance }) => {
  const step = (s) => { if (mainWindow) mainWindow.webContents.send('convert:step', s); };
  step(`下载 ${fileName} …`);
  const src = await modrinth.downloadFile(fileUrl);
  step('检测模组元数据…');
  const info = await convert.detectMod(src);
  if (!info.canConvert) throw new Error('该文件未识别为 Forge / Fabric 模组，无法转换');
  step(`识别：${info.modName}（${info.loader}，声明版本 ${info.currentVersion || '未知'}）`);
  step(`改写声明版本 → ${targetVersion} …`);
  if (!instance) throw new Error('请选择要把转换结果安装到哪个实例');
  const gameDir = isolation()
    ? path.join(root(), 'versions', instance)
    : root();
  const r = await convert.convertWithDeps(src, targetVersion, step, {
    gameDir, fileName, relaxFabricApi: true,
  });
  const base = String(fileName).replace(/\.jar$/i, '');
  const dest = installBuffer({
    root: root(), instance, type: 'mod', isolation: isolation(),
    buffer: r.buffer, fileName: `${base}-mc${targetVersion}.jar`,
  });
  step(`[完成] 已写入：${dest}`);
  // 前置处理结果回报给界面
  const converted = (r.deps || []).filter((d) => d.status === 'converted');
  const missing = (r.deps || []).filter((d) => d.status === 'missing');
  if (converted.length) {
    step(`[附带] 已同步转换 ${converted.length} 个前置：${converted.map((d) => d.id).join('、')}`);
  }
  if (missing.length) {
    step(`[提醒] 仍缺少前置：${missing.map((d) => d.id).join('、')}（可在模组下载页安装）`);
  }
  return { dest, instance, info, deps: r.deps || [] };
});

// ---------- 多人联机（陶瓦联机 Terracotta / EasyTier） ----------
// 合规说明：陶瓦联机为 AGPL-3.0 + 例外条款。本启动器**不链接**它，
// 仅通过其 HTTP API 做进程间通信，并在界面上标注版权信息（见渲染端「多人联机」页）。
const TERRACOTTA_DIR = path.join(app.getPath('userData'), 'terracotta');
const TERRACOTTA_PORT_FILE = path.join(TERRACOTTA_DIR, 'hmcl.json');

function terracottaBinary() {
  const exe = process.platform === 'win32' ? 'terracotta.exe' : 'terracotta';
  // 1) 已安装到可写目录（userData）的优先
  const userPath = path.join(TERRACOTTA_DIR, exe);
  if (fs.existsSync(userPath)) return userPath;
  // 2) 启动器自带的组件（随包分发，保证换到任何电脑都能用）：
  //    · 开发/绿色版/安装版都通过 src/core/bin/terracotta 随 app 一起打包
  //    · 旧版安装包可能放在 resourcesPath/terracotta（extraResources）
  //    首次运行时复制到可写目录再用，避免在 Program Files 等只读区直接运行。
  const candidates = [
    path.join(__dirname, 'src', 'core', 'bin', 'terracotta'),
    path.join(process.resourcesPath || '', 'terracotta'),
    path.join(__dirname, '..', 'resources', 'terracotta'), // 开发态兼容
  ];
  for (const bundledDir of candidates) {
    const bundled = path.join(bundledDir, exe);
    if (fs.existsSync(bundled)) {
      try {
        fs.mkdirSync(TERRACOTTA_DIR, { recursive: true });
        for (const f of fs.readdirSync(bundledDir)) {
          const s = path.join(bundledDir, f);
          if (fs.statSync(s).isFile()) {
            // 用 readFile+writeFile（而非 copyFileSync）以兼容从 app.asar 内读取
            const buf = fs.readFileSync(s);
            fs.writeFileSync(path.join(TERRACOTTA_DIR, f), buf);
          }
        }
        return userPath;
      } catch (_) { return bundled; }
    }
  }
  return '';
}

ipcMain.handle('terracotta:status', async () => {
  const running = await terracotta.detectRunning({ hmclFile: TERRACOTTA_PORT_FILE });
  return {
    running: running ? { port: running.port, meta: running.meta } : null,
    installed: !!terracottaBinary(),
    binary: terracottaBinary(),
    dir: TERRACOTTA_DIR,
  };
});

ipcMain.handle('terracotta:release', async () => terracotta.resolveRelease());

ipcMain.handle('terracotta:download', async (_e, { url, fileName }) => {
  const dest = path.join(TERRACOTTA_DIR, fileName || 'terracotta.exe');
  const r = await terracotta.downloadAsset(url, dest, {
    onProgress: (p) => { if (mainWindow) mainWindow.webContents.send('terracotta:progress', p); },
  });
  return r;
});

ipcMain.handle('terracotta:launch', async () => {
  const bin = terracottaBinary();
  if (!bin) throw new Error('尚未下载陶瓦联机，请先点「下载陶瓦联机」');
  const r = await terracotta.launchTerracotta({
    binary: bin,
    hmclFile: TERRACOTTA_PORT_FILE,
    onLog: (s) => { if (mainWindow) mainWindow.webContents.send('terracotta:log', s); },
  });
  return { port: r.port, meta: r.meta };
});

ipcMain.handle('terracotta:state', async (_e, { port }) => terracotta.getState(port));
ipcMain.handle('terracotta:meta', async (_e, { port }) => terracotta.getMeta(port));
ipcMain.handle('terracotta:host', async (_e, { port, player, room }) =>
  terracotta.hostRoom(port, { player, room }));
ipcMain.handle('terracotta:join', async (_e, { port, room, player }) =>
  terracotta.joinRoom(port, { room, player }));
ipcMain.handle('terracotta:reset', async (_e, { port }) => terracotta.resetState(port));
ipcMain.handle('terracotta:log', async (_e, { port }) => terracotta.getLog(port));
ipcMain.handle('terracotta:parseRoom', (_e, { code }) => terracotta.parseRoomCode(code));
// 解析整段「联机邀请」（房间码 + 资源清单），容忍换行被吞 / 前后夹带说明文字
ipcMain.handle('terracotta:parseInvite', (_e, { text }) => invite.parseInvite(text));

// ---------- 微软正版账号登录（设备码授权） ----------
let msLoginAbort = null;
let msLoginGen = 0;
ipcMain.handle('msauth:login', async (_e, { clientId }) => {
  const cid = (clientId || config.get('msaClientId') || '').trim();
  if (!cid) {
    throw new Error('尚未配置微软账号 clientId。请到「设置 → 微软账号」填入在 Entra/Azure 注册应用得到的「应用程序(客户端) ID」。');
  }
  // 每次登录递增「代次」；旧登录若还在跑先 abort 掉（避免两个轮询同时跑、互相干扰）。
  // 代次 + 取消标记用于：旧登录被 abort / 被新登录顶掉时，其 catch 静默结束，不再把
  // 「已取消登录」当失败弹出来干扰新登录（这是「一开弹窗就提示已取消」的根因）。
  const myGen = ++msLoginGen;
  if (msLoginAbort) { try { msLoginAbort.abort(); } catch (_) {} }
  const ctrl = new AbortController();
  msLoginAbort = ctrl;
  // 立刻把一次性代码推给渲染端展示，后台继续轮询
  const device = await msauth.requestDeviceCode(cid);
  if (mainWindow) mainWindow.webContents.send('msauth:progress', { stage: 'device', device });

  msauth.loginWithDeviceCode(cid, {
    signal: ctrl.signal,
    device,
    onStatus: (s) => { if (mainWindow) mainWindow.webContents.send('msauth:progress', { stage: 'status', text: s }); },
  }).then(async (profile) => {
    // 登录成功：存成账户对象（离线账户是字符串，正版账户是对象）
    const accounts = (config.get('accounts') || []).slice();
    const entry = {
      type: 'msa',
      name: profile.name,
      uuid: profile.id,
      accessToken: profile.accessToken,
      refreshToken: profile.refreshToken || '',
      savedAt: Date.now(),
      skinUrl: profile.skinUrl || '',
      capeUrl: profile.capeUrl || '',
    };
    const idx = accounts.findIndex((a) => typeof a === 'object' && a && a.uuid === entry.uuid);
    if (idx >= 0) accounts[idx] = entry; else accounts.push(entry);
    config.set('accounts', accounts);
    config.set('activeAccount', profile.name);
    if (profile.skinUrl) {
      try {
        const { ensureDir } = require('./src/core/instances');
        const skinDir = path.join(app.getPath('userData'), 'skins');
        ensureDir(skinDir);
        const file = path.join(skinDir, profile.id + '.png');
        const res = await fetch(profile.skinUrl);
        if (res.ok) fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        config.set('skinPath', file);
      } catch (_) { /* 皮肤下载失败不影响登录 */ }
    }
    if (mainWindow) mainWindow.webContents.send('msauth:done', entry);
  }).catch((err) => {
    const msg = String((err && err.message) || err);
    // 主动取消（用户点「取消」/ 被更新的登录顶掉）：不弹「已取消登录」、也不回退，静默结束。
    if (ctrl.signal.aborted || myGen !== msLoginGen) return;
    // 自带 Azure 应用未通过 Mojang 的 Minecraft API 审核 → login_with_xbox 返回 403。
    // 此时自动转「授权码通道」（Mojang 官方已审核 ID），界面提示用户粘贴回跳链接。
    if (shouldFallbackToLiveAuth(msg)) {
      if (mainWindow) {
        mainWindow.webContents.send('msauth:progress', {
          stage: 'fallback',
          reason: msg,
          message: '设备码通道被微软拒绝（403：该登录方式尚未获得 Minecraft 接口授权）。正在切换到备用登录方式…',
        });
      }
      // 给渲染端一点时间显示提示，再推授权页
      setTimeout(async () => {
        try {
          const r = await msauth.startLiveAuth({
            onStatus: (st) => { if (mainWindow) mainWindow.webContents.send('msauth:progress', { stage: 'status', text: st }); },
          });
          if (mainWindow) {
            mainWindow.webContents.send('msauth:progress', {
              stage: 'liveAuth',
              authUrl: r.authUrl,
              clientId: r.clientId,
              reason: msg,
            });
          }
        } catch (e2) {
          if (mainWindow) mainWindow.webContents.send('msauth:error', String((e2 && e2.message) || e2));
        }
      }, 1200);
      return;
    }
    if (mainWindow) mainWindow.webContents.send('msauth:error', msg);
  }).finally(() => { if (msLoginAbort === ctrl) msLoginAbort = null; });

  return { userCode: device.userCode, verificationUri: device.verificationUri, verificationUriComplete: device.verificationUriComplete, expiresIn: device.expiresIn };
});

// 登录成功后保存正版账户（设备码 / 授权码两条通道共用）
async function saveMsaAccount(profile) {
  const accounts = (config.get('accounts') || []).slice();
  const entry = {
    type: 'msa',
    name: profile.name,
    uuid: profile.id,
    accessToken: profile.accessToken,
    refreshToken: profile.refreshToken || '',
    savedAt: Date.now(),
    // 登录通道：'device' = 设备码（自有 Azure 应用）；'live' = 授权码（Mojang 官方 ID，老端点）
    // 两者刷新令牌的端点不同，刷新时按这个字段分流
    authChannel: profile.authChannel || 'device',
    skinUrl: profile.skinUrl || '',
    capeUrl: profile.capeUrl || '',
  };
  const idx = accounts.findIndex((a) => typeof a === 'object' && a && a.uuid === entry.uuid);
  if (idx >= 0) accounts[idx] = entry; else accounts.push(entry);
  config.set('accounts', accounts);
  config.set('activeAccount', profile.name);
  if (profile.skinUrl) {
    try {
      const { ensureDir } = require('./src/core/instances');
      const skinDir = path.join(app.getPath('userData'), 'skins');
      ensureDir(skinDir);
      const file = path.join(skinDir, profile.id + '.png');
      const res = await fetch(profile.skinUrl);
      if (res.ok) fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      config.set('skinPath', file);
    } catch (_) { /* 皮肤下载失败不影响登录 */ }
  }
  return entry;
}

// 刷新正版账户令牌：按登录通道选端点；通道未知或失败时自动双通道都试。
// 背景：设备码通道的 refresh_token 只能走 Azure v2 端点；授权码通道（Mojang 官方 ID）的
// refresh_token 只能走 login.live.com 老端点 —— 走错端点必然失败。
// 3.10/3.11 早期构建保存的账户没有 authChannel 标记，靠这里自动识别并回写。
async function refreshMsaToken(acc) {
  const tryLive = async () => {
    const r = await msauth.finishLiveRefresh(acc.refreshToken);
    return { accessToken: r.accessToken, refreshToken: r.refreshToken, authChannel: 'live' };
  };
  const tryDevice = async () => {
    const r = await msauth.refreshAccessToken(config.get('msaClientId'), acc.refreshToken);
    return { accessToken: r.accessToken, refreshToken: r.refreshToken, authChannel: 'device' };
  };
  if (acc.authChannel === 'live') return tryLive().catch(tryDevice);
  return tryDevice().catch(tryLive); // 'device' 或未标记：device 优先，失败自动试 live
}

// 判断是不是「Azure 应用未获 Minecraft API 授权」导致的 403
// （微软要求新建应用必须申请 api.minecraftservices.com 权限，否则该接口一律 403）
// 设备码通道拿不到 Minecraft 令牌时，是否切到「已审核的官方授权码通道」再试。
// 触发条件放宽（2026-11-04）：自带 Azure 应用未过 Minecraft API 审核，Xbox / XSTS / Minecraft
// 任一环节只要出现 403 / 429 / 网络层问题（超时、被拦截、抽风）/ 接口异常，就切备用通道再试。
// 但「儿童账号 / 未拥有 Java 版 / 账号被风控」这类明确账号错误不切 —— 换了通道也登录不了，直接报更清楚。
function shouldFallbackToLiveAuth(msg) {
  const m = String(msg || '').toLowerCase();
  if (/儿童|child|没有购买|未拥有|no_subscription|no_profile|account_suspended/.test(m)) return false;
  return /403|429|失败|异常|抽风|网络|超时|timeout|fetch failed|aborted|econnreset|enotfound|socket hang|invalid|denied/.test(m);
}

// ---------- 授权码通道（Mojang 官方客户端 ID + login.live.com 老端点） ----------
// 设备码通道的 Azure 应用未通过 Mojang 的 Minecraft API 审核 → login_with_xbox 返回 403，
// 此时自动改走这条已审核 ID 的通道，界面让用户把浏览器回跳后的链接粘回来。
ipcMain.handle('msauth:loginLive', async (_e, { code, clientId } = {}) => {
  const cid = (clientId || '').trim() || msauth.MOJANG_CLIENT_ID;
  try {
    const profile = await msauth.finishLiveAuth(code, cid, {
      onStatus: (st) => { if (mainWindow) mainWindow.webContents.send('msauth:progress', { stage: 'status', text: st }); },
    });
    const entry = await saveMsaAccount(profile);
    if (mainWindow) mainWindow.webContents.send('msauth:done', entry);
    return { ok: true, name: profile.name };
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (mainWindow) mainWindow.webContents.send('msauth:error', msg);
    throw new Error(msg);
  }
});

// ---------- 应用内登录窗口（一步到位） ----------
// 原理：微软官方 Minecraft 客户端 ID（00000000402b5328）只支持 login.live.com 老端点的授权码流程，
// 回跳地址固定是 oauth20_desktop.srf 网页、本地服务器接不住 —— 这是 PCL「复制链接」的由来。
// 但在 QJML 里我们用 Electron 内嵌窗口打开登录页，直接监听窗口内的跳转事件截获 code，
// 用户全程只需要登录一次，连复制粘贴都省了。
let msWebLoginWin = null;
ipcMain.handle('msauth:webLogin', async () => {
  const send = (p) => { if (mainWindow) { try { mainWindow.webContents.send('msauth:progress', p); } catch (_) {} } };
  // 已开着就先关掉旧的，避免窗口越积越多
  if (msWebLoginWin) { try { msWebLoginWin.destroy(); } catch (_) {} msWebLoginWin = null; }
  const authUrl = msauth.buildLiveAuthUrl(msauth.MOJANG_CLIENT_ID);
  const win = new BrowserWindow({
    width: 500,
    height: 720,
    title: '微软账号登录',
    autoHideMenuBar: true,
    // persist 分区：记住登录状态，下次登录可能不用再输密码
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:mslogin' },
  });
  msWebLoginWin = win;
  const grabbed = await new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (settled) return; settled = true; msWebLoginWin = null; try { win.destroy(); } catch (_) {} resolve(v); };
    const grab = (url) => {
      if (typeof url === 'string' && url.includes('login.live.com/oauth20_desktop.srf')) {
        settle({ code: msauth.extractLiveCode(url), url });
        return true;
      }
      return false;
    };
    const wc = win.webContents;
    wc.on('will-redirect', (e, url) => { if (grab(url)) { try { e.preventDefault(); } catch (_) {} } });
    wc.on('will-navigate', (e, url) => { if (grab(url)) { try { e.preventDefault(); } catch (_) {} } });
    wc.on('did-navigate', (_e, url) => { grab(url); });
    win.on('closed', () => settle({ code: '', canceled: true }));
    send({ stage: 'status', text: '已打开微软登录窗口，请在窗口内登录微软账号…' });
    win.loadURL(authUrl).catch(() => settle({ code: '', error: '微软登录窗口加载失败（网络问题？）' }));
  });
  if (grabbed.canceled) return { ok: false, canceled: true };
  if (!grabbed.code) {
    const msg = grabbed.error || '登录未完成（没有拿到微软授权码，请重试或改用备用方式）';
    send({ stage: 'status', text: '' });
    if (mainWindow) mainWindow.webContents.send('msauth:error', msg);
    throw new Error(msg);
  }
  try {
    const profile = await msauth.finishLiveAuth(grabbed.code, msauth.MOJANG_CLIENT_ID, {
      onStatus: (st) => send({ stage: 'status', text: st }),
    });
    profile.authChannel = 'live';
    const entry = await saveMsaAccount(profile);
    if (mainWindow) mainWindow.webContents.send('msauth:done', entry);
    return { ok: true, name: profile.name };
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (mainWindow) mainWindow.webContents.send('msauth:error', msg);
    throw new Error(msg);
  }
});

// 开始授权码通道的第 1 步：拿到授权页 URL（渲染端用它打开浏览器）
ipcMain.handle('msauth:liveAuthUrl', async (_e, { clientId } = {}) => {
  const cid = (clientId || '').trim() || msauth.MOJANG_CLIENT_ID;
  const r = await msauth.startLiveAuth({
    onStatus: (st) => { if (mainWindow) mainWindow.webContents.send('msauth:progress', { stage: 'status', text: st }); },
  });
  return { authUrl: r.authUrl, clientId: cid };
});

ipcMain.handle('msauth:cancel', async () => {
  if (msLoginAbort) { try { msLoginAbort.abort(); } catch (_) {} msLoginAbort = null; }
  // 内嵌登录窗口也一并关掉（渲染层「取消」按钮走这里）
  if (msWebLoginWin) { try { msWebLoginWin.destroy(); } catch (_) {} msWebLoginWin = null; }
  return { ok: true };
});

// ---------- 皮肤库 ----------
// 内置热门公开皮肤（随包分发）+ 在线按玩家名导入 + 本地已下载
ipcMain.handle('skins:list', () => {
  const skins = require('./src/core/skins');
  const dir = skins.resolveDir({ configured: config.get('skinLibraryDir'), appDir, gameDir: root() });
  return { dir, builtin: skins.BUILTIN, local: skins.listLocal(dir) };
});
ipcMain.handle('skins:import', async (_e, { name }) => {
  const skins = require('./src/core/skins');
  const dir = skins.resolveDir({ configured: config.get('skinLibraryDir'), appDir, gameDir: root() });
  const r = await skins.importByName(dir, name, (msg) => { if (mainWindow) mainWindow.webContents.send('skins:log', msg); });
  return r;
});
// 把安装包内置的皮肤复制一份到皮肤库目录，拿到绝对路径
ipcMain.handle('skins:copyBuiltin', (_e, { file }) => {
  const skins = require('./src/core/skins');
  const safe = String(file || '').replace(/[^A-Za-z0-9_]/g, '');
  if (!safe) throw new Error('非法的皮肤名');
  const src = path.join(__dirname, 'src', 'renderer', 'assets', 'skins', safe + '.png');
  if (!fs.existsSync(src)) throw new Error('内置皮肤不存在：' + safe);
  const dir = skins.resolveDir({ configured: config.get('skinLibraryDir'), appDir, gameDir: root() });
  if (!dir) throw new Error('皮肤库目录不可写');
  const dest = path.join(dir, safe + '.png');
  try { fs.copyFileSync(src, dest); } catch (_) { /* 已存在就算了 */ }
  return { file: dest, name: safe };
});
ipcMain.handle('skins:remove', (_e, { name }) => {
  const skins = require('./src/core/skins');
  const dir = skins.resolveDir({ configured: config.get('skinLibraryDir'), appDir, gameDir: root() });
  return skins.removeLocal(dir, name);
});
ipcMain.handle('skins:setDir', (_e, { dir }) => {
  config.set('skinLibraryDir', dir || null);
  const skins = require('./src/core/skins');
  return { dir: skins.resolveDir({ configured: config.get('skinLibraryDir'), appDir, gameDir: root() }) };
});
// 把皮肤同步到正版账号（需要微软账号的 accessToken，即 Minecraft services 令牌）
// ★ 接口说明：现行官方上传接口是 POST https://api.minecraftservices.com/minecraft/profile/skins
//   multipart/form-data：variant(classic|slim) + file(PNG)。
//   旧接口 api.mojang.com/user/profile/<uuid> 早已废弃（返回 405 METHOD_NOT_ALLOWED）。
ipcMain.handle('skins:applyAccount', async (_e, { file, variant }) => {
  const accounts = config.get('accounts') || [];
  const active = config.get('activeAccount');
  const acc = accounts.find((a) => a && typeof a === 'object' && a.type === 'msa' && a.name === active)
    || accounts.find((a) => a && typeof a === 'object' && a.type === 'msa' && a.accessToken);
  if (!acc || !acc.accessToken) throw new Error('没有找到可用的正版账号（请先在「首页 → 账户」登录微软账号）');
  if (!file || !fs.existsSync(file)) throw new Error('皮肤文件不存在');
  // 文件名带 slim/alex 默认细手臂模型，其余经典（Steve）模型；也可由界面显式传入
  const v = variant === 'slim' ? 'slim'
    : variant === 'classic' ? 'classic'
    : (/slim|alex/i.test(path.basename(file)) ? 'slim' : 'classic');
  const form = new FormData();
  form.append('variant', v);
  form.append('file', new Blob([fs.readFileSync(file)], { type: 'image/png' }), path.basename(file));
  let res;
  try {
    res = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + acc.accessToken, 'User-Agent': 'QJML-Launcher' },
      body: form,
    });
  } catch (e) {
    throw new Error('连接 Mojang 皮肤接口失败（网络问题）：' + e.message);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    let msg = t;
    try { const j = JSON.parse(t); msg = j.errorMessage || j.error || j.message || t; } catch (_) { /* 保留原文 */ }
    if (res.status === 401) {
      throw new Error('登录凭据已过期（HTTP 401），请退出账号后重新登录再同步皮肤');
    }
    throw new Error('Mojang 接口返回 HTTP ' + res.status + (msg ? '：' + String(msg).slice(0, 160) : ''));
  }
  return { ok: true, name: acc.name, variant: v };
});

// ---------- 联机模组清单（房主导出 / 加入方对齐） ----------
ipcMain.handle('manifest:build', async (_e, { instance, mc, loader, name, loaderVersion, skins }) => {
  const cfg = config.all();
  return manifest.buildManifest({
    root: root(), instance, mc, loader,
    isolation: cfg.versionIsolation,
    name, loaderVersion, skins,
  });
});

// 房主：把自己正版账号的皮肤名放进清单（加入方据此拉取「对方的皮肤」）
ipcMain.handle('manifest:mySkins', async () => {
  const accounts = config.get('accounts') || [];
  const active = config.get('activeAccount');
  const acc = accounts.find((a) => a && typeof a === 'object' && a.type === 'msa' && a.name === active)
    || accounts.find((a) => a && typeof a === 'object' && a.type === 'msa');
  if (!acc || !acc.name) return [];
  // 本地皮肤库里已有同名皮肤 → 直接带上文件哈希（加入方可从公开源拉同款）
  const skins = require('./src/core/skins');
  const dir = skins.resolveDir({ configured: config.get('skinLibraryDir'), appDir, gameDir: root() });
  const local = skins.listLocal(dir);
  const hit = local.find((s) => String(s.name).toLowerCase() === String(acc.name).toLowerCase());
  return [{ player: acc.name, file: hit ? hit.file : '', sha1: hit ? manifest.sha1File(hit.file) : '' }];
});

// 检测本机 Minecraft 是否已「对局域网开放」（建房前必须，否则生成不出房间码）
ipcMain.handle('terracotta:lanStatus', async () => {
  return terracotta.detectLanOpen(1500);
});

ipcMain.handle('manifest:diff', async (_e, { instance, remote }) => {
  const cfg = config.all();
  const local = manifest.listMods(root(), instance, cfg.versionIsolation);
  return manifest.diffManifest(local, remote || []);
});

ipcMain.handle('dialog:selectDir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});
ipcMain.handle('dialog:openFile', async (_e, exts) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: exts ? [{ name: 'Files', extensions: exts }] : [{ name: 'All', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});
ipcMain.handle('shell:openPath', async (_e, p) => { try { await shell.openPath(p); } catch (_) {} return p; });
// 写剪贴板：走主进程 Electron clipboard，比渲染层 navigator.clipboard 可靠
// （窗口未聚焦 / 非安全上下文时 navigator.clipboard 会直接失败）
ipcMain.handle('clipboard:write', async (_e, text) => {
  try {
    clipboard.writeText(String(text == null ? '' : text));
    return true;
  } catch (e) {
    return false;
  }
});
// 打开外部链接（白名单：只放微软 / GitHub / 模组站点，避免被当成任意 URL 跳板）
ipcMain.handle('shell:openExternal', async (_e, url) => {
  const u = String(url || '');
  // 微软系域名：设备码登录实际跳转的是 microsoft.com/devicesignin（不是 login.microsoftonline.com），
  // 所以必须把整条微软登录链路都放行，否则「打开微软授权页」会被拦掉。
  const MICROSOFT = [
    'microsoft.com', 'www.microsoft.com', 'login.microsoftonline.com',
    'login.live.com', 'login.windows.net', 'account.microsoft.com',
    'portal.azure.com', 'entra.microsoft.com', 'apps.dev.microsoft.com',
    'msftauth.net', 'msauth.net', 'msftconnecttest.com', 'aka.ms',
  ];
  const OTHER = ['learn.microsoft.com', 'github.com', 'www.minecraft.net', 'modrinth.com', 'curseforge.com'];
  let host = '';
  let proto = '';
  try {
    const u2 = new URL(u);
    host = u2.hostname.toLowerCase();
    proto = u2.protocol;
  } catch (_) { host = ''; }
  const ok = MICROSOFT.some((h) => host === h || host.endsWith('.' + h))
    || OTHER.some((h) => host === h || host.endsWith('.' + h));
  if (proto !== 'https:' || !ok) throw new Error('不允许打开该链接');
  try { await shell.openExternal(u); } catch (_) {}
  return true;
});

// 启动器自身的目录信息（用于设置页展示 / 迁移提示）
ipcMain.handle('app:info', () => {
  const cfgMod = require('./src/core/config');
  const ver = require('./src/core/version');
  let portableGameDir = null;
  try { portableGameDir = cfgMod.findPortableGameDir(appDir); } catch (_) {}
  return {
    dataDir: app.getPath('userData'),
    exeDir: appDir,
    portableGameDir,
    gameDirectory: root(),
    // 旧数据在启动器旁边、而当前配置指向别处 → 提示用户可以迁移
    canMigrate: !!(portableGameDir && portableGameDir !== root()),
    // 版本信息（关于页用）
    version: ver.APP_VERSION,
    appName: ver.APP_NAME,
    appFullName: ver.APP_FULL_NAME,
    changelog: ver.CHANGELOG,
  };
});
ipcMain.handle('app:checkUpdate', async () => {
  const updater = require('./src/core/updater');
  const ver = require('./src/core/version');
  return updater.checkUpdate({ current: ver.APP_VERSION, config: config.all() });
});

// ---------- 右下角「关闭」按钮 ----------
// 正常情况：单击 = 关闭软件
// MC 运行中：按钮变红，单击 = 任务管理器式强制结束 Minecraft
// 关闭前先查「当前世界有没有未保存的进度」，有的话要用户确认
ipcMain.handle('game:status', () => gameproc.status());
// 关闭前的风险评估：有没有开着的世界（可能未保存）
ipcMain.handle('game:closingRisk', () => gameproc.closingRisk());
// 强制结束 Minecraft（taskkill /F /T）
ipcMain.handle('game:forceKill', async () => {
  const r = await gameproc.forceKill();
  if (mainWindow) mainWindow.webContents.send('game:state', gameproc.status());
  return r;
});
// 真正退出软件
ipcMain.handle('app:quit', () => {
  // 延迟一点，让 IPC 返回先到渲染层
  setTimeout(() => { app.quit(); }, 120);
  return { ok: true };
});
ipcMain.handle('paths:packDir', (_e, { instance, type }) => {
  const { packDir } = require('./src/core/paths');
  return packDir(root(), instance, type, isolation());
});
