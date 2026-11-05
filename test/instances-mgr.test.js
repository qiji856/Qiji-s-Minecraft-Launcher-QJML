'use strict';
/* 实例管理（3.0.5 修复）的回归测试：
 *   ① 选中实例后不能「弹回」——早先用 const 快照导致点别的实例时高亮不动
 *   ② 新式周快照（26w14a）要能认出属于哪个正式版
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const os = require('os');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}
function section(t) { console.log('\n' + t); }

const inst = require('../src/core/instances');

// ---------- 造一个假的 .minecraft 目录 ----------
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qjml-inst-'));
function makeVersion(id, extra) {
  const dir = path.join(tmpRoot, 'versions', id);
  fs.mkdirSync(dir, { recursive: true });
  const data = Object.assign({ id, type: 'release', assets: '1' }, extra || {});
  fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(data), 'utf8');
}

section('[实例 · 周快照版本识别]');
// 造一份最小 manifest：26w14a 是 26.1.1 同一天发布的周快照
makeVersion('26w14a', { type: 'snapshot' });
makeVersion('26.1.1', { type: 'release' });
makeVersion('1.20.1', { type: 'release' });
fs.writeFileSync(path.join(tmpRoot, 'versions', 'version_manifest_v2.json'), JSON.stringify({
  latest: { release: '26.1.1', snapshot: '26w14a' },
  versions: [
    { id: '26.1', type: 'release', releaseTime: '2026-03-24T12:11:04+00:00' },
    { id: '26.1.1', type: 'release', releaseTime: '2026-04-01T09:06:36+00:00' },
    { id: '26w14a', type: 'snapshot', releaseTime: '2026-04-01T12:13:30+00:00' },
    { id: '26.2', type: 'release', releaseTime: '2026-06-16T00:00:00+00:00' },
  ],
}), 'utf8');

ok('普通版本直接认出（1.20.1）', inst.mcVersionOfInstance(tmpRoot, '1.20.1') === '1.20.1');
// 同日有正式版 → 取它的主版本号（26.1.1 → 26.1）
ok('周快照能反推出正式版（26w14a → 26.1）', inst.mcVersionOfInstance(tmpRoot, '26w14a') === '26.1');

section('[实例 · 扫描结果含 MC 版本]');
const list = inst.scanInstances(tmpRoot);
ok('扫描到 3 个实例', list.length === 3);
const w14 = list.find((i) => i.name === '26w14a');
ok('扫描结果里 26w14a 的 mc 字段已填上 26.1', w14 && w14.mc === '26.1');

// 同日没有正式版时 → 取「之后最近的那个正式版」
makeVersion('26w20a', { type: 'snapshot' });
fs.writeFileSync(path.join(tmpRoot, 'versions', 'version_manifest_v2.json'), JSON.stringify({
  versions: [
    { id: '26.1', type: 'release', releaseTime: '2026-03-24T00:00:00+00:00' },
    { id: '26.2', type: 'release', releaseTime: '2026-06-16T00:00:00+00:00' },
    { id: '26w20a', type: 'snapshot', releaseTime: '2026-05-15T00:00:00+00:00' },
  ],
}), 'utf8');
ok('同日无正式版时取之后最近的正式版（26w20a → 26.2）',
  inst.mcVersionOfInstance(tmpRoot, '26w20a') === '26.2');

// 没有 manifest 时不应抛异常
ok('没有 manifest 时安全返回 null',
  inst.mcVersionOfInstance(path.join(tmpRoot, 'nonexistent'), '26w14a') === null);

section('[实例管理 · 选中不弹回]');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
// 关键：实例管理里不能再有「页面加载时算一次的 sel 快照」
// （早先是 const sel = (state.instMgrSel && ...) ? ... : state.instances[0].name）
const start = appSrc.indexOf('async function renderInstanceManager()');
ok('能找到实例管理函数', start > 0);
const instMgrBlock = appSrc.slice(start);
ok('实例管理定义了 currentSel()（实时取当前选中项）', /const currentSel = \(\) =>/.test(instMgrBlock));
ok('不再有「从 state.instMgrSel 算一次」的快照写法',
  !/const sel = \(state\.instMgrSel/.test(instMgrBlock));
ok('列表按 currentSel() 取值', /const sel = currentSel\(\);/.test(instMgrBlock));
ok('详情按 currentSel() 取值', /find\(\(i\) => i\.name === currentSel\(\)\)/.test(instMgrBlock));

try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
