'use strict';
/* 3.0.5 新增功能的单元测试：
 *   ① 界面配色方案（白色/黑色保持不变 + 中国红/爱马仕橙/草原绿 + 自定义 RGB）
 *   ② 微软登录的网络容错（fetch failed 不再直接判死）
 *   ③ CurseForge 免 Key 搜索不再直接抛错
 *   ④ 版本通道方块图标文件齐全
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}
function section(t) { console.log('\n' + t); }

const theme = require('../src/core/theme');

// ---------- ① 配色方案 ----------
section('[配色 · 方案清单]');
ok('6 个方案齐全', theme.SCHEME_LIST.length === 6);
ok('白色/黑色保留（原有配色不变）',
  theme.SCHEME_LIST[0].id === 'white' && theme.SCHEME_LIST[1].id === 'black');
ok('新增中国红 / 爱马仕橙 / 草原绿 / 自定义',
  ['cn-red', 'hermes-orange', 'prairie-green', 'custom']
    .every((id) => theme.SCHEME_LIST.some((s) => s.id === id)));

section('[配色 · 原有白色/黑色主色不变]');
const white = theme.resolveTheme({ colorScheme: 'white' });
const black = theme.resolveTheme({ colorScheme: 'black' });
ok('白色主色仍是 #4f8cff', white.vars.accent === '#4f8cff');
ok('白色第二主色仍是 #7c5cff', white.vars.accent2 === '#7c5cff');
ok('白色渐变与 3.0.4 一致', white.vars.gradient === 'linear-gradient(135deg, #4f8cff 0%, #7c5cff 100%)');
ok('黑色主色仍是 #6ba0ff', black.vars.accent === '#6ba0ff');
ok('黑色底色仍是 dark', black.theme === 'dark');

section('[配色 · 旧配置迁移]');
ok('老配置 theme=dark → black', theme.resolveTheme({ theme: 'dark' }).schemeId === 'black');
ok('老配置 theme=light → white', theme.resolveTheme({ theme: 'light' }).schemeId === 'white');
ok('老配置 theme=dark 仍是深色底', theme.resolveTheme({ theme: 'dark' }).theme === 'dark');

section('[配色 · 三套新配色]');
for (const [id, name, expectHue] of [
  ['cn-red', '中国红', 'red'],
  ['hermes-orange', '爱马仕橙', 'orange'],
  ['prairie-green', '草原绿', 'green'],
]) {
  const light = theme.resolveTheme({ colorScheme: id, colorBase: 'light' });
  const dark = theme.resolveTheme({ colorScheme: id, colorBase: 'dark' });
  const rgb = theme.hexToRgb(light.vars.accent);
  ok(`${name}（浅底）有合法主色`, !!rgb);
  // 色相判断：红 r 最大、绿 g 最大、橙 r>g>b
  if (expectHue === 'red') ok('中国红主色偏红', rgb.r > rgb.g && rgb.r > rgb.b);
  if (expectHue === 'orange') ok('爱马仕橙主色 r>g>b', rgb.r > rgb.g && rgb.g > rgb.b);
  if (expectHue === 'green') ok('草原绿主色偏绿', rgb.g > rgb.r && rgb.g > rgb.b);
  ok(`${name}（深底）主色更亮`, theme.hexToRgb(dark.vars.accent).r + theme.hexToRgb(dark.vars.accent).g
    + theme.hexToRgb(dark.vars.accent).b >= rgb.r + rgb.g + rgb.b);
  ok(`${name} 两版底色不同`, light.theme === 'light' && dark.theme === 'dark');
}

section('[配色 · 自定义 RGB]');
const cust = theme.resolveTheme({ colorScheme: 'custom', customColor: '#ff6b35', colorBase: 'light' });
ok('自定义主色 = 用户选的色', cust.vars.accent === '#ff6b35');
ok('自定义生成渐变', /linear-gradient/.test(cust.vars.gradient));
ok('自定义生成浅色柔和底', /^#[0-9a-f]{6}$/i.test(cust.vars.soft));
const custDark = theme.resolveTheme({ colorScheme: 'custom', customColor: '#ff6b35', colorBase: 'dark' });
ok('自定义深底也有柔和底色', /^#[0-9a-f]{6}$/i.test(custDark.vars.soft));
ok('自定义深底柔和色比浅底深',
  theme.hexToRgb(custDark.vars.soft).r + theme.hexToRgb(custDark.vars.soft).g + theme.hexToRgb(custDark.vars.soft).b
  < theme.hexToRgb(cust.vars.soft).r + theme.hexToRgb(cust.vars.soft).g + theme.hexToRgb(cust.vars.soft).b);
ok('非法 HEX 被拒绝', theme.hexToRgb('#zzz') === null);

section('[配色 · 渐变派生不出错色]');
// 红/橙/绿的主色派生渐变后，色相应仍落在同一族（不能变成青色这种离谱结果）
for (const [id, expect] of [['cn-red', 'red'], ['hermes-orange', 'orange'], ['prairie-green', 'green']]) {
  const v = theme.resolveTheme({ colorScheme: id, colorBase: 'light' }).vars;
  const m = /linear-gradient\(135deg, (#\w{6}) 0%, (#\w{6}) 100%\)/.exec(v.gradient);
  ok(`${id} 渐变格式正确`, !!m);
  if (m) {
    const c1 = theme.hexToRgb(m[1]);
    if (expect === 'red') ok('cn-red 渐变仍是红色系', c1.r > c1.g && c1.r > c1.b);
    if (expect === 'orange') ok('hermes-orange 渐变仍是橙红系', c1.r > c1.g && c1.g > c1.b);
    if (expect === 'green') ok('prairie-green 渐变仍是绿色系', c1.g >= c1.r);
  }
}

section('[配色 · CSS 变量写入]');
const fakeRoot = { style: { props: {}, setProperty(k, v) { this.props[k] = v; } } };
theme.applyCssVars(fakeRoot, white.vars);
ok('--accent 已写入', fakeRoot.style.props['--accent'] === '#4f8cff');
ok('--accent-gradient 已写入', /linear-gradient/.test(fakeRoot.style.props['--accent-gradient']));
ok('--shadow-accent 已写入', fakeRoot.style.props['--shadow-accent'].includes('rgba'));

// ---------- ② 微软登录容错 ----------
section('[微软登录 · 网络错误提示]');
const msauth = require('../src/core/msauth');
ok('fetch failed → 中文提示', /网络/.test(msauth.friendlyNetError(new Error('fetch failed'), '登录')));
ok('DNS 失败 → 提示 DNS', /DNS|域名/.test(msauth.friendlyNetError(new Error('getaddrinfo ENOTFOUND x'), '登录')));
ok('连接重置 → 提示重置', /重置/.test(msauth.friendlyNetError(new Error('socket hang up'), '登录')));
ok('超时 → 提示超时', /超时/.test(msauth.friendlyNetError(new Error('The operation was aborted'), '登录')));
ok('原始错误不丢失', msauth.friendlyNetError(new Error('something odd'), '登录').includes('something odd'));

section('[微软登录 · 轮询遇网络抖动不判死]');
(async () => {
  // 模拟：第一次轮询抛网络错，第二次成功
  const mod = require('../src/core/msauth');
  const origPoll = mod.pollDeviceToken;
  let calls = 0;
  // 直接验证 loginWithDeviceCode 的容错分支：用假的设备码 + 打桩轮询
  const fakeModule = Object.assign({}, mod, {
    pollDeviceToken: async () => {
      calls++;
      if (calls === 1) throw new Error('fetch failed');
      return { done: false, pending: true };
    },
  });
  // loginWithDeviceCode 内部引用的是模块内的 pollDeviceToken，无法直接打桩，
  // 所以退而验证「错误不会被当成授权失败」：friendlyNetError 产出的是网络提示而非授权失败
  const netErr = mod.friendlyNetError(new Error('fetch failed'), '登录');
  ok('网络错误不会被误判为「授权失败」', !/授权失败/.test(netErr));
  ok('轮询函数已导出', typeof origPoll === 'function');

  // ---------- ③ CurseForge 免 Key 搜索 ----------
  section('[CurseForge · 免 Key 可搜索]');
  const cf = require('../src/core/curseforge');
  ok('isAvailable 恒为 true（不需要 Key）', cf.isAvailable() === true);
  ok('searchOrFallback 存在', typeof cf.searchOrFallback === 'function');
  ok('通道定义含免 Key 的 mcim', cf.CF_CHANNELS.mcim && cf.CF_CHANNELS.mcim.needsKey === false);
  ok('mcim 通道地址正确', cf.CF_CHANNELS.mcim.api.includes('mod.mcimirror.top'));
  ok('rewriteUrl 能把官方 API 改写到镜像',
    cf.rewriteUrl('https://api.curseforge.com/v1/mods/1', 'mcim').includes('mod.mcimirror.top'));
  ok('rewriteUrl 能把官方 CDN 改写到镜像',
    cf.rewriteUrl('https://edge.forgecdn.net/files/1/2/x.jar', 'mcim').includes('mod.mcimirror.top'));

  // 无 Key 时不应该因为「没有 API Key」而直接抛错 —— 源码里不能再有那条老逻辑
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'curseforge.js'), 'utf8');
  ok('源码里已无「CurseForge 搜索需要 API Key」的硬失败', !/CurseForge 搜索需要 API Key/.test(src));
  ok('错误带 [CF-可重试] / [CF-需Key] 前缀（渲染层靠它给不同按钮）',
    /\[CF-可重试\]/.test(src) && /\[CF-需Key\]/.test(src));

  // ---------- ④ 版本通道方块图标 ----------
  section('[版本通道 · 方块图标文件]');
  const iconDir = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'versions');
  for (const f of ['release.png', 'old.png', 'snapshot.png', 'april.png', 'ancient.png']) {
    const p = path.join(iconDir, f);
    ok(`图标存在：${f}`, fs.existsSync(p));
    if (fs.existsSync(p)) {
      const b = fs.readFileSync(p);
      ok(`图标是合法 PNG：${f}`, b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
      ok(`图标带 alpha 通道（RGBA）：${f}`, b[25] === 6);
    }
  }

  // 渲染层引用路径正确
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  ok('渲染层引用了 5 张方块图',
    ['release.png', 'old.png', 'snapshot.png', 'april.png', 'ancient.png']
      .every((f) => appSrc.includes('assets/versions/' + f)));

  // ---------- ⑤ 内置加载器（3.0.5：预置 Forge/NeoForge 安装器，省掉第一步下载）----------
  section('[加载器 · 内置安装器]');
  const bl = require('../src/core/bundledLoaders');
  ok('内置加载器模块存在', typeof bl.findBundledInstaller === 'function');
  ok('内置目录在 src/core/bin/loaders', /bin[\\/]loaders$/.test(bl.BUNDLED_DIR));
  const bundledList = bl.listBundled();
  ok('内置安装器至少覆盖 Forge 与 NeoForge 各一个', (() => {
    const set = new Set(bundledList.map((b) => b.loader));
    return set.has('forge') && set.has('neoforge');
  })());
  ok('内置安装器命名规范 <mc>-<loader>-<version>.jar',
    bundledList.every((b) => /^([\d.]+)-(forge|neoforge|fabric|quilt)-(.+)\.jar$/.test(b.file)));
  ok('内置安装器都是有效 jar（PK 头）', bundledList.every((b) => {
    const head = fs.readFileSync(b.path).slice(0, 2);
    return head[0] === 0x50 && head[1] === 0x4b;
  }));
  ok('找不到未内置版本时返回空（走联网下载兜底）',
    bl.findBundledInstaller('1.20.1', 'forge', '0.0.0-not-exist') === '');

  const loadersSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'loaders.js'), 'utf8');
  ok('installForge 优先用内置安装器', /findBundledInstaller\(mc, 'forge'/.test(loadersSrc));
  ok('installNeoForge 优先用内置安装器', /findBundledInstaller\(mc, 'neoforge'/.test(loadersSrc));
  ok('内置缺失时仍会联网下载（兜底没丢）',
    /downloadBufferMulti\(urls\)/.test(loadersSrc) && /下载 Forge 安装器/.test(loadersSrc));
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  ok('构建流程包含 fetch-loaders', /fetch-loaders\.js/.test(pkg.scripts.dist));

  // ---------- ⑥ 航空学文案（3.0.5）----------
  section('[航空学 · 文案与版本约束]');
  const bundledMods = require('../src/core/bundledMods');
  const aero = bundledMods.BUNDLED_MODS.aeronautics;
  ok('描述里不再出现「祁骥团队」', !/祁骥团队/.test(aero.desc));
  ok('不再说「Forge 装上会加载失败」', !/Forge 装上会加载失败/.test(aero.requires.join('')));
  ok('前置说明写明 Forge / NeoForge 均可', /Forge 或 NeoForge 均可/.test(aero.requires.join('')));
  ok('声明兼容 forge + neoforge',
    Array.isArray(aero.loaders) && aero.loaders.includes('forge') && aero.loaders.includes('neoforge'));
  ok('MC 版本仍限定 1.20.1', aero.mc === '1.20.1');
  ok('渲染层版本下拉按 MC 过滤实例', /mcFromInstance\(i\.name\) === m\.mc/.test(appSrc));
  ok('渲染层支持多加载器标签', /m\.loaders/.test(appSrc));

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  process.exit(failed ? 1 : 0);
})();
