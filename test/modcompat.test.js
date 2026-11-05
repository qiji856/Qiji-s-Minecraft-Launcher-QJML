'use strict';
// 兼容性判定测试：信雅互联（Sinytra Connector）桥接检测、Fabric API 前置、
// 重复模组检测、冲突检测（网站声明的互斥 + 已知冲突表）
const path = require('path');
const fs = require('fs');
const os = require('os');
const AdmZip = require('adm-zip');

const modscan = require('../src/core/modscan');
const compat = require('../src/core/modcompat');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('兼容性判定测试');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modcompat-'));
const modsDir = path.join(tmp, 'mods');
fs.mkdirSync(modsDir, { recursive: true });

function makeJar(file, entries) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.from(content, 'utf8'));
  }
  zip.writeZip(path.join(modsDir, file));
}

// Forge 实例里的「信雅互联」（Sinytra Connector）
makeJar('SinytraConnector-2.0.0.jar', {
  'META-INF/mods.toml': 'modLoader="javafml"\n[[mods]]\nmodId="connector"\nversion="2.0.0"\ndisplayName="Sinytra Connector"\n',
});
// 一个普通 Forge 模组
makeJar('sodium-0.5.0.jar', {
  'META-INF/mods.toml': 'modLoader="javafml"\n[[mods]]\nmodId="sodium"\nversion="0.5.0"\ndisplayName="Sodium"\n',
});

const scan = modscan.scanModsDir(modsDir);

ok('扫描到 2 个模组', scan.mods.length === 2);
ok('识别出信雅互联', !!compat.findBridge(scan));
ok('信雅互联的名字正确', (compat.findBridge(scan) || {}).name === 'Sinytra Connector');

// ---- 信雅互联兜底：jar 解析不出 modId 时，靠文件名也能识别 ----
const tmpBridge = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgefallback-'));
const bdir = path.join(tmpBridge, 'mods');
fs.mkdirSync(bdir, { recursive: true });
// 一个「读不出 modId」的 connector jar（只有清单、没有 mods.toml / fabric.mod.json）
const bzip = new AdmZip();
bzip.addFile('META-INF/MANIFEST.MF', Buffer.from('Manifest-Version: 1.0\n', 'utf8'));
bzip.writeZip(path.join(bdir, 'connector-1.0.0-beta.46+1.20.1.jar'));
const bscan = modscan.scanModsDir(bdir);
ok('兜底场景：解析不出 id 的 connector jar 不进 mods', bscan.mods.filter((m) => m.id).length === 0);
ok('兜底场景：allJars 记录了该 connector jar', bscan.allJars.some((j) => j.relPath.indexOf('connector-1.0.0') >= 0));
ok('兜底场景：findBridge 仍能靠文件名识别信雅互联', !!compat.findBridge(bscan));
try { fs.rmSync(tmpBridge, { recursive: true, force: true }); } catch (_) {}
ok('没装 Fabric API 时 findFabricApi 返回 null', compat.findFabricApi(scan) === null);
ok('hasFabricApi 为 false', compat.hasFabricApi(scan) === false);
ok('isFabricMod 识别 fabric', compat.isFabricMod(['fabric']) === true);
ok('isLoaderAgnosticMod 空加载器列表为 true', compat.isLoaderAgnosticMod([]) === true);

// ---- 重复检测 ----
const dup = compat.findDuplicate(scan, { matchIds: ['sodium'] });
ok('按 modId 找到已安装的同名模组', !!dup && dup.id === 'sodium');
ok('重复项带出版本', !!(dup && dup.version === '0.5.0'));
ok('不存在的模组不误报', compat.findDuplicate(scan, { matchIds: ['jei'] }) === null);
const dupByName = compat.findDuplicate(scan, { matchNames: ['Sinytra Connector'] });
ok('按名称也能找到重复项', !!dupByName && dupByName.id === 'connector');

// ---- 冲突检测：已知冲突表（OPT 与 Sodium） ----
const c1 = compat.detectConflicts({ scan, targetIds: ['optifine'] });
ok('OptiFine 与已装 Sodium 判定为冲突', c1.length === 1);
ok('冲突说明里写明原因', !!(c1[0] && c1[0].why.includes('OptiFine')));
ok('冲突项指向已装的那个模组', !!(c1[0] && c1[0].modId === 'sodium'));

// ---- 冲突检测：网站声明的互斥 ----
const c2 = compat.detectConflicts({
  scan, targetIds: ['sodium'], declared: [{ id: 'sodium', name: 'Sodium' }],
});
ok('网站声明的互斥能被识别', c2.some((x) => x.kind === 'declared' && x.with === 'Sodium'));

// ---- 冲突检测：jar 内部声明的 breaks ----
makeJar('iris-1.6.jar', {
  'fabric.mod.json': JSON.stringify({ schemaVersion: 1, id: 'iris', version: '1.6', name: 'Iris', breaks: { optifine: '*' } }),
});
const scan2 = modscan.scanModsDir(modsDir);
const c3 = compat.detectConflicts({ scan: scan2, targetIds: ['optifine'] });
ok('jar 内声明的互斥（breaks）能被识别', c3.some((x) => x.kind === 'declared'));

// ---- 装了 Fabric API 之后 ----
makeJar('fabric-api-0.90.0.jar', {
  'fabric.mod.json': JSON.stringify({ schemaVersion: 1, id: 'fabric-api', version: '0.90.0', name: 'Fabric API' }),
});
const scan3 = modscan.scanModsDir(modsDir);
ok('装上 fabric-api 后能识别到', !!compat.findFabricApi(scan3));
ok('hasFabricApi 变为 true', compat.hasFabricApi(scan3) === true);
ok('forge 侧的 forgified-fabric-api 也认', (() => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'modcompat2-'));
  const d = path.join(t, 'mods'); fs.mkdirSync(d, { recursive: true });
  const zip = new AdmZip();
  zip.addFile('META-INF/mods.toml', Buffer.from('modLoader="javafml"\n[[mods]]\nmodId="forgified-fabric-api"\nversion="0.1.0"\n', 'utf8'));
  zip.writeZip(path.join(d, 'forgified-fabric-api-0.1.0.jar'));
  const s = modscan.scanModsDir(d);
  const r = compat.hasFabricApi(s);
  try { fs.rmSync(t, { recursive: true, force: true }); } catch (_) {}
  return r;
})());

// ---- 版本比较 ----
ok('版本比较 1.0 < 2.0', compat.compareVersions('1.0', '2.0') === -1);
ok('版本比较 4.0.5 == 4.0.5', compat.compareVersions('4.0.5', '4.0.5') === 0);
ok('版本比较 4.0.5 > 4.0.3', compat.compareVersions('4.0.5', '4.0.3') === 1);

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
