'use strict';
/* 模组安装向导测试：实例 → 加载器 → 版本 → 前置 的级联流程 + 自动推荐逻辑
 *
 * 用法上的关键点：向导渲染时会 openModal() 往 #modalBody 里塞 HTML，
 * 测试用一个「极简 DOM」把每次渲染的 HTML 抓下来做断言；
 * 同时给按钮加一个可触发的 click 模拟，好把流程一步步走下去。
 */
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

const noop = () => {};
const handlers = new Map();   // id -> { click: [fn] }
let lastBody = '';            // 最近一次渲染进 #modalBody 的 HTML

function fakeEl(id) {
  return {
    id: id || '',
    innerHTML: '', textContent: '', value: '', hidden: false, disabled: false,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    style: { cssText: '', display: '' }, dataset: {}, checked: false, files: [],
    addEventListener(ev, fn) {
      if (!id) return;
      const h = handlers.get(id) || {};
      handlers.set(id, h);
      (h[ev] = h[ev] || []).push(fn);
    },
    appendChild: noop, removeChild: noop, removeEventListener: noop,
    querySelector: () => null, querySelectorAll: () => [],
    getAttribute: () => null, setAttribute: noop, click: noop, focus: noop,
    scrollIntoView: noop, remove: noop,
  };
}

const elements = new Map();
function byId(id) {
  if (!elements.has(id)) elements.set(id, fakeEl(id));
  return elements.get(id);
}
// 模拟「重新渲染 = 旧 DOM 被替换」：清掉所有事件绑定
byId('modalBody').innerHTML = '';
Object.defineProperty(byId('modalBody'), 'innerHTML', {
  get() { return lastBody; },
  set(v) { lastBody = String(v); handlers.clear(); },
});

const INSTANCES = [
  { name: '1.20.1', mc: '1.20.1', loader: 'forge' },
  { name: '1.19.2', mc: '1.19.2', loader: '' },
];

const VERSIONS = [
  { id: 'v1', version_number: '1.0.0', game_versions: ['1.20.1'], loaders: ['forge'],
    date_published: '2024-05-01', files: [{ filename: 'mod-1.0.0.jar', primary: true, url: 'u1' }] },
  { id: 'v2', version_number: '0.9.0', game_versions: ['1.20.1'], loaders: ['fabric'],
    date_published: '2024-04-01', files: [{ filename: 'mod-0.9.0.jar', primary: true, url: 'u2' }] },
  { id: 'v3', version_number: '2.0.0', game_versions: ['1.19.2'], loaders: ['fabric'],
    date_published: '2024-06-01', files: [{ filename: 'mod-2.0.0.jar', primary: true, url: 'u3' }] },
];

global.window = {
  api: {
    isDemo: true,
    configGet: async () => ({ theme: 'light', simpleHome: false, activeAccount: 'Player' }),
    configSet: async () => ({}),
    listInstances: async () => INSTANCES,
    listPacks: async () => [],
    vanillaVersions: async () => ['1.20.1', '1.19.2'],
    presetList: async () => [],
    zhNames: async () => ({}),
    zhDict: async () => ({}),
    appInfo: async () => ({ dataDir: 'D:/tmp' }),
    modrinthVersions: async () => VERSIONS,
    modrinthResolve: async () => [],
    modrinthFabricApi: async () => ({
      projectId: 'fabric-api', versionId: 'f1', fileUrl: 'fu', fileName: 'fabric-api-1.jar', versionNumber: '0.90.0',
    }),
    compatCheck: async () => ({ mods: [], bridge: null, fabricApi: null, dup: null, conflicts: [] }),
    modsRemove: async () => ({ removed: 'x.jar' }),
    onLaunchLog: noop, onLaunchClose: noop, onLaunchError: noop,
    onConvertStep: noop, onLoaderProgress: noop, onJavaProgress: noop, onVanillaProgress: noop,
  },
  addEventListener: noop,
  setTimeout, clearTimeout,
};
global.document = {
  body: { classList: { add: noop, remove: noop, toggle: noop, contains: () => false } },
  querySelector: (sel) => (sel.startsWith('#') ? byId(sel.slice(1)) : fakeEl('')),
  querySelectorAll: () => [],
  getElementById: (id) => byId(id),
  createElement: () => fakeEl(''),
};
global.localStorage = { getItem: () => null, setItem: noop };
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
const patched = appSrc.replace(
  /function setMain\(html\) \{[\s\S]*?\n\}/,
  'function setMain(html) { globalThis.__captured = html; }'
).replace(
  'init();',
  'globalThis.state = state; globalThis.openInstallModal = openInstallModal; init();'
);
if (patched === appSrc) { console.error('注入失败'); process.exit(1); }

const vm = require('vm');
const sandbox = Object.assign({}, global, { window: global.window, document: global.document, console, setTimeout, clearTimeout, localStorage: global.localStorage });
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(patched, sandbox);

// 触发某个按钮的 click 回调
function fire(id, ev = 'click') {
  const h = handlers.get(id) || {};
  const list = h[ev] || [];
  for (const fn of list) fn({ target: byId(id) });
  return list.length;
}

setTimeout(async () => {
  console.log('\n[模组安装向导 · 级联流程]');
  const inst = INSTANCES[0];
  sandbox.state.instances = INSTANCES;
  sandbox.state.launchInstance = inst.name;

  // ---- 第 1 步：选实例 ----
  await sandbox.openInstallModal('sodium', 'mod');
  ok('第 1 步标题是「装到哪个实例？」', lastBody.includes('装到哪个实例？'));
  ok('显示步数 第 1 步 / 共 4 步', lastBody.includes('第 1 步 / 共 4 步'));
  ok('列出了两个实例', lastBody.includes('data-inst="1.20.1"') && lastBody.includes('data-inst="1.19.2"'));
  ok('实例卡片带 MC 版本与加载器', lastBody.includes('MC 1.20.1 · Forge'));
  ok('当前实例被标为推荐', lastBody.includes('推荐'));
  ok('有「新建一个实例」入口', lastBody.includes('新建一个实例'));

  // ---- 第 2 步：选加载器 ----
  const n1 = fire('mwNext');
  ok('第 1 步的下一步按钮已绑定', n1 > 0);
  ok('第 2 步标题是「用哪个加载器？」', lastBody.includes('用哪个加载器？'));
  ok('第 2 步说明了当前实例的加载器', lastBody.includes('当前是'));
  ok('推荐标签跟随实例加载器（Forge）', lastBody.includes('data-loader="forge"') && lastBody.includes('推荐'));
  ok('也列出了其它可选加载器（Fabric）', lastBody.includes('data-loader="fabric"'));

  // ---- 第 3 步：选版本 ----
  fire('mwNext');
  ok('第 3 步标题是「选哪个版本？」', lastBody.includes('选哪个版本？'));
  const verList = byId('mwVerList').innerHTML;
  ok('只列该 MC + 加载器的版本', verList.includes('1.0.0') && !verList.includes('0.9.0'));
  ok('版本卡片带发布日期', /2024/.test(verList));

  // ---- 简洁模式：直接进最后一步 ----
  console.log('\n[简洁模式]');
  sandbox.state.config.simpleHome = true;
  lastBody = '';
  await sandbox.openInstallModal('sodium', 'mod');
  ok('简洁模式直接进入「前置与确认」', lastBody.includes('前置与确认'));
  const subHtml = byId('mwSub').innerHTML;
  ok('并说明已自动选好实例/加载器/版本', subHtml.includes('已自动选择'));
  ok('给出切回完整流程的入口', subHtml.includes('改用完整流程'));

  console.log('\n结果：' + passed + ' 通过，' + failed + ' 失败');
  process.exit(failed ? 1 : 0);
}, 120);
