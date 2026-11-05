'use strict';
// 崩溃诊断测试：从崩溃报告里提取「哪个模组要什么 / 缺什么」
const path = require('path');
const fs = require('fs');
const os = require('os');
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

const crashdiag = require('../src/core/crashdiag');

console.log('崩溃诊断测试');

const CN_SECTION = [
  'Failure message: Some of your mods are incompatible with the game or each other!',
  '\t\t确定了一种可能的解决方法，这样做可能会解决你的问题：',
  '\t\t   - 将 模组 Sable (sable) 2.0.6 替换为与这一模组兼容的 任意版本：',
  '\t\t更多信息：',
  '\t\t   - 模组 Sable (sable) 2.0.6 需要 OpenJDK 64-Bit Server VM (java) 的 21 及以上版本，但已经安装了的版本 17 不对！',
  '\t\t   - 模组 Sable (sable) 2.0.6 需要 模组 Veil (veil) 的 4.3.2 及以上版本，但由于其他限制条件无法载入！',
  '\t\t   - 模组 Sable (sable) 2.0.6 需要 模组 Fabric Resource Loader (v0) (fabric_resource_loader_v0) 的 0.110.0+1.21.1 及以上版本，但已经安装了的版本 0.11.12+4b4151c077 不对！',
  '\t\t   - 模组 Sable (sable) 2.0.6 需要 fabric-convention-tags-v2 的 0.110.0+1.21.1 及以上版本，但没有安装它！',
  '\tMod Version: NO MOD INFO AVAILABLE',
].join('\n');

const EN_SECTION = [
  'Failure message: Some of your mods are incompatible with the game or each other!',
  '    - Mod Sable (sable) 2.0.6 requires OpenJDK 64-Bit Server VM (java) 21 or above, but 17 is currently installed',
  '    - Mod Sable (sable) 2.0.6 requires Mod Veil (veil) 4.3.2 or above, but this could not be loaded',
  '    - Mod Sable (sable) 2.0.6 requires fabric-convention-tags-v2 0.110.0+1.21.1 or above, but this is not installed',
  '\tMod Version: NO MOD INFO AVAILABLE',
].join('\n');

// ---- 中文解析 ----
const cn = crashdiag.parseModIssues(CN_SECTION);
ok('中文：解析出 4 条问题', cn.length === 4);
ok('中文：识别 Java 版本问题', cn.some((i) => i.type === 'java' && i.version === '21' && i.installed === '17'));
ok('中文：识别无法载入的前置', cn.some((i) => i.type === 'unloadable' && i.need.indexOf('Veil') >= 0));
ok('中文：识别版本不符', cn.some((i) => i.type === 'version' && i.installed === '0.11.12+4b4151c077'));
ok('中文：识别未安装的前置', cn.some((i) => i.type === 'missing' && i.need === 'fabric-convention-tags-v2'));

// ---- 英文解析 ----
const en = crashdiag.parseModIssues(EN_SECTION);
ok('英文：解析出 3 条问题', en.length === 3);
ok('英文：识别 Java 版本问题', en.some((i) => i.type === 'java' && i.version === '21' && i.installed === '17'));
ok('英文：识别无法载入的前置', en.some((i) => i.type === 'unloadable'));
ok('英文：识别未安装的前置', en.some((i) => i.type === 'missing' && i.need === 'fabric-convention-tags-v2'));

// ---- 端到端：写一份崩溃报告到临时实例目录 ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crashdiag-'));
const crDir = path.join(tmp, 'crash-reports');
fs.mkdirSync(crDir, { recursive: true });
fs.writeFileSync(path.join(crDir, 'crash-2026-01-01_00.00.00-fml.txt'),
  '---- Minecraft Crash Report ----\n' + CN_SECTION + '\n', 'utf8');

const diag = crashdiag.diagnoseModCompatibility(tmp, 'Error during pre-loading phase');
ok('能识别出模组不兼容', !!diag);
ok('标题指向模组问题', diag && diag.title.indexOf('模组') >= 0);
ok('详情里指出 Veil 无法载入', diag && diag.details.some((d) => d.indexOf('Veil') >= 0));
ok('建议里包含安装缺失前置', diag && diag.suggestions.some((s) => s.indexOf('缺失') >= 0 || s.indexOf('安装') >= 0));
ok('记录了崩溃报告路径', diag && !!diag.crashReport);

// 非模组崩溃不应误报
const other = crashdiag.diagnoseModCompatibility(path.join(tmp, 'empty'), 'java.lang.OutOfMemoryError');
ok('非模组问题不误判为模组不兼容', other === null);

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
