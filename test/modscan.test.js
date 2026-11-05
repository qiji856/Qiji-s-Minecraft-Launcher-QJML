'use strict';
// 模组预检测试：解析 mods.toml / fabric.mod.json，提取 Java 要求与缺失前置
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

const modscan = require('../src/core/modscan');
const AdmZip = require('adm-zip');

console.log('模组预检测试');

// ---- 版本区间解析 ----
ok('Forge 风格 [21,) → min 21', modscan.parseVersionRange('[21,)').min === 21);
ok('Forge 风格 [21,) → max 无限制', modscan.parseVersionRange('[21,)').max === null);
ok('Forge 风格 [17,21) → 区间', modscan.parseVersionRange('[17,21)').min === 17 && modscan.parseVersionRange('[17,21)').max === 21);
ok('Forge 风格 [21] → 精确', modscan.parseVersionRange('[21]').min === 21 && modscan.parseVersionRange('[21]').max === 21);
ok('Maven 风格 >=21 → min 21', modscan.parseVersionRange('>=21').min === 21);
ok('Maven 风格 >21 → min 22', modscan.parseVersionRange('>21').min === 22);
ok('Maven 风格 * → 无限制', modscan.parseVersionRange('*').min === null);
ok('satisfies 21 满足 >=21', modscan.satisfies(21, '>=21') === true);
ok('satisfies 17 不满足 >=21', modscan.satisfies(17, '>=21') === false);
ok('satisfies 25 满足 [21,)', modscan.satisfies(25, '[21,)') === true);
ok('satisfies 17 满足 [17,21)', modscan.satisfies(17, '[17,21)') === true);
ok('satisfies 21 不满足 [17,21)', modscan.satisfies(21, '[17,21)') === false);

// ---- 构造假实例：Forge 模组 + Fabric 模组 ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modscan-'));
const modsDir = path.join(tmp, 'mods');
fs.mkdirSync(modsDir, { recursive: true });

function makeJar(file, entries) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.from(content, 'utf8'));
  }
  zip.writeZip(path.join(modsDir, file));
}

// 在指定子目录里造一个 jar
function makeJarIn(dir, file, entries) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.from(content, 'utf8'));
  }
  zip.writeZip(path.join(dir, file));
}

// Forge 模组：声明需要 Java 17，依赖另一个模组
makeJar('forge-mod-1.0.jar', {
  'META-INF/mods.toml': [
    'modLoader="javafml"',
    'loaderVersion="[47,)"',
    'license="MIT"',
    '',
    '[[mods]]',
    'modId="forgemod"',
    'version="1.0"',
    'displayName="Forge Mod"',
    '',
    '[[dependencies.forgemod]]',
    'modId="java"',
    'mandatory=true',
    'versionRange="[17,)"',
    'ordering="NONE"',
    'side="BOTH"',
    '',
    '[[dependencies.forgemod]]',
    'modId="othermod"',
    'mandatory=true',
    'versionRange="[1.0,)"',
    'ordering="AFTER"',
    'side="BOTH"',
  ].join('\n'),
});

// Fabric 模组：depends 是对象形态，要求 Java 21，依赖 veil
makeJar('fabric-mod-1.0.jar', {
  'fabric.mod.json': JSON.stringify({
    schemaVersion: 1,
    id: 'fabricmod',
    version: '1.0',
    name: 'Fabric Mod',
    depends: {
      java: '>=21',
      veil: '>=4.3.2',
    },
  }),
});

// 已安装的前置
makeJar('othermod-1.2.jar', {
  'META-INF/mods.toml': [
    'modLoader="javafml"',
    '[[mods]]',
    'modId="othermod"',
    'version="1.2"',
  ].join('\n'),
});

const scan = modscan.scanMods(tmp);
ok('扫描到 3 个模组', scan.mods.length === 3);
ok('识别出 Forge 模组的 Java 要求 17', (scan.mods.find((m) => m.id === 'forgemod') || {}).javaRange === '[17,)');
ok('识别出 Fabric 模组的 Java 要求 >=21', (scan.mods.find((m) => m.id === 'fabricmod') || {}).javaRange === '>=21');
ok('汇总的 Java 要求取最大值 21', scan.requiredJava === 21);
ok('已安装的前置不算缺失', !scan.missing.some((x) => x.need === 'othermod'));
ok('缺失的前置被识别（veil）', scan.missing.some((x) => x.need === 'veil'));

// Java 满足性检查
const r17 = modscan.checkJavaRequirements(scan, 17);
ok('Java 17 不满足（Fabric 模组要 21）', r17.ok === false);
ok('Java 17 冲突项指出是哪个模组', r17.conflicts.some((c) => c.mod === 'Fabric Mod'));
const r21 = modscan.checkJavaRequirements(scan, 21);
ok('Java 21 满足全部要求', r21.ok === true);

// 不存在的 mods 目录不报错
const empty = modscan.scanMods(path.join(tmp, 'nope'));
ok('mods 目录不存在时返回空结果', empty.mods.length === 0 && empty.requiredJava === null);

// ================= 子目录扫描 + 重复检测 =================
// 加载器会递归扫描 mods 的子目录，同一模组被放到两处就会被加载两遍。
const sub = path.join(modsDir, '[分类目录]');
fs.mkdirSync(sub, { recursive: true });
makeJarIn(sub, 'dup-mod-1.0.jar', {
  'META-INF/mods.toml': 'modLoader="javafml"\n[[mods]]\nmodId="dupmod"\nversion="1.0"\n',
});
// 顶层再放一个同 modId 的
makeJar('dup-mod-2.0.jar', {
  'META-INF/mods.toml': 'modLoader="javafml"\n[[mods]]\nmodId="dupmod"\nversion="2.0"\n',
});
// 隐藏目录（工具缓存）
const hidden = path.join(modsDir, '.connector');
fs.mkdirSync(hidden, { recursive: true });
makeJarIn(hidden, 'cached-mod.jar', {
  'META-INF/mods.toml': 'modLoader="javafml"\n[[mods]]\nmodId="cachemod"\nversion="1.0"\n',
});

const scan2 = modscan.scanMods(tmp);
ok('能扫到子目录里的模组', scan2.mods.some((m) => m.id === 'dupmod' && m.relPath.indexOf('[分类目录]') === 0));
ok('检测出重复加载的模组', scan2.duplicates.some((d) => d.id === 'dupmod' && d.files.length === 2));
ok('记录了子目录信息', scan2.subDirs.some((d) => d.name === '[分类目录]' && d.count === 1));
ok('识别出隐藏目录', scan2.hiddenDirs.some((d) => d.name === '.connector' && d.count === 1));
ok('隐藏目录里的模组不参与重复统计', !scan2.duplicates.some((d) => d.id === 'cachemod'));

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
