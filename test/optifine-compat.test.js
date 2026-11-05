'use strict';
// 加载器兼容（1.20.1 的 NeoForge ↔ Forge）与 OptiFine 选取逻辑的测试。
const assert = require('assert');
const modcompat = require('../src/core/modcompat');
const optifine = require('../src/core/optifine');

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); passed++; }

// ---- 加载器兼容：MC 1.20.1 时 NeoForge 与 Forge 互相兼容 ----
ok('1.20.1：neoforge 实例可接受 forge 模组', modcompat.compatibleLoader('1.20.1', 'neoforge') === 'forge');
ok('1.20.1：forge 实例可接受 neoforge 模组', modcompat.compatibleLoader('1.20.1', 'forge') === 'neoforge');
ok('1.20.1：fabric 不与 forge 兼容', modcompat.compatibleLoader('1.20.1', 'fabric') === '');
ok('1.20.2：不再有 forge/neoforge 兼容', modcompat.compatibleLoader('1.20.2', 'neoforge') === '');
ok('1.21.1：不再有 forge/neoforge 兼容', modcompat.compatibleLoader('1.21.1', 'forge') === '');
ok('loaderCompatible：同加载器 → 兼容', modcompat.loaderCompatible('1.20.1', 'forge', 'forge') === true);
ok('loaderCompatible：1.20.1 neoforge 实例 + forge 模组 → 兼容', modcompat.loaderCompatible('1.20.1', 'neoforge', 'forge') === true);
ok('loaderCompatible：1.20.2 neoforge 实例 + forge 模组 → 不兼容', modcompat.loaderCompatible('1.20.2', 'neoforge', 'forge') === false);
ok('loaderCompatible：fabric 与 forge 永不兼容', modcompat.loaderCompatible('1.20.1', 'fabric', 'forge') === false);

// ---- OptiFine：从 CF 文件列表里挑合适的 ----
const files = [
  { id: 1, fileName: 'OptiFine_1.20.1_HD_U_G6.jar', releaseType: 1, downloadCount: 500, gameVersions: ['1.20.1', 'Forge'] },
  { id: 2, fileName: 'OptiFine_1.20.1_HD_U_I6.jar', releaseType: 1, downloadCount: 900, gameVersions: ['1.20.1', 'Forge'] },
  { id: 3, fileName: 'OptiFine_1.19.4_HD_U_I6.jar', releaseType: 1, downloadCount: 800, gameVersions: ['1.19.4', 'Forge'] },
  { id: 4, fileName: 'OptiFine_1.21.1_HD_U_I6.jar', releaseType: 1, downloadCount: 700, gameVersions: ['1.21.1', 'Forge'] },
  { id: 5, fileName: 'OptiFine_1.20.1_HD_U_I7.jar', releaseType: 3, downloadCount: 10, gameVersions: ['1.20.1', 'Forge'] },
  { id: 6, fileName: '别的模组.jar', releaseType: 1, downloadCount: 9999, gameVersions: ['1.20.1'] },
];
const p = optifine.pickFile(files, '1.20.1', 'forge');
ok('挑出 1.20.1 的 OptiFine', !!p && /_1\.20\.1_/.test(p.fileName));
ok('Forge 场景优先 I 版（整合版）', !!p && /_I\d+\.jar$/.test(p.fileName));
ok('优先正式版而不是 beta', !!p && p.releaseType === 1);
ok('忽略非 OptiFine 的文件', p.id !== 6);
ok('版本不匹配时也不会选到别的版本', optifine.pickFile(files, '1.16.5', 'forge') === null || /1\.16\.5/.test(optifine.pickFile(files, '1.16.5', 'forge').fileName));
ok('空列表返回 null', optifine.pickFile([], '1.20.1', 'forge') === null);
ok('undefined 返回 null', optifine.pickFile(undefined, '1.20.1', 'forge') === null);

// Fabric 场景优先 G 版（通用版）
const pg = optifine.pickFile(files, '1.20.1', 'fabric');
ok('Fabric 场景优先 G 版（通用版）', !!pg && /_G\d+\.jar$/.test(pg.fileName));

// ---- 替代品 ----
ok('Fabric 的替代品是 Iris', optifine.alternativeFor('fabric').slug === 'iris');
ok('Forge 的替代品是 Rubidium', optifine.alternativeFor('forge').slug === 'rubidium');
ok('NeoForge 的替代品是 Rubidium', optifine.alternativeFor('neoforge').slug === 'rubidium');
ok('原版的替代品是 Sodium', optifine.alternativeFor('').slug === 'sodium');

// ---- 常量 ----
ok('OptiFine 的 CF 项目 ID 是 2624', optifine.OPTIFINE_CF_ID === 2624);
ok('有官方下载页地址', /optifine\.net/.test(optifine.OPTIFINE_DOWNLOAD_PAGE));
ok('有 CF 文件页地址', /curseforge\.com/.test(optifine.OPTIFINE_PAGE));

console.log('optifine-compat.test.js: ' + passed + ' 条断言全部通过');
