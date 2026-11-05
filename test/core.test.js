'use strict';
// 核心逻辑本地测试（无需 Electron / 无需 GUI）
// 运行：node test/core.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const { scanInstances, listPacks, togglePack } = require('../src/core/instances');
const { packDir } = require('../src/core/paths');
const { Config, detectGameDirectory } = require('../src/core/config');
const convert = require('../src/core/convert');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.error('  ✗', name); } }

// 构造临时 .minecraft
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qjml-test-'));
function mkInstance(name, withJar) {
  const dir = path.join(root, 'versions', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name + '.json'), '{}');
  if (withJar) fs.writeFileSync(path.join(dir, name + '.jar'), '');
}

console.log('\n[1] 实例扫描 + 隔离路径');
mkInstance('1.20.1-forge-47.1.3', true);
mkInstance('1.21.1-fabric', true);
const insts = scanInstances(root);
ok('扫描到 2 个实例', insts.length === 2);
ok('实例含 client jar 标记', insts.every((i) => i.hasClientJar));

const isoMods = packDir(root, '1.20.1-forge-47.1.3', 'mod', true);
const flatMods = packDir(root, '1.20.1-forge-47.1.3', 'mod', false);
ok('隔离时 mods 在 versions/<v>/mods', isoMods.endsWith(path.join('versions', '1.20.1-forge-47.1.3', 'mods')));
ok('非隔离时 mods 在根 mods', flatMods.endsWith('mods') && !flatMods.includes('versions'));

console.log('\n[2] 资源列举 + 启用/禁用');
const modDir = packDir(root, '1.20.1-forge-47.1.3', 'mod', true);
fs.mkdirSync(modDir, { recursive: true });
fs.writeFileSync(path.join(modDir, 'jei.jar'), '');
fs.writeFileSync(path.join(modDir, 'create.jar'), '');
let packs = listPacks(root, '1.20.1-forge-47.1.3', 'mod', true);
ok('列举到 2 个 mod', packs.length === 2);
togglePack(root, '1.20.1-forge-47.1.3', 'mod', true, 'jei.jar', false);
packs = listPacks(root, '1.20.1-forge-47.1.3', 'mod', true);
const jei = packs.find((p) => p.name === 'jei.jar');
ok('禁用后 isDisabled=true', jei && jei.disabled === true);
togglePack(root, '1.20.1-forge-47.1.3', 'mod', true, 'jei.jar.disabled', true);
packs = listPacks(root, '1.20.1-forge-47.1.3', 'mod', true);
ok('重新启用后 isDisabled=false', packs.find((p) => p.name === 'jei.jar').disabled === false);

console.log('\n[3] 配置默认路径探测');
const cfg = new Config(path.join(root, 'cfg.json'));
cfg.load(root);
ok('默认 gameDirectory 以 .minecraft 结尾且非空', typeof cfg.get('gameDirectory') === 'string' && cfg.get('gameDirectory').endsWith('.minecraft'));
ok('默认版本隔离开启', cfg.get('versionIsolation') === true);
ok('默认下载模式=auto-version', cfg.get('downloadTargetMode') === 'auto-version');

console.log('\n[4] 模组版本转换检测 + 改写（Fabric 合成 jar）');
const JSZip = require('jszip');
async function fabricTest() {
  const zip = new JSZip();
  zip.file('fabric.mod.json', JSON.stringify({
    name: 'TestMod', id: 'testmod',
    depends: {
      minecraft: '>=1.20',
      java: '>=21',
      'fabric-convention-tags-v2': '>=0.110.0+1.21.1',
      'fabric-resource-loader-v0': '>=0.110.0+1.21.1',
    },
  }));
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const info = await convert.detectMod(buf);
  ok('识别为 fabric', info.loader === 'fabric' && info.canConvert === true);
  ok('当前版本识别为 1.20', info.currentVersion === '1.20');
  const out = await convert.convert(buf, '1.21.1', () => {});
  const z2 = await JSZip.loadAsync(out);
  const meta = JSON.parse(await z2.file('fabric.mod.json').async('string'));
  // minecraft 依赖写成「>=目标版本 <下一大版本」，这样 1.21.2 等补丁版也能兼容
  ok('改写后 minecraft 依赖为 >=1.21.1 <1.22', meta.depends.minecraft === '>=1.21.1 <1.22');
  // Fabric API 子模块的 MC 版本后缀必须一并改写，否则在目标版本里必然「版本不符」
  ok('改写后 Fabric API 依赖同步 MC 后缀', meta.depends['fabric-convention-tags-v2'] === '>=0.110.0+1.21.1');
  ok('改写后 fabric-resource-loader 也同步', meta.depends['fabric-resource-loader-v0'] === '>=0.110.0+1.21.1');

  // 移植到 1.20.1（Java 17）时：MC 后缀改成 1.20.1，java 要求放宽到 17
  const out2 = await convert.convert(buf, '1.20.1', () => {});
  const z3 = await JSZip.loadAsync(out2);
  const meta2 = JSON.parse(await z3.file('fabric.mod.json').async('string'));
  ok('移植到 1.20.1 后 minecraft 依赖正确', meta2.depends.minecraft === '>=1.20.1 <1.21');
  ok('移植到 1.20.1 后 Fabric API 后缀改为 1.20.1', meta2.depends['fabric-convention-tags-v2'] === '>=0.110.0+1.20.1');
  // java 依赖默认保持原样（用更高版本 Java 更安全），只有显式 relaxJava 才放宽
  ok('移植到 1.20.1 后 java 要求默认保留', meta2.depends.java === '>=21');
  // 显式要求放宽时才降到目标版本需要的 Java
  const out3 = await convert.convert(buf, '1.20.1', () => {}, { relaxJava: true });
  const z4 = await JSZip.loadAsync(out3);
  const meta3 = JSON.parse(await z4.file('fabric.mod.json').async('string'));
  ok('显式 relaxJava 时放宽为 >=17', meta3.depends.java === '>=17');
}
fabricTest().catch((e) => { fail++; console.error('  ✗ fabric 转换测试异常', e); });

console.log('\n[5] Modrinth 搜索（需要网络，失败不计入）');(async () => {
  try {
    const modrinth = require('../src/core/modrinth');
    const data = await modrinth.search({ query: 'jei', projectType: 'mod', gameVersion: '1.20.1', limit: 5 });
    ok('Modrinth 返回结果数组', Array.isArray(data.hits) && data.hits.length > 0);
    console.log('    示例:', (data.hits[0] || {}).title);
  } catch (e) {
    console.log('    （网络不可用，跳过）', e.message);
  }
})();

console.log('\n[6] 实例加载器识别 & 资源列表稳定排序');
{
  const { loaderOfInstance } = require('../src/core/instances');
  function mkVer(name, libs) {
    const d = path.join(root, 'versions', name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, name + '.json'), JSON.stringify({ id: name, libraries: libs || [] }));
    return name;
  }
  mkVer('t-forge', [{ name: 'net.minecraftforge:forge:1.20.1-47.4.0' }]);
  mkVer('t-fabric', [{ name: 'net.fabricmc:fabric-loader:0.16.0' }]);
  mkVer('t-neoforge', [{ name: 'net.neoforged:neoforge:20.4.190' }]);
  mkVer('t-neoforge-old', [{ name: 'net.neoforged:forge:1.20.1-47.1.84' }]);
  mkVer('t-quilt', [{ name: 'org.quiltmc:quilt-loader:0.23.0' }]);
  mkVer('t-vanilla', []);
  ok('识别 Forge', loaderOfInstance(root, 't-forge') === 'forge');
  ok('识别 Fabric', loaderOfInstance(root, 't-fabric') === 'fabric');
  ok('识别 NeoForge（新坐标）', loaderOfInstance(root, 't-neoforge') === 'neoforge');
  ok('识别 NeoForge（1.20.1 旧坐标）', loaderOfInstance(root, 't-neoforge-old') === 'neoforge');
  ok('识别 Quilt', loaderOfInstance(root, 't-quilt') === 'quilt');
  ok('原版没有加载器', loaderOfInstance(root, 't-vanilla') === '');
  ok('scanInstances 带出 loader 字段', scanInstances(root).find((i) => i.name === 't-forge').loader === 'forge');
}
{
  // 列表顺序必须稳定：禁用（改名加 .disabled）后顺序不能变，否则界面会「跳到最上面」
  const inst = 't-order';
  const dir = path.join(root, 'versions', inst, 'mods');
  fs.mkdirSync(dir, { recursive: true });
  for (const n of ['aaa.jar', 'bbb.jar', 'ccc.jar']) fs.writeFileSync(path.join(dir, n), 'x');
  const before = listPacks(root, inst, 'mod', true).map((p) => p.name);
  ok('列表按名称排序', JSON.stringify(before) === JSON.stringify(['aaa.jar', 'bbb.jar', 'ccc.jar']));
  togglePack(root, inst, 'mod', true, 'bbb.jar', false); // 禁用 bbb
  const after = listPacks(root, inst, 'mod', true).map((p) => p.name);
  ok('禁用后顺序不变（不跳到最上面）', JSON.stringify(after) === JSON.stringify(['aaa.jar', 'bbb.jar', 'ccc.jar']));
  const st = listPacks(root, inst, 'mod', true).find((p) => p.name === 'bbb.jar');
  ok('禁用状态正确', st && st.disabled === true);
}

setTimeout(() => {
  console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
  process.exit(fail ? 1 : 0);
}, 4000);
