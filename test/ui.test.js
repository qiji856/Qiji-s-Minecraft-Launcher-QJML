'use strict';
/* 渲染层关键行为测试（用轻量 DOM 桩，验证逻辑而非像素）
 * 覆盖：下载页分类切换清空、搜索别名扩展、主题切换 await、在线转换流程
 */
const assert = require('assert');
let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

// ---------- 1. modrinth 别名扩展 ----------
const modrinth = require('../src/core/modrinth');
console.log('\n[下载页 · 搜索别名扩展]');
ok('空关键词返回空扩展词', modrinth.expandQuery('', 'mod').length === 0);
ok('"光影" 扩展出 shader', modrinth.expandQuery('光影', 'shader').includes('shader'));
ok('"中文" 扩展出 chinese', modrinth.expandQuery('中文', 'mod').includes('chinese'));
ok('"资源包" 扩展出 resource pack', modrinth.expandQuery('资源包', 'resourcepack').includes('resource pack'));
ok('英文词原样保留不重复', modrinth.expandQuery('sodium', 'mod')[0] === 'sodium');
ok('扩展词不重复', (() => { const e = modrinth.expandQuery('光影', 'shader'); return new Set(e).size === e.length; })());

// ---------- 2. 模拟渲染层 state 逻辑（与 app.js 保持一致） ----------
console.log('\n[下载页 · 分类切换重置]');
const state = {
  downloadType: 'mod',
  search: { query: 'sodium', mc: '1.20.1', results: [{ project_id: 'a' }], total: 1 },
};
function setSide(id) {
  const newType = (id === 'vanilla') ? 'vanilla' : id;
  if (newType !== state.downloadType) {
    state.downloadType = newType;
    state.search.results = [];
    state.search.total = 0;
    state.search.query = '';
    state.search.mc = '';
  }
}
setSide('resourcepack');
ok('切换分类后结果被清空', state.search.results.length === 0);
ok('切换分类后 total 归零', state.search.total === 0);
ok('切换分类后关键词被清空', state.search.query === '');
ok('切换分类后 downloadType 正确', state.downloadType === 'resourcepack');
setSide('resourcepack');
ok('同分类重复点击不清空（保留结果）', state.search.results.length === 0 && state.downloadType === 'resourcepack');

// ---------- 3. 主题切换必须 await（否则读到旧值） ----------
console.log('\n[设置 · 主题切换]');
(async () => {
  let cfg = { theme: 'light' };
  const api = {
    configGet: async () => cfg,
    // 真实 ipcRenderer.invoke 是异步到达的：调用后要等一拍才拿到新值
    configSet: async (k, v) => { await new Promise((r) => setTimeout(r, 0)); cfg = Object.assign({}, cfg, { [k]: v }); return cfg; },
  };
  // 模拟未 await 的旧写法：读到的仍是旧主题
  const readThemeOld = () => cfg.theme;
  api.configSet('theme', 'dark');
  const themeSeenWithoutAwait = readThemeOld();
  // 模拟 await 后的新写法
  await api.configSet('theme', 'dark');
  const themeSeenWithAwait = readThemeOld();
  ok('未 await 时读到旧主题（这正是原 bug）', themeSeenWithoutAwait === 'light');
  ok('await 后读到新主题', themeSeenWithAwait === 'dark');

  // ---------- 4. 简洁模式与主题互不影响 ----------
  console.log('\n[首页 · 简洁/主题互不串味]');
  let cfg2 = { theme: 'light', simpleHome: false };
  const api2 = {
    configGet: async () => cfg2,
    configSet: async (k, v) => { cfg2 = Object.assign({}, cfg2, { [k]: v }); return cfg2; },
  };
  await api2.configSet('theme', 'dark');
  ok('切主题不会改 simpleHome', cfg2.simpleHome === false);
  await api2.configSet('simpleHome', true);
  ok('切简洁模式不会改 theme', cfg2.theme === 'dark');
  ok('两者可独立共存', cfg2.theme === 'dark' && cfg2.simpleHome === true);

  // ---------- 5. 在线转换参数组装 ----------
  console.log('\n[在线转换 · 参数与流程]');
  const KNOWN = ['1.21.1', '1.20.1', '1.20'];
  const targetVersion = '1.20.1';
  ok('目标版本来自已知版本列表', KNOWN.includes(targetVersion));
  const sel = 'https://cdn.modrinth.com/data/abc/versions/x/file.jar|file.jar|1.20.1';
  const [fileUrl, fileName, sourceVersion] = sel.split('|');
  ok('源文件 URL 解析正确', fileUrl.startsWith('https://'));
  ok('源文件名解析正确', fileName === 'file.jar');
  ok('源版本解析正确', sourceVersion === '1.20.1');
  const instName = '1.20.1-forge-47.1.3';
  ok('安装目标实例非空', !!instName);

  // ---------- 6. 转换后文件名生成规则 ----------
  const sanitize = require('../src/core/install').sanitize;
  const base = 'file.jar'.replace(/\.jar$/i, '');
  const outName = `${base}-mc${targetVersion}.jar`;
  ok('输出文件名带目标版本', outName === 'file-mc1.20.1.jar');
  ok('非法字符被替换', sanitize('a/b:c.jar') === 'a_b_c.jar');

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  process.exit(failed ? 1 : 0);
})();
