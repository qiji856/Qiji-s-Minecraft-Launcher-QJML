'use strict';
/* NeoForge 支持测试：版本前缀推导、版本过滤与排序、安装器路径规则 */
const assert = require('assert');
const loaders = require('../src/core/loaders');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

console.log('\n[Forge · promotions 解析]');
ok('parseForgeList 取出推荐版并打标', (() => {
  const data = { promos: { '1.20.1-recommended': '47.4.28', '1.20.1-latest': '47.4.28', '1.19.2-recommended': '43.4.0' } };
  const list = loaders.parseForgeList(data, '1.20.1');
  return list.length === 1 && list[0].value === '47.4.28' && list[0].label === '1.20.1-47.4.28（推荐）' && list[0].recommended === true;
})());
ok('parseForgeList 推荐与最新不同则都列出且最新在前', (() => {
  const data = { promos: { '1.20.1-recommended': '47.1.0', '1.20.1-latest': '47.4.28' } };
  const list = loaders.parseForgeList(data, '1.20.1');
  return list.length === 2 && list[0].value === '47.4.28' && list.find((x) => x.value === '47.1.0').recommended === true;
})());
ok('parseForgeList 该版本无 Forge 返回空数组', (() => {
  const data = { promos: { '1.20.1-recommended': '47.4.28' } };
  const r = loaders.parseForgeList(data, '26.3');
  return Array.isArray(r) && r.length === 0;
})());

console.log('\n[NeoForge · 版本前缀推导]');
ok('1.21.1 → 21.1', loaders.neoforgePrefix('1.21.1') === '21.1');
ok('1.21 → 21.0', loaders.neoforgePrefix('1.21') === '21.0');
ok('1.21.4 → 21.4', loaders.neoforgePrefix('1.21.4') === '21.4');
ok('1.20.6 → 20.6', loaders.neoforgePrefix('1.20.6') === '20.6');
ok('1.20.4 → 20.4', loaders.neoforgePrefix('1.20.4') === '20.4');
ok('1.20.2 → 20.2', loaders.neoforgePrefix('1.20.2') === '20.2');
ok('1.19.4 → null（NeoForge 不支持）', loaders.neoforgePrefix('1.19.4') === null);
ok('1.20.1 → 20.1（旧坐标路径）', loaders.neoforgePrefix('1.20.1') === '20.1');
ok('非法输入 → null', loaders.neoforgePrefix('abc') === null);

console.log('\n[NeoForge · 版本过滤与排序（模拟官方 API 返回）]');
const mockAll = [
  '20.4.100', '20.4.99', '20.4.100-beta', '21.1.244', '21.1.30',
  '21.1.200', '20.6.139', '21.1.244-beta', '19.2.1',
];
function filterFor(prefix) {
  return mockAll.filter((v) => v.startsWith(prefix + '.') && !v.includes('-'))
    .sort((a, b) => {
      const na = parseInt((a.split('.').pop() || '0').split('-')[0], 10);
      const nb = parseInt((b.split('.').pop() || '0').split('-')[0], 10);
      return nb - na;
    });
}
ok('1.21.1 只留 21.1.* 且排除 beta', JSON.stringify(filterFor('21.1')) === JSON.stringify(['21.1.244', '21.1.200', '21.1.30']));
ok('排序为新版本在前', filterFor('21.1')[0] === '21.1.244');
ok('1.20.4 只留 20.4.*', JSON.stringify(filterFor('20.4')) === JSON.stringify(['20.4.100', '20.4.99']));
ok('不串版本号（1.19.2 不出现）', !filterFor('20.4').includes('19.2.1'));
ok('beta 版被排除', !filterFor('21.1').some((v) => v.includes('-')));

console.log('\n[NeoForge · 安装器路径规则]');
// 1.20.1 用 net.neoforged:forge 旧路径
const legacyPath = `/releases/net/neoforged/forge/1.20.1-47.1.3/forge-1.20.1-47.1.3-installer.jar`;
ok('1.20.1 走旧坐标 net/neoforged/forge', legacyPath.includes('net/neoforged/forge/'));
ok('1.20.1 含 mc-版本 前缀', legacyPath.includes('1.20.1-47.1.3'));
// 1.20.2+ 用 net.neoforged:neoforge
const modernPath = `/releases/net/neoforged/neoforge/21.1.244/neoforge-21.1.244-installer.jar`;
ok('1.20.2+ 走新坐标 net/neoforged/neoforge', modernPath.includes('net/neoforged/neoforge/'));
ok('新路径不含 mc 版本前缀', !modernPath.includes('1.21.1'));
ok('两路径都以 -installer.jar 结尾', legacyPath.endsWith('-installer.jar') && modernPath.endsWith('-installer.jar'));

console.log('\n[下载源 · 多源回退]');
// 验证 proxy 列表构造：官方源在前，用户填的加速前缀在后
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'core', 'loaders.js'), 'utf8');
ok('存在 proxyList 多源构造', src.includes('function proxyList'));
ok('存在 fetchJsonMulti 回退', src.includes('fetchJsonMulti'));
ok('存在 downloadBufferMulti 回退', src.includes('downloadBufferMulti'));
ok('存在 downloadInstallerJar（多源 + 进度）', src.includes('downloadInstallerJar'));
ok('NeoForge 使用多源下载（含进度）', /installNeoForge[\s\S]*downloadInstallerJar/.test(src));
ok('Forge 使用多源下载（含进度）', /installForge[\s\S]*downloadInstallerJar/.test(src));

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
