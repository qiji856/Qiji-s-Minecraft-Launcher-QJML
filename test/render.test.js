'use strict';
/* 渲染层结构验证：直接调用 app.js 里的渲染函数，捕获 setMain 写入的 HTML，
 * 校验关键元素是否存在（不依赖 jsdom，纯字符串断言）
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

// 构造最小 DOM 环境，让 app.js 能在 node 里加载
const captured = { main: '' };
const noop = () => {};
const fakeEl = () => ({
  innerHTML: '', textContent: '', value: '', hidden: true, disabled: false,
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  style: {}, dataset: {}, checked: false,
  addEventListener: noop, appendChild: noop, removeEventListener: noop,
  querySelector: () => null, querySelectorAll: () => [],
  getAttribute: () => null, setAttribute: noop, click: noop, focus: noop,
});

const elements = {};
function byId(id) {
  if (elements[id]) return elements[id];
  const el = {
    textContent: '', value: '', hidden: true, disabled: false,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    style: {}, dataset: {}, checked: false, _html: '',
    addEventListener: noop, appendChild: noop, removeEventListener: noop,
    querySelector: () => null, querySelectorAll: () => [],
    getAttribute: () => null, setAttribute: noop, click: noop, focus: noop,
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = String(v); },
  });
  elements[id] = el;
  return el;
}

global.window = {
  api: {
    isDemo: true,
    configGet: async () => ({ theme: 'light', simpleHome: false, activeAccount: 'Player', accounts: [] }),    configSet: async () => ({}),
    listInstances: async () => [],
    listPacks: async () => [],
    vanillaVersions: async () => ['1.21.1', '1.20.1', '1.12.2'],
    loaderVersions: async () => ([
      { value: '47.4.28', label: '1.20.1-47.4.28（推荐·适配当前版本）', recommended: true, latest: false },
      { value: '47.4.30', label: '1.20.1-47.4.30（最新版）', recommended: false, latest: true },
      { value: '47.1.0', label: '1.20.1-47.1.0', recommended: false, latest: false },
    ]),
    loaderInstall: async () => ({ versionId: '1.20.1-forge-47.4.28' }),
    vanillaInstall: async () => ({ versionId: '1.20.1' }),
    onLaunchLog: noop, onLaunchClose: noop, onLaunchError: noop,
    onConvertStep: noop, onLoaderProgress: noop, onJavaProgress: noop,
    modrinthSearch: async () => ({ hits: [], total_hits: 0 }),
    modrinthVersions: async () => [],
  },
  addEventListener: noop,
  setTimeout, clearTimeout,
};
// 配色模块（UMD）：真实渲染层会先加载它，测试里也照做，避免测的是兜底分支
global.window.QJMLTheme = require(path.join(__dirname, '..', 'src', 'core', 'theme.js'));

global.document = {
  body: { classList: { add: noop, remove: noop, toggle: noop, contains: () => false } },
  querySelector: (sel) => {
    if (sel.startsWith('#')) return byId(sel.slice(1));
    return fakeEl();
  },
  querySelectorAll: () => [],
  getElementById: (id) => byId(id),
  createElement: () => fakeEl(),
};
global.localStorage = { getItem: () => null, setItem: noop };
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
// 注入 HTML 捕获：替换 setMain 的实现；同时把内部 state 暴露到 globalThis 便于测试驱动
const patched = appSrc.replace(
  /function setMain\(html\) \{[\s\S]*?\n\}/,
  "function setMain(html) { globalThis.__captured = html; }"
).replace(
  "init();",
  "globalThis.state = state; globalThis.renderHomeDash = renderHomeDash; globalThis.renderDownload = renderDownload; globalThis.renderConvert = renderConvert; globalThis.renderSettings = renderSettings; globalThis.renderLoader = renderLoader; globalThis.renderVanilla = renderVanilla; globalThis.loaderVersionOptions = loaderVersionOptions; globalThis.compactLoaderVersions = compactLoaderVersions; globalThis.setSide = setSide; globalThis.setTop = setTop; init();"
);
assert.ok(patched !== appSrc, 'setMain 注入失败');

// 用 vm 跑，取出内部函数
const vm = require('vm');
const sandbox = Object.assign({}, global, { window: global.window, document: global.document, console, setTimeout, clearTimeout, localStorage: global.localStorage });
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(patched, sandbox);

console.log('\n[首页 · 板块化结构]');
// 等 init() 的异步部分完成（config 载入）
setTimeout(() => runAssertions(), 60);

function runAssertions() {
sandbox.renderHomeDash();
let html = sandbox.globalThis.__captured || '';
ok('渲染出启动游戏大板块', html.includes('tile-launch'));
ok('启动按钮存在', html.includes('btnLaunch'));
ok('测试游戏按钮存在', html.includes('btnTest'));
ok('账户板块存在', html.includes('data-go="account"'));
ok('皮肤/下载/管理/加载器板块齐全',
  html.includes('data-go="skin"') && html.includes('data-go="download"') &&
  html.includes('data-go="manage"') && html.includes('data-go="loaders"'));
ok('完整/简洁分段控件存在', html.includes('modeSeg') && html.includes('data-mode="simple"') && html.includes('data-mode="full"'));
ok('不再使用旧的 simple-toggle（避免全屏大圆）', !html.includes('simple-toggle'));
ok('不再使用无定位祖先的 slider（避免全屏大圆）', !html.includes('class="slider"'));

console.log('\n[首页 · 简洁模式]');
sandbox.state.config.simpleHome = true;
sandbox.renderHomeDash();
html = sandbox.globalThis.__captured || '';
ok('简洁模式：tiles 带 simple 类', html.includes('tiles simple'));
ok('简洁模式：保留启动游戏板块', html.includes('tile-launch'));
ok('简洁模式：不再显示账户板块（新手不被账户吓退）', !html.includes('data-go="account"'));
ok('简洁模式：隐藏皮肤/下载/管理/加载器',
  !html.includes('data-go="skin"') && !html.includes('data-go="download"') &&
  !html.includes('data-go="manage"') && !html.includes('data-go="loaders"'));

console.log('\n[下载页 · 结构]');
sandbox.state.config.simpleHome = false;
sandbox.state.top = 'download';
sandbox.state.downloadType = 'mod';
sandbox.state.search.results = [];
sandbox.renderDownload();
html = sandbox.globalThis.__captured || '';
ok('搜索框存在', html.includes('id="q"'));
ok('版本下拉存在', html.includes('id="mc"'));
ok('结果显示区存在', html.includes('id="results"'));
ok('有命中统计信息位', html.includes('id="searchInfo"'));
// 子容器 #results 的内容通过 DOM 桩读取
const resultsHtml = () => byId('results').innerHTML;
ok('进入下载页即自动加载热门（不必点搜索）', /正在加载热门|搜索中/.test(resultsHtml()));

console.log('\n[下载页 · 结果卡片]');
sandbox.state.search.results = [{
  project_id: 'sodium', title: 'Sodium', author: 'CaffeineMC',
  description: 'Modern rendering engine', downloads: 1234567,
  versions: ['1.0.0', '2.0.0'],            // 模组自身版本（不该显示为游戏版本）
  game_versions: ['1.20.1', '1.21.1'],      // 游戏版本（应显示）
  display_categories: ['optimization'],
}];
sandbox.state.search.total = 1;
sandbox.renderDownload();
html = sandbox.globalThis.__captured || '';
const res2 = resultsHtml();
ok('显示游戏版本而非模组版本号', res2.includes('1.20.1') && !res2.includes('🏷 1.0.0'));
ok('安装按钮存在', res2.includes('data-install="sodium"'));
ok('结果统计写入 searchInfo', byId('searchInfo').textContent.length > 0);

console.log('\n[高级 · 模组版本转换]');
sandbox.state.top = 'advanced';
sandbox.state.side = 'convert';
sandbox.renderConvert();
html = sandbox.globalThis.__captured || '';
ok('本地/在线双模式分段控件', html.includes('convModeSeg') && html.includes('data-mode="online"'));
ok('本地模式含拖放区', byId('convBody').innerHTML.includes('dropzone'));
sandbox.state.convertMode = 'online';
sandbox.renderConvert();
html = sandbox.globalThis.__captured || '';
const convHtml = byId('convBody').innerHTML;
ok('在线模式含搜索框', convHtml.includes('id="ocQ"'));
ok('在线模式含版本下拉', convHtml.includes('id="ocMc"'));
ok('在线模式含目标版本与实例选择', convHtml.includes('id="ocTarget"') && convHtml.includes('id="ocInst"'));

console.log('\n[设置页]');
sandbox.state.side = 'settings';
sandbox.renderSettings();
html = sandbox.globalThis.__captured || '';
ok('配色方案选择器存在', html.includes('id="schemePicker"'));
ok('配色方案：白色/黑色/中国红/爱马仕橙/草原绿/自定义 齐全',
  ['white', 'black', 'cn-red', 'hermes-orange', 'prairie-green', 'custom']
    .every((id) => html.includes('data-scheme="' + id + '"')));
ok('自定义 RGB 调色盘存在', html.includes('id="cpR"') && html.includes('id="cpG"') && html.includes('id="cpB"'));
ok('首页布局分段控件存在', html.includes('homeLayoutSeg'));
ok('简洁选项文字正确', html.includes('简洁（仅启动游戏）'));

console.log('\n[下载页 · 加载器（版本下拉 + 完整版本）]');
sandbox.state.top = 'download';
sandbox.state.side = 'loader';
sandbox.renderLoader();
html = sandbox.globalThis.__captured || '';
ok('目标实例下拉存在', html.includes('id="ldInst"'));
ok('加载器版本下拉存在', html.includes('id="ldVer"'));
ok('完整版本开关存在', html.includes('id="ldFull"'));
ok('版本下拉带小箭头 ▾ 提示', html.includes('▾'));
ok('说明强调按真实版本文件读取实例', html.includes('实例的真实游戏版本会从版本文件中读取'));

console.log('\n[下载页 · 原版游戏（分类 + 级联安装）]');
sandbox.state.side = 'vanilla';
sandbox.renderVanilla();
html = sandbox.globalThis.__captured || '';
ok('版本分类区存在', html.includes('id="vanCats"'));
ok('版本列表区存在', html.includes('id="vanList"'));
ok('右侧说明区存在', html.includes('id="vanSide"'));
// 分类是异步取到版本列表后才渲染的，这里直接校验源码里的分类定义
ok('分类包含正式版 / 快照版 / 远古版 / 整合包',
  /label: '正式版'/.test(appSrc) && /label: '快照版'/.test(appSrc) &&
  /label: '远古版'/.test(appSrc) && /label: '导入整合包'/.test(appSrc));

console.log('\n[版本下拉 · 选项渲染与精简过滤]');
const sample = [
  { value: '47.4.28', label: '1.20.1-47.4.28（推荐·适配当前版本）', recommended: true, latest: false },
  { value: '47.4.30', label: '1.20.1-47.4.30（最新版）', recommended: false, latest: true },
  { value: '47.1.0', label: '1.20.1-47.1.0', recommended: false, latest: false },
];
sandbox.state.fullVersions = true;
const fullOpts = sandbox.loaderVersionOptions(sample);
ok('完整版本：渲染全部 3 个', (fullOpts.match(/<option/g) || []).length === 3);
ok('完整版本：推荐版被默认选中', fullOpts.includes('selected') && fullOpts.indexOf('selected') < fullOpts.indexOf('47.4.30'));
sandbox.state.fullVersions = false;
const compact = sandbox.compactLoaderVersions(sample);
ok('精简：只保留推荐 + 最新两条', compact.length === 2 && compact.every((v) => v.recommended || v.latest));
const compactOpts = sandbox.loaderVersionOptions(sample);
ok('精简：渲染 2 个选项', (compactOpts.match(/<option/g) || []).length === 2);

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
}
