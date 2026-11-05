'use strict';
// 预加载脚本：把主进程能力安全地暴露给渲染进程
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  configGet: () => ipcRenderer.invoke('config:get'),
  configSet: (key, value) => ipcRenderer.invoke('config:set', key, value),
  zhNames: () => ipcRenderer.invoke('zh:names'),
  zhDict: () => ipcRenderer.invoke('zh:dict'),
  setThemeOverlay: (dark) => ipcRenderer.invoke('window:setOverlay', dark),

  listInstances: () => ipcRenderer.invoke('instances:list'),
  deleteInstance: (name) => ipcRenderer.invoke('instances:delete', { name }),
  renameInstance: (from, to) => ipcRenderer.invoke('instances:rename', { from, to }),
  instancesDir: (name) => ipcRenderer.invoke('instances:dir', { name }),
  modsRecent: (instance, limit) => ipcRenderer.invoke('mods:recent', { instance, limit }),
  modsScan: (instance) => ipcRenderer.invoke('mods:scan', { instance }),
  modsRemove: (instance, file) => ipcRenderer.invoke('mods:remove', { instance, file }),
  compatCheck: (payload) => ipcRenderer.invoke('compat:check', payload),
  listPacks: (instance, type) => ipcRenderer.invoke('packs:list', { instance, type }),
  togglePack: (instance, type, file, enable) => ipcRenderer.invoke('pack:toggle', { instance, type, file, enable }),
  deletePack: (instance, type, file) => ipcRenderer.invoke('pack:delete', { instance, type, file }),
  checkUpdates: (instance) => ipcRenderer.invoke('mods:checkUpdates', { instance }),
  applyUpdates: (instance, results) => ipcRenderer.invoke('mods:applyUpdates', { instance, results }),
  importPacks: (payload) => ipcRenderer.invoke('packs:import', payload),
  modpackParse: (filePath) => ipcRenderer.invoke('modpack:parse', { filePath }),
  modpackInstall: (payload) => ipcRenderer.invoke('modpack:install', payload),
  onModpackProgress: (cb) => ipcRenderer.on('modpack:progress', (_e, p) => cb(p)),
  offModpackProgress: () => ipcRenderer.removeAllListeners('modpack:progress'),
  onUpdateProgress: (cb) => ipcRenderer.on('mods:updateProgress', (_e, p) => cb(p)),
  offUpdateProgress: () => ipcRenderer.removeAllListeners('mods:updateProgress'),

  modrinthSearch: (params) => ipcRenderer.invoke('modrinth:search', params),
  modrinthVersions: (projectId) => ipcRenderer.invoke('modrinth:versions', projectId),
  modrinthProject: (projectId) => ipcRenderer.invoke('modrinth:project', projectId),
  modrinthProjects: (ids) => ipcRenderer.invoke('modrinth:projects', ids),
  modrinthResolve: ({ projectId, mc, versionId }) => ipcRenderer.invoke('modrinth:resolve', { projectId, mc, versionId }),
  modrinthFabricApi: ({ mc, loader }) => ipcRenderer.invoke('modrinth:fabricApi', { mc, loader }),
  modrinthInstall: (payload) => ipcRenderer.invoke('modrinth:install', payload),
  modrinthFeatured: () => ipcRenderer.invoke('modrinth:featured'),
  modrinthChannel: () => ipcRenderer.invoke('modrinth:channel'),
  onModrinthProgress: (cb) => ipcRenderer.on('modrinth:progress', (_e, p) => cb(p)),
  offModrinthProgress: () => ipcRenderer.removeAllListeners('modrinth:progress'),
  onModrinthLog: (cb) => ipcRenderer.on('modrinth:log', (_e, s) => cb(s)),

  curseforgeStatus: () => ipcRenderer.invoke('curseforge:status'),
  curseforgeSearch: (params) => ipcRenderer.invoke('curseforge:search', params),
  curseforgeProject: (id) => ipcRenderer.invoke('curseforge:project', id),
  curseforgeFiles: (id) => ipcRenderer.invoke('curseforge:files', id),
  curseforgeInstall: (payload) => ipcRenderer.invoke('curseforge:install', payload),
  curseforgeChannel: () => ipcRenderer.invoke('curseforge:channel'),
  optifineInfo: () => ipcRenderer.invoke('optifine:info'),
  optifineInstall: (payload) => ipcRenderer.invoke('optifine:install', payload),

  launchStart: (payload) => ipcRenderer.invoke('launch:start', payload),
  onLaunchLog: (cb) => ipcRenderer.on('launch:log', (_e, line) => cb(line)),
  onLaunchStatus: (cb) => ipcRenderer.on('launch:status', (_e, t) => cb(t)),
  onLaunchClose: (cb) => ipcRenderer.on('launch:close', (_e, code, diagnosis) => cb(code, diagnosis)),
  onLaunchError: (cb) => ipcRenderer.on('launch:error', (_e, err) => cb(err)),

  convertDetect: (buffer) => ipcRenderer.invoke('convert:detect', buffer),
  convertRun: (buffer, targetVersion) => ipcRenderer.invoke('convert:run', { buffer, targetVersion }),
  convertOnline: (payload) => ipcRenderer.invoke('convert:online', payload),
  onConvertStep: (cb) => ipcRenderer.on('convert:step', (_e, s) => cb(s)),

  javaList: () => ipcRenderer.invoke('java:list'),
  javaDownload: (feature) => ipcRenderer.invoke('java:download', feature),
  onJavaProgress: (cb) => ipcRenderer.on('java:progress', (_e, p) => cb(p)),

  loaderVersions: (params) => ipcRenderer.invoke('loader:versions', params),
  loaderInstall: (params) => ipcRenderer.invoke('loader:install', params),
  onLoaderProgress: (cb) => ipcRenderer.on('loader:progress', (_e, s) => cb(s)),

  presetList: () => ipcRenderer.invoke('preset:list'),
  presetApply: (payload) => ipcRenderer.invoke('preset:apply', payload),
  onPresetProgress: (cb) => ipcRenderer.on('preset:progress', (_e, s) => cb(s)),

  vanillaInstall: (payload) => ipcRenderer.invoke('vanilla:install', payload),
  vanillaVersions: () => ipcRenderer.invoke('vanilla:versions'),
  vanillaImportLocal: (srcDir) => ipcRenderer.invoke('vanilla:importLocal', { srcDir }),
  onVanillaProgress: (cb) => ipcRenderer.on('vanilla:progress', (_e, s) => cb(s)),
  offVanillaProgress: () => ipcRenderer.removeAllListeners('vanilla:progress'),
  offLoaderProgress: () => ipcRenderer.removeAllListeners('loader:progress'),

  terracottaStatus: () => ipcRenderer.invoke('terracotta:status'),
  terracottaRelease: () => ipcRenderer.invoke('terracotta:release'),
  terracottaDownload: (payload) => ipcRenderer.invoke('terracotta:download', payload),
  terracottaLaunch: () => ipcRenderer.invoke('terracotta:launch'),
  terracottaState: (port) => ipcRenderer.invoke('terracotta:state', { port }),
  terracottaMeta: (port) => ipcRenderer.invoke('terracotta:meta', { port }),
  terracottaHost: (payload) => ipcRenderer.invoke('terracotta:host', payload),
  terracottaJoin: (payload) => ipcRenderer.invoke('terracotta:join', payload),
  terracottaReset: (port) => ipcRenderer.invoke('terracotta:reset', { port }),
  terracottaLog: (port) => ipcRenderer.invoke('terracotta:log', { port }),
  terracottaParseRoom: (code) => ipcRenderer.invoke('terracotta:parseRoom', { code }),
  // 解析整段「联机邀请」（房间码 + 资源清单），比单房间码宽松
  terracottaParseInvite: (text) => ipcRenderer.invoke('terracotta:parseInvite', { text }),
  onTerracottaProgress: (cb) => ipcRenderer.on('terracotta:progress', (_e, p) => cb(p)),
  onTerracottaLog: (cb) => ipcRenderer.on('terracotta:log', (_e, s) => cb(s)),

  manifestBuild: (payload) => ipcRenderer.invoke('manifest:build', payload),
  manifestDiff: (payload) => ipcRenderer.invoke('manifest:diff', payload),
  manifestMySkins: () => ipcRenderer.invoke('manifest:mySkins'),
  // 清单压缩/解压（gzip + base64url）——放渲染层做，避免主进程传大字符串
  manifestEncode: (obj) => {
    try {
      // Node 的 zlib 在 preload 里不可用，这里用内置的 CompressionStream（Chromium 80+）
      const bytes = new TextEncoder().encode(JSON.stringify(obj));
      const cs = new CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      writer.write(bytes); writer.close();
      return new Response(cs.readable).arrayBuffer().then((buf) => {
        let bin = '';
        const u8 = new Uint8Array(buf);
        for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      });
    } catch (_) { return null; }
  },
  manifestDecode: (b64) => {
    try {
      const s = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(s);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const ds = new DecompressionStream('gzip');
      const writer = ds.writable.getWriter();
      writer.write(u8); writer.close();
      return new Response(ds.readable).json().catch(() => null);
    } catch (_) { return null; }
  },
  terracottaLanStatus: () => ipcRenderer.invoke('terracotta:lanStatus'),

  msauthLogin: (clientId) => ipcRenderer.invoke('msauth:login', { clientId }),
  // 应用内登录窗口（一步到位）：弹出内嵌窗口登录，自动截获授权码
  msauthWebLogin: () => ipcRenderer.invoke('msauth:webLogin'),
  msauthCancel: () => ipcRenderer.invoke('msauth:cancel'),
  // 授权码通道（Mojang 官方已审核 ID 的兜底登录）：第 1 步拿授权页 URL，第 2 步提交回跳链接
  msauthLiveAuthUrl: (clientId) => ipcRenderer.invoke('msauth:liveAuthUrl', { clientId }),
  msauthLoginLive: (code, clientId) => ipcRenderer.invoke('msauth:loginLive', { code, clientId }),
  onMsauthProgress: (cb) => ipcRenderer.on('msauth:progress', (_e, p) => cb(p)),
  onMsauthDone: (cb) => ipcRenderer.on('msauth:done', (_e, p) => cb(p)),
  onMsauthError: (cb) => ipcRenderer.on('msauth:error', (_e, s) => cb(s)),

  selectDir: () => ipcRenderer.invoke('dialog:selectDir'),  openFile: (exts) => ipcRenderer.invoke('dialog:openFile', exts),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write', text),
  checkAppUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  gameOptionsGet: () => ipcRenderer.invoke('gameOptions:get'),
  gameOptionsSave: (data) => ipcRenderer.invoke('gameOptions:save', data),
  gameOptionsReset: () => ipcRenderer.invoke('gameOptions:reset'),
  worldsList: (instance) => ipcRenderer.invoke('worlds:list', { instance }),
  worldsBackup: (worldName, instance) => ipcRenderer.invoke('worlds:backup', { worldName, instance }),
  backupsList: (worldFilter) => ipcRenderer.invoke('backups:list', { worldFilter }),
  backupsRestore: (worldName, backupName, instance) => ipcRenderer.invoke('backups:restore', { worldName, backupName, instance }),
  appInfo: () => ipcRenderer.invoke('app:info'),
  appReady: () => ipcRenderer.invoke('app:ready'),
  // 右下角关闭按钮
  gameStatus: () => ipcRenderer.invoke('game:status'),
  gameClosingRisk: () => ipcRenderer.invoke('game:closingRisk'),
  gameForceKill: () => ipcRenderer.invoke('game:forceKill'),
  // 下载守卫：主进程有下载/安装在跑时，右下角关闭按钮据此拦下用户
  dlIsActive: () => ipcRenderer.invoke('dl:isActive'),
  onDlState: (cb) => ipcRenderer.on('dl:state', (_e, s) => cb(s)),
  appQuit: () => ipcRenderer.invoke('app:quit'),
  appConfirmQuit: () => ipcRenderer.invoke('app:confirmQuit'),
  onGameState: (cb) => ipcRenderer.on('game:state', (_e, s) => cb(s)),
  onAskClose: (cb) => ipcRenderer.on('app:askClose', (_e, risk) => cb(risk)),
  packDir: (instance, type) => ipcRenderer.invoke('paths:packDir', { instance, type }),

  customModManifest: () => ipcRenderer.invoke('custommod:manifest'),
  customModInstall: (payload) => ipcRenderer.invoke('custommod:install', payload),
  onCustomModProgress: (cb) => ipcRenderer.on('custommod:progress', (_e, p) => cb(p)),
  offCustomModProgress: () => ipcRenderer.removeAllListeners('custommod:progress'),

  skinsList: () => ipcRenderer.invoke('skins:list'),
  skinsImport: (name) => ipcRenderer.invoke('skins:import', { name }),
  skinsRemove: (name) => ipcRenderer.invoke('skins:remove', { name }),
  skinsCopyBuiltin: (file) => ipcRenderer.invoke('skins:copyBuiltin', { file }),
  skinsSetDir: (dir) => ipcRenderer.invoke('skins:setDir', { dir }),
  skinsApplyAccount: (file) => ipcRenderer.invoke('skins:applyAccount', { file }),
  onSkinsLog: (cb) => ipcRenderer.on('skins:log', (_e, s) => cb(s)),
  onOpenWeb: (cb) => ipcRenderer.on('app:open-web', (_e, url) => cb(url)),
});
