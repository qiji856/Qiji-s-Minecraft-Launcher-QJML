'use strict';
// 预设相关核心逻辑的单测（不依赖网络）
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renameInstance } = require('../src/core/instances');
const { pickLoaderVersion } = require('../src/core/presetRunner');
const { presetSummary, getPreset } = require('../src/core/presets');

let pass = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + ' => ' + e.message); process.exitCode = 1; }
}

console.log('[预设 · 实例重命名]');
test('renameInstance 移动文件夹并改写内部 id', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcl-rn-'));
  const from = path.join(root, 'versions', '1.20.1-forge-X');
  fs.mkdirSync(from, { recursive: true });
  fs.writeFileSync(path.join(from, '1.20.1-forge-X.json'), JSON.stringify({ id: '1.20.1-forge-X', inheritsFrom: '1.20.1' }));
  const ok = renameInstance(root, '1.20.1-forge-X', 'mtr-city-1.20.1');
  assert.strictEqual(ok, true);
  assert.ok(!fs.existsSync(from), '旧文件夹应被移走');
  const toJson = path.join(root, 'versions', 'mtr-city-1.20.1', 'mtr-city-1.20.1.json');
  assert.ok(fs.existsSync(toJson), '新 json 应存在');
  const data = JSON.parse(fs.readFileSync(toJson, 'utf8'));
  assert.strictEqual(data.id, 'mtr-city-1.20.1');
  assert.strictEqual(data.inheritsFrom, '1.20.1');
});
test('renameInstance 目标已存在时不覆盖', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcl-rn2-'));
  fs.mkdirSync(path.join(root, 'versions', 'a'), { recursive: true });
  fs.mkdirSync(path.join(root, 'versions', 'b'), { recursive: true });
  const ok = renameInstance(root, 'a', 'b');
  assert.strictEqual(ok, false);
});

console.log('[预设 · 加载器版本选择]');
test('pickLoaderVersion 优先 recommended', () => {
  const list = [{ value: '1', recommended: false }, { value: '2', recommended: true }];
  assert.strictEqual(pickLoaderVersion(list), '2');
});
test('pickLoaderVersion 无 recommended 取第一个', () => {
  assert.strictEqual(pickLoaderVersion([{ value: '9' }]), '9');
});
test('pickLoaderVersion 空列表返回 null', () => {
  assert.strictEqual(pickLoaderVersion([]), null);
});

console.log('[预设 · 数据]');
test('presetSummary 返回 5 个预设且含关键 id', () => {
  const s = presetSummary();
  assert.strictEqual(s.length, 5);
  const ids = s.map((p) => p.id);
  ['mtr-city', 'create-fan-nf', 'create-aero', 'mtr-322', 'latest'].forEach((id) => assert.ok(ids.includes(id), '缺少预设 ' + id));
});
test('机械动力预设用 NeoForge 且航空学走内置组件', () => {
  const p = getPreset('create-fan-nf');
  assert.ok(p);
  assert.strictEqual(p.loader, 'neoforge', '机械动力预设应为 NeoForge（航空学是 NeoForge 版模组）');
  const aero = p.mods.find((m) => m.customId === 'aeronautics');
  assert.ok(aero, '机械动力预设应包含航空学');
  assert.strictEqual(aero.loader, 'neoforge');
});
test('航空学轻量预设含 Create + 内置航空学', () => {
  const p = getPreset('create-aero');
  assert.ok(p);
  assert.strictEqual(p.loader, 'neoforge');
  assert.strictEqual(p.mc, '1.20.1');
  assert.ok(p.mods.some((m) => m.slug === 'create'));
  assert.ok(p.mods.some((m) => m.customId === 'aeronautics'));
});
test('getPreset 能取到 MTR 预设且含 4.0.5 版本提示', () => {
  const p = getPreset('mtr-city');
  assert.ok(p);
  const mtr = p.mods.find((m) => m.slug === 'minecraft-transit-railway');
  assert.strictEqual(mtr.version, '4.0.5');
});

console.log('结果：' + pass + ' 通过');
